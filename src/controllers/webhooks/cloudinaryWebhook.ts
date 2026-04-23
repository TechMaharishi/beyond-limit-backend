/**
 * Cloudinary Webhook Handler for Video Subtitles
 *
 * POST /api/webhooks/cloudinary/blpt-videos
 *
 * Cloudinary sends a webhook notification when the google_speech:vtt
 * transcription add-on finishes (either successfully or with failure).
 *
 * This handler supports BOTH:
 *   - ShortVideo (top-level documents)
 *   - Course videos (embedded in Course.chapters[].lessons[].videos[],
 *     tracked via CourseSubtitleJob queue)
 *
 * The handler first looks up by ShortVideo.cloudinaryId, then falls back
 * to CourseSubtitleJob.cloudinaryId. This lets both types share the same
 * Cloudinary webhook endpoint.
 */

import { Request, Response, NextFunction } from "express";
import cloudinary from "@/config/cloudinary";
import { ShortVideo } from "@/models/short-videos";
import { CourseSubtitleJob } from "@/models/course-subtitle-job";
import { Course } from "@/models/course-videos";
import { sendSuccess, sendError } from "@/utils/api-response";
import logger from "@/utils/logger";

/**
 * Verify the webhook signature using the Cloudinary SDK.
 */
function verifyCloudinarySignature(req: Request): boolean {
  try {
    const signature = req.headers["x-cld-signature"] as string;
    const timestamp = req.headers["x-cld-timestamp"] as string;

    if (!signature || !timestamp) return false;

    const isValid = cloudinary.utils.verifyNotificationSignature(
      JSON.stringify(req.body),
      Number(timestamp),
      signature
    );

    return !!isValid;
  } catch (error) {
    logger.error("[CloudinaryWebhook] Signature verification error:", error);
    return false;
  }
}

/**
 * Build the public VTT URL for a video.
 */
function buildVttUrl(publicId: string): string {
  const sdkUrl = cloudinary.url(publicId, {
    resource_type: "raw",
    format: "vtt",
  }) as string;

  return sdkUrl.replace(/[?&]_a=[^&]*/g, "").replace(/\?$/, "");
}

/* ─────────────────────────────────────────────
 * Handle ShortVideo subtitle completion/failure
 * ───────────────────────────────────────────── */

async function handleShortVideoResult(
  publicId: string,
  infoStatus: string,
  body: any
): Promise<{ handled: boolean; response?: any }> {
  const video = await ShortVideo.findOne({ cloudinaryId: publicId });
  if (!video) return { handled: false };

  if (infoStatus === "complete" || infoStatus === "completed") {
    // Always accept success — a successful transcription is always welcome.
    const vttUrl = buildVttUrl(publicId);

    await ShortVideo.findByIdAndUpdate(video._id, {
      $set: {
        subtitle_status: "completed",
        subtitle_failure_reason: null,
        retryable: false,
        subtitles: [
          {
            lang: "en",
            label: "English",
            url: vttUrl,
            format: "vtt",
            default: true,
          },
        ],
      },
    });

    logger.info(
      `[CloudinaryWebhook] [ShortVideo] Subtitle completed for ${video._id} (${publicId})`
    );

    return {
      handled: true,
      response: {
        videoId: String(video._id),
        publicId,
        subtitle_status: "completed",
        vttUrl,
      },
    };
  }

  // Failure notification — only accept if our worker triggered it (status === processing).
  // If the job is still "pending", this failure came from an auto-triggered transcription
  // (e.g. Cloudinary upload preset with raw_convert enabled) that fired before
  // the video finished processing. Ignore it so the worker can retry later.
  if (video.subtitle_status !== "processing") {
    logger.info(
      `[CloudinaryWebhook] [ShortVideo] Ignoring failure webhook for ${video._id} — current status is '${video.subtitle_status}', not 'processing'`
    );
    return { handled: true, response: { videoId: String(video._id), publicId, ignored: true } };
  }

  const failureReason =
    String(body?.info_message || body?.error?.message || "Transcription failed").trim();

  await ShortVideo.findByIdAndUpdate(video._id, {
    $set: {
      subtitle_status: "failed",
      subtitle_failure_reason: failureReason,
      retryable: true,
    },
  });

  logger.warn(
    `[CloudinaryWebhook] [ShortVideo] Subtitle failed for ${video._id}: ${failureReason}`
  );

  return {
    handled: true,
    response: {
      videoId: String(video._id),
      publicId,
      subtitle_status: "failed",
    },
  };
}

/* ─────────────────────────────────────────────
 * Handle Course video subtitle completion/failure
 * ───────────────────────────────────────────── */

