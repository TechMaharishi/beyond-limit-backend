/**
 * Retry Course Subtitles Controller
 *
 * POST /api/courses/:courseId/retry-subtitles
 *
 * Resets all failed/completed subtitle jobs for a course back to "pending"
 * so the polling worker re-processes them.
 *
 * Also allows targeting a specific cloudinaryId via query param:
 * POST /api/courses/:courseId/retry-subtitles?cloudinaryId=abc123
 */

import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { CourseSubtitleJob } from "@/models/course-subtitle-job";
import { Course } from "@/models/course-videos";
import { sendSuccess, sendError } from "@/utils/api-response";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import logger from "@/utils/logger";

export const retryCourseSubtitles = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { courseId } = req.params as { courseId: string };
    const { cloudinaryId } = req.query as { cloudinaryId?: string };

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return sendError(res, 400, "Invalid course ID format");
    }

    // Authenticate
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    // Only admins can trigger retry
    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    if (!isAdmin) {
      return sendError(res, 403, "Forbidden: only admin can retry subtitles");
    }

    // Fetch the full course to extract embedded video cloudinaryIds
    const course = await Course.findById(courseId).lean();
    if (!course) {
      return sendError(res, 404, "Course not found");
    }

    // Extract all cloudinaryIds from the course videos
    const chaps = Array.isArray(course.chapters) ? course.chapters : [];
    const allCloudinaryIds: string[] = [];

    for (const ch of chaps) {
      const lessons = Array.isArray(ch?.lessons) ? ch.lessons : [];
      for (const ls of lessons) {
        const videos = Array.isArray(ls?.videos) ? ls.videos : [];
        for (const v of videos) {
          const cid = String(v?.cloudinaryId || "").trim();
          if (cid) {
            allCloudinaryIds.push(cid);
          }
        }
      }
    }

    // Filter to a specific cloudinaryId if provided
    const targetIds = cloudinaryId 
      ? allCloudinaryIds.filter(id => id === cloudinaryId)
      : allCloudinaryIds;

    // Deduplicate
    const uniqueIds = [...new Set(targetIds)];

    if (uniqueIds.length === 0) {
      return sendSuccess(res, 200, "0 subtitle job(s) queued for retry (no videos found)", {
        courseId,
        modifiedCount: 0,
      });
    }

    // For each uniqueId, UPSERT the job so it exists (fixes old courses), 
    // and SET status back to pending. Skip currently 'processing' jobs.
    const ops = uniqueIds.map((cid) => ({
      updateOne: {
        filter: { 
          courseId: new mongoose.Types.ObjectId(courseId), 
          cloudinaryId: cid, 
          subtitle_status: { $ne: "processing" as const } 
        },
        update: {
          $set: {
            subtitle_status: "pending" as const,
            subtitle_failure_reason: null,
            retryable: false,
            // Manual retry — process immediately on next worker tick
            not_before: new Date(),
          },
          $setOnInsert: {
            subtitle_retry_count: 0,
            last_subtitle_attempt: null,
          },
        },
        upsert: true,
      },
    }));

    const result = await CourseSubtitleJob.bulkWrite(ops, { ordered: false });

    // Sync "pending" state back to the embedded videos in the Course
    try {
      await Course.updateMany(
        { _id: new mongoose.Types.ObjectId(courseId) },
        {
          $set: {
            "chapters.$[].lessons.$[].videos.$[vid].subtitle_status": "pending",
            "chapters.$[].lessons.$[].videos.$[vid].subtitle_failure_reason": null,
            "chapters.$[].lessons.$[].videos.$[vid].retryable": false,
          },
        },
        {
          arrayFilters: [{ "vid.cloudinaryId": { $in: uniqueIds } }],
        }
      );
    } catch (syncErr) {
      logger.error(`[RetryCourseSubtitles] Failed to sync pending state to course ${courseId}:`, syncErr);
    }

    const totalAffected = (result.upsertedCount || 0) + (result.modifiedCount || 0);

    logger.info(
      `[RetryCourseSubtitles] Admin ${user.id} queued ${totalAffected} subtitle job(s) for course ${courseId}`
    );

    return sendSuccess(
      res,
      200,
      `${totalAffected} subtitle job(s) queued for retry`,
      {
        courseId,
        modifiedCount: totalAffected,
      }
    );
  } catch (error) {
    next(error);
  }
};
