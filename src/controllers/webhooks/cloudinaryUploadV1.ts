/**
 * Cloudinary Upload Webhook — V1
 *
 * POST /api/v1/webhooks/cloudinary/upload-complete
 *
 * Cloudinary calls this endpoint when a direct upload (initiated via a signed
 * URL from getSignedUploadUrl) finishes processing.
 *
 * On success:
 *   - Populates cloudinaryUrl, cloudinaryId, thumbnailUrl, durationSeconds
 *   - Resets the subtitle pipeline so the caption worker picks up the new video
 *
 * This handler is intentionally separate from the existing subtitle webhook
 * (/api/webhooks/cloudinary/blpt-videos) so the two concerns don't interfere.
 */

import { Request, Response, NextFunction } from "express";
import cloudinary from "@/config/cloudinary";
import { ShortVideo } from "@/models/short-videos";
import { Course } from "@/models/course-videos";
import { CourseSubtitleJob } from "@/models/course-subtitle-job";
import { sendSuccess, sendError } from "@/utils/api-response";
import logger from "@/utils/logger";

// ─── Signature verification ──────────────────────────────────────────────────

function verifyCloudinarySignature(req: Request): boolean {
  try {
    const signature = req.headers["x-cld-signature"] as string;
    const timestamp = req.headers["x-cld-timestamp"] as string;
    if (!signature || !timestamp) return false;

    // Use the raw body string captured before express.json() parsed it.
    // JSON.stringify(req.body) can differ in key order/whitespace from what
    // Cloudinary actually signed, causing HMAC mismatches.
    const rawBody = (req as any).rawBody ?? JSON.stringify(req.body);

    return !!cloudinary.utils.verifyNotificationSignature(
      rawBody,
      Number(timestamp),
      signature
    );
  } catch (err) {
    logger.error("[CloudinaryUploadV1] Signature verification error:", err);
    return false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildHlsUrl(publicId: string): string {
  return cloudinary.url(publicId, {
    resource_type: "video",
    format: "m3u8",
    transformation: [{ streaming_profile: "auto" }],
  });
}

function buildThumbnailUrl(publicId: string, durationSeconds: number): string {
  const offset = durationSeconds >= 1 ? 1 : 0;
  return cloudinary.url(publicId, {
    resource_type: "video",
    format: "jpg",
    transformation: [{ start_offset: offset }],
  });
}

/**
 * Extracts the ShortVideo MongoDB _id from a Cloudinary public_id.
 * Supported formats:
 *   "short-videos/<mongoId>"           — legacy single-upload format
 *   "short-videos/<mongoId>/<timestamp>" — current unique-per-upload format
 */
function extractShortVideoId(publicId: string): string | null {
  const match = publicId.match(/^short-videos\/([a-f0-9]{24})(\/\d+)?$/);
  return match ? match[1] : null;
}

/**
 * Extracts courseId, chapterIndex, lessonIndex from a course-videos public_id.
 * Format: "course-videos/<courseId>/<chapterIndex>/<lessonIndex>/<timestamp>"
 */
function extractCourseVideoParams(publicId: string): { courseId: string; chapterIndex: number; lessonIndex: number } | null {
  const match = publicId.match(/^course-videos\/([a-f0-9]{24})\/(\d+)\/(\d+)\/\d+$/);
  if (!match) return null;
  return {
    courseId: match[1],
    chapterIndex: Number(match[2]),
    lessonIndex: Number(match[3]),
  };
}

async function handleCourseVideoUpload(
  publicId: string,
  durationSeconds: number,
  secureUrl: string
): Promise<void> {
  const params = extractCourseVideoParams(publicId);
  if (!params) {
    logger.warn(`[CloudinaryUploadV1] course-videos public_id format unrecognised: ${publicId}`);
    return;
  }

  const { courseId, chapterIndex, lessonIndex } = params;

  const course = await Course.findById(courseId);
  if (!course) {
    logger.warn(`[CloudinaryUploadV1] Course not found: ${courseId}`);
    return;
  }

  const chapter = (course.chapters as any[])[chapterIndex];
  if (!chapter) {
    logger.warn(`[CloudinaryUploadV1] Chapter ${chapterIndex} not found in course ${courseId}`);
    return;
  }

  const lesson = (chapter.lessons as any[])?.[lessonIndex];
  if (!lesson) {
    logger.warn(`[CloudinaryUploadV1] Lesson ${lessonIndex} not found in chapter ${chapterIndex}`);
    return;
  }

  // Destroy old asset if replacing
  lesson.videos = Array.isArray(lesson.videos) ? lesson.videos : [];
  const existingVideo = lesson.videos[0] as any;
  const previousCloudinaryId = String(existingVideo?.cloudinaryId || "").trim();
  if (previousCloudinaryId && previousCloudinaryId !== publicId) {
    try {
      await cloudinary.uploader.destroy(previousCloudinaryId, { resource_type: "video", invalidate: true });
      logger.info(`[CloudinaryUploadV1] Destroyed old course asset: ${previousCloudinaryId}`);
    } catch (e) {
      logger.warn(`[CloudinaryUploadV1] Could not destroy old course asset ${previousCloudinaryId}:`, e);
    }
  }

  const hlsUrl = buildHlsUrl(publicId);
  const thumbnailUrl = buildThumbnailUrl(publicId, durationSeconds);
  const isSameVideo = existingVideo?.cloudinaryId === publicId;

  const videoPayload = {
    title: lesson.title || "Lesson Video",
    cloudinaryUrl: secureUrl || hlsUrl,
    cloudinaryId: publicId,
    durationSeconds,
    thumbnailUrl,
    subtitles: isSameVideo && Array.isArray(existingVideo?.subtitles) ? existingVideo.subtitles : [],
    subtitle_status: "pending" as const,
    subtitle_failure_reason: null,
    subtitle_retry_count: 0,
    last_subtitle_attempt: null,
    retryable: false,
  };

  if (lesson.videos.length > 0) {
    lesson.videos[0] = { ...lesson.videos[0], ...videoPayload };
  } else {
    lesson.videos.push(videoPayload);
  }

  course.markModified("chapters");
  await course.save();

  // Enqueue subtitle job (fire-and-forget)
  try {
    const NOT_BEFORE_DELAY_MS = 2 * 60 * 1000;
    await CourseSubtitleJob.bulkWrite(
      [{
        updateOne: {
          filter: { courseId: course._id, cloudinaryId: publicId },
          update: {
            $set: { subtitle_status: "pending", subtitle_failure_reason: null },
            $setOnInsert: {
              courseId: course._id,
              cloudinaryId: publicId,
              subtitle_retry_count: 0,
              last_subtitle_attempt: null,
              retryable: false,
              not_before: new Date(Date.now() + NOT_BEFORE_DELAY_MS),
            },
          },
          upsert: true,
        },
      }],
      { ordered: false }
    );
  } catch (e) {
    logger.error(`[CloudinaryUploadV1] Failed to enqueue subtitle job for course ${courseId}:`, e);
  }

  logger.info(
    `[CloudinaryUploadV1] Course lesson video updated: course=${courseId} chapter=${chapterIndex} lesson=${lessonIndex} (duration: ${durationSeconds}s)`
  );
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export const handleCloudinaryUploadCompleteV1 = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  try {
    // Always respond 200 quickly — Cloudinary retries on non-2xx
    if (!verifyCloudinarySignature(req)) {
      logger.warn("[CloudinaryUploadV1] Invalid webhook signature");
      return sendError(res, 401, "Invalid webhook signature");
    }

    const body = req.body;
    const notificationType = String(body?.notification_type || "").trim();
    const publicId = String(body?.public_id || "").trim();

    logger.info(
      `[CloudinaryUploadV1] Received: type=${notificationType}, publicId=${publicId}`
    );

    // We only process "upload" events from this endpoint
    if (notificationType !== "upload") {
      return sendSuccess(res, 200, "Webhook acknowledged (not an upload event)");
    }

    if (!publicId) {
      return sendError(res, 400, "Missing public_id in webhook payload");
    }

    // Cloudinary upload payload fields
    const rawDuration = Number(body?.duration ?? body?.video?.bit_rate ?? 0);
    const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
    const secureUrl = String(body?.secure_url || "");

    // Route to the correct handler based on public_id prefix
    if (publicId.startsWith("course-videos/")) {
      await handleCourseVideoUpload(publicId, durationSeconds, secureUrl);
      return sendSuccess(res, 200, "Upload webhook processed", { publicId, durationSeconds });
    }

    const shortVideoId = extractShortVideoId(publicId);
    if (!shortVideoId) {
      logger.warn(`[CloudinaryUploadV1] public_id format unrecognised: ${publicId}`);
      return sendSuccess(res, 200, "Webhook acknowledged (unrecognised public_id format)");
    }

    const video = await ShortVideo.findById(shortVideoId);
    if (!video) {
      logger.warn(`[CloudinaryUploadV1] Short video not found for id: ${shortVideoId}`);
      return sendSuccess(res, 200, "Webhook acknowledged (video not found)");
    }

    // If this short already has a different Cloudinary asset (re-upload scenario),
    // destroy the old one so it doesn't linger and cause stale CDN hits or subtitle webhooks.
    const previousCloudinaryId = String((video as any).cloudinaryId || "").trim();
    if (previousCloudinaryId && previousCloudinaryId !== publicId) {
      try {
        await cloudinary.uploader.destroy(previousCloudinaryId, { resource_type: "video", invalidate: true });
        logger.info(`[CloudinaryUploadV1] Destroyed old asset: ${previousCloudinaryId}`);
      } catch (e) {
        logger.warn(`[CloudinaryUploadV1] Could not destroy old asset ${previousCloudinaryId}:`, e);
      }
    }

    const hlsUrl = buildHlsUrl(publicId);
    const thumbnailUrl = buildThumbnailUrl(publicId, durationSeconds);

    // Update video fields and reset subtitle pipeline for the new video
    await ShortVideo.findByIdAndUpdate(shortVideoId, {
      $set: {
        cloudinaryId: publicId,
        cloudinaryUrl: secureUrl || hlsUrl,
        thumbnailUrl,
        durationSeconds,
        // Reset subtitle pipeline so the caption worker re-picks this video
        subtitle_status: "pending",
        subtitle_failure_reason: null,
        subtitle_retry_count: 0,
        retryable: false,
        subtitles: [],
        // Give Cloudinary 2 min to finish transcoding before the caption worker fires
        not_before: new Date(Date.now() + 2 * 60 * 1000),
      },
    });

    logger.info(
      `[CloudinaryUploadV1] Video record updated: ${shortVideoId} (duration: ${durationSeconds}s)`
    );

    return sendSuccess(res, 200, "Upload webhook processed", {
      shortVideoId,
      publicId,
      durationSeconds,
    });
  } catch (error) {
    logger.error("[CloudinaryUploadV1] Unhandled error:", error);
    // Always 200 so Cloudinary doesn't retry
    return sendSuccess(res, 200, "Webhook processed with errors");
  }
};
