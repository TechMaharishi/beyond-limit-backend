import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import cloudinary from "@/config/cloudinary";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { Course } from "@/models/course-videos";
import { sendSuccess, sendError } from "@/utils/api-response";
import logger from "@/utils/logger";

export const getSignedCourseVideoUploadUrl = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const courseId = String(req.params.courseId);
    const cIdx = Number(req.params.chapterIndex);
    const lIdx = Number(req.params.lessonIndex);

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return sendError(res, 400, "Invalid course ID");
    }
    if (!Number.isInteger(cIdx) || cIdx < 0) return sendError(res, 400, "Invalid chapterIndex");
    if (!Number.isInteger(lIdx) || lIdx < 0) return sendError(res, 400, "Invalid lessonIndex");

    const course = await Course.findById(courseId).select("user chapters");
    if (!course) return sendError(res, 404, "Course not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = course.user.toString() === String((user as any).id);
    if (!isAdmin && !isOwner) return sendError(res, 403, "Forbidden");

    const chapter = (course.chapters as any[])[cIdx];
    if (!chapter) return sendError(res, 404, "Chapter not found");
    const lesson = (chapter.lessons as any[])?.[lIdx];
    if (!lesson) return sendError(res, 404, "Lesson not found");

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const appBaseUrl = process.env.BETTER_AUTH_URL;

    if (!cloudName || !apiKey || !apiSecret || !appBaseUrl) {
      logger.error("[CourseVideosV1] Missing Cloudinary or app env vars");
      return sendError(res, 500, "Server configuration error");
    }

    const timestamp = Math.round(Date.now() / 1000);
    const publicId = `course-videos/${courseId}/${cIdx}/${lIdx}/${timestamp}`;
    const notificationUrl = `${appBaseUrl}/api/v1/webhooks/cloudinary/upload-complete`;

    const paramsToSign: Record<string, string | number> = {
      notification_url: notificationUrl,
      public_id: publicId,
      timestamp,
    };

    const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

    logger.info(`[CourseVideosV1] Signed URL generated for course=${courseId} chapter=${cIdx} lesson=${lIdx}`);

    return sendSuccess(res, 200, "Signed upload URL generated", {
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
      fields: {
        api_key: apiKey,
        timestamp,
        signature,
        public_id: publicId,
        notification_url: notificationUrl,
        resource_type: "video",
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const getCourseVideoUploadStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const courseId = String(req.params.courseId);
    const cIdx = Number(req.params.chapterIndex);
    const lIdx = Number(req.params.lessonIndex);

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return sendError(res, 400, "Invalid course ID");
    }
    if (!Number.isInteger(cIdx) || cIdx < 0) return sendError(res, 400, "Invalid chapterIndex");
    if (!Number.isInteger(lIdx) || lIdx < 0) return sendError(res, 400, "Invalid lessonIndex");

    const course = await Course.findById(courseId).select("user chapters").lean();
    if (!course) return sendError(res, 404, "Course not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = String((course as any).user) === String((user as any).id);
    if (!isAdmin && !isOwner) return sendError(res, 403, "Forbidden");

    const chapter = ((course as any).chapters as any[])?.[cIdx];
    if (!chapter) return sendError(res, 404, "Chapter not found");
    const lesson = (chapter.lessons as any[])?.[lIdx];
    if (!lesson) return sendError(res, 404, "Lesson not found");

    const video = (lesson.videos as any[])?.[0];

    return sendSuccess(res, 200, "Status fetched", {
      courseId,
      chapterIndex: cIdx,
      lessonIndex: lIdx,
      videoReady: !!(video?.cloudinaryId),
      cloudinaryId: video?.cloudinaryId || null,
      durationSeconds: video?.durationSeconds || 0,
      subtitleStatus: video?.subtitle_status || null,
    });
  } catch (error) {
    return next(error);
  }
};