async function handleCourseVideoResult(
  publicId: string,
  infoStatus: string,
  body: any
): Promise<{ handled: boolean; response?: any }> {
  const job = await CourseSubtitleJob.findOne({ cloudinaryId: publicId });
  if (!job) return { handled: false };

  if (infoStatus === "complete" || infoStatus === "completed") {
    // Always accept success — a successful transcription is always welcome.
    const vttUrl = buildVttUrl(publicId);

    // Update the queue job
    await CourseSubtitleJob.findByIdAndUpdate(job._id, {
      $set: {
        subtitle_status: "completed",
        subtitle_failure_reason: null,
        retryable: false,
      },
    });

    // Update ALL matching embedded videos in the course document.
    try {
      await Course.updateOne(
        { _id: job.courseId },
        {
          $set: {
            "chapters.$[].lessons.$[].videos.$[vid].subtitles": [
              {
                lang: "en",
                label: "English",
                url: vttUrl,
                format: "vtt",
                default: true,
              },
            ],
            "chapters.$[].lessons.$[].videos.$[vid].subtitle_status": "completed",
            "chapters.$[].lessons.$[].videos.$[vid].subtitle_failure_reason": null,
            "chapters.$[].lessons.$[].videos.$[vid].retryable": false,
          },
        },
        {
          arrayFilters: [{ "vid.cloudinaryId": publicId }],
        }
      );
    } catch (updateErr) {
      logger.error(
        `[CloudinaryWebhook] [Course] Failed to update embedded video subtitles for course ${job.courseId}:`,
        updateErr
      );
    }

    logger.info(
      `[CloudinaryWebhook] [Course] Subtitle completed for job ${job._id} (course: ${job.courseId}, publicId: ${publicId})`
    );

    return {
      handled: true,
      response: {
        jobId: String(job._id),
        courseId: String(job.courseId),
        publicId,
        subtitle_status: "completed",
        vttUrl,
      },
    };
  }

  // Failure notification — only accept if our worker triggered it (status === processing).
  // If the job is still "pending", this failure came from an auto-triggered transcription
  // (e.g. Cloudinary upload preset with raw_convert enabled) that fired before
  // the video finished processing. Ignore it so the worker can retry later.
  if (job.subtitle_status !== "processing") {
    logger.info(
      `[CloudinaryWebhook] [Course] Ignoring failure webhook for job ${job._id} — current status is '${job.subtitle_status}', not 'processing'`
    );
    return { handled: true, response: { jobId: String(job._id), publicId, ignored: true } };
  }

  const failureReason =
    String(body?.info_message || body?.error?.message || "Transcription failed").trim();

  await CourseSubtitleJob.findByIdAndUpdate(job._id, {
    $set: {
      subtitle_status: "failed",
      subtitle_failure_reason: failureReason,
      retryable: true,
    },
  });

  // Sync failed state to embedded videos in the Course
  try {
    await Course.updateOne(
      { _id: job.courseId },
      {
        $set: {
          "chapters.$[].lessons.$[].videos.$[vid].subtitle_status": "failed",
          "chapters.$[].lessons.$[].videos.$[vid].subtitle_failure_reason": failureReason,
          "chapters.$[].lessons.$[].videos.$[vid].retryable": true,
        },
      },
      {
        arrayFilters: [{ "vid.cloudinaryId": publicId }],
      }
    );
  } catch (updateErr) {
    logger.error(
      `[CloudinaryWebhook] [Course] Failed to sync failed-state to embedded video subtitles for course ${job.courseId}:`,
      updateErr
    );
  }

  logger.warn(
    `[CloudinaryWebhook] [Course] Subtitle failed for job ${job._id}: ${failureReason}`
  );

  return {
    handled: true,
    response: {
      jobId: String(job._id),
      courseId: String(job.courseId),
      publicId,
      subtitle_status: "failed",
    },
  };
}

/* ─────────────────────────────────────────────
 * Main webhook handler
 * ───────────────────────────────────────────── */

export const handleCloudinaryShortVideoWebhook = async (
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  try {
    // Step 1: Validate webhook signature
    const isValid = verifyCloudinarySignature(req);
    if (!isValid) {
      logger.warn("[CloudinaryWebhook] Invalid signature received");
      return sendError(res, 401, "Invalid webhook signature");
    }

    const body = req.body;
    const notificationType = String(body?.notification_type || "").trim();
    const publicId = String(body?.public_id || "").trim();
    const infoStatus = String(body?.info_status || "").trim().toLowerCase();

    logger.info(
      `[CloudinaryWebhook] Received: type=${notificationType}, publicId=${publicId}, infoStatus=${infoStatus}`
    );

    // We only care about raw_convert (transcription) notifications
    if (notificationType !== "info" && notificationType !== "raw_convert") {
      return sendSuccess(res, 200, "Webhook acknowledged (not a transcription event)");
    }

    if (!publicId) {
      return sendError(res, 400, "Missing public_id in webhook payload");
    }

    // Step 2: Try ShortVideo first
    const shortResult = await handleShortVideoResult(publicId, infoStatus, body);
    if (shortResult.handled) {
      const msg = infoStatus === "complete" || infoStatus === "completed"
        ? "Subtitle completed and saved"
        : "Subtitle failure recorded";
      return sendSuccess(res, 200, msg, shortResult.response);
    }

    // Step 3: Try CourseSubtitleJob
    const courseResult = await handleCourseVideoResult(publicId, infoStatus, body);
    if (courseResult.handled) {
      const msg = infoStatus === "complete" || infoStatus === "completed"
        ? "Course subtitle completed and saved"
        : "Course subtitle failure recorded";
      return sendSuccess(res, 200, msg, courseResult.response);
    }

    // Not found in either collection
    logger.warn(
      `[CloudinaryWebhook] No video found for publicId: ${publicId}`
    );
    return sendSuccess(res, 200, "Webhook acknowledged (video not found)");
  } catch (error) {
    logger.error("[CloudinaryWebhook] Unhandled error:", error);
    return sendSuccess(res, 200, "Webhook processed with errors");
  }
};
