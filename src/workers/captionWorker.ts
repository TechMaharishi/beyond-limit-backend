/**
 * Subtitle Worker — MongoDB Polling Module
 *
 * Standalone polling worker (NOT inside any route file).
 * Uses setInterval with a 60-second interval.
 *
 * Handles TWO types of videos:
 *   1. ShortVideo — top-level documents with subtitle_status field
 *   2. CourseSubtitleJob — queue documents for deeply-embedded course videos
 *
 * On each tick the worker claims ONE job from either queue.
 */

import { ShortVideo } from "@/models/short-videos";
import { CourseSubtitleJob } from "@/models/course-subtitle-job";
import { Course } from "@/models/course-videos";
import cloudinary from "@/config/cloudinary";
import logger from "@/utils/logger";

const POLL_INTERVAL_MS = 60_000; // 60 seconds
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/* ─────────────────────────────────────────────
 * Stale-reset helpers (server-crash recovery)
 * ───────────────────────────────────────────── */

async function resetStaleShortVideos(): Promise<void> {
  try {
    const threshold = new Date(Date.now() - STALE_THRESHOLD_MS);
    const result = await ShortVideo.updateMany(
      {
        subtitle_status: "processing",
        last_subtitle_attempt: { $lt: threshold },
      },
      { $set: { subtitle_status: "pending" } }
    );
    if (result.modifiedCount > 0) {
      logger.info(
        `[SubtitleWorker] Reset ${result.modifiedCount} stale short-video(s) to pending`
      );
    }
  } catch (error) {
    logger.error("[SubtitleWorker] Error resetting stale short-videos:", error);
  }
}

async function resetStaleCourseJobs(): Promise<void> {
  try {
    const threshold = new Date(Date.now() - STALE_THRESHOLD_MS);
    const result = await CourseSubtitleJob.updateMany(
      {
        subtitle_status: "processing",
        last_subtitle_attempt: { $lt: threshold },
      },
      { $set: { subtitle_status: "pending" } }
    );
    if (result.modifiedCount > 0) {
      logger.info(
        `[SubtitleWorker] Reset ${result.modifiedCount} stale course-job(s) to pending`
      );
    }
  } catch (error) {
    logger.error("[SubtitleWorker] Error resetting stale course-jobs:", error);
  }
}

/* ─────────────────────────────────────────────
 * Core Cloudinary trigger (shared logic)
 * ───────────────────────────────────────────── */

async function triggerTranscription(publicId: string): Promise<void> {
  await (cloudinary as any).api.update(publicId, {
    resource_type: "video",
    type: "upload",
    raw_convert: "google_speech:vtt",
  });
}

/* ─────────────────────────────────────────────
 * Process ONE pending short-video
 * ───────────────────────────────────────────── */

async function processPendingShortVideo(): Promise<boolean> {
  const now = new Date();
  const video = await ShortVideo.findOneAndUpdate(
    {
      subtitle_status: "pending",
      cloudinaryId: { $ne: "" },
      // Only pick up jobs whose not_before has elapsed (respects upload-processing delay)
      not_before: { $lte: now },
    },
    {
      $set: {
        subtitle_status: "processing",
        last_subtitle_attempt: new Date(),
      },
      $inc: { subtitle_retry_count: 1 },
    },
    { returnDocument: 'after' }
  );

  if (!video) return false; // nothing to process

  const publicId = String(video.cloudinaryId || "").trim();
  if (!publicId) {
    await ShortVideo.findByIdAndUpdate(video._id, {
      $set: {
        subtitle_status: "failed",
        subtitle_failure_reason: "Missing cloudinaryId",
        retryable: false,
      },
    });
    return true;
  }

  logger.info(
    `[SubtitleWorker] [ShortVideo] Triggering transcription for ${video._id} (${publicId})`
  );

  try {
    await triggerTranscription(publicId);
    logger.info(`[SubtitleWorker] [ShortVideo] Transcription requested for ${video._id}`);
  } catch (error: any) {
    const rawMessage =
      String(error?.error?.message || error?.message || "").trim() || "Cloudinary request failed";
    const httpCode = Number(error?.http_code || error?.error?.http_code || 0) || 0;
    const lower = rawMessage.toLowerCase();

    const quotaExceeded =
      httpCode === 420 ||
      lower.includes("rate limit exceeded") ||
      (lower.includes("limit of") && lower.includes("transcription"));

    logger.error(
      `[SubtitleWorker] [ShortVideo] Failed for ${video._id}: ${rawMessage} (HTTP ${httpCode})`
    );

    await ShortVideo.findByIdAndUpdate(video._id, {
      $set: {
        subtitle_status: "failed",
        subtitle_failure_reason: quotaExceeded ? `Quota exceeded: ${rawMessage}` : rawMessage,
        retryable: true,
      },
    });
  }

  return true;
}

/* ─────────────────────────────────────────────
 * Process ONE pending course subtitle job
 * ───────────────────────────────────────────── */

async function processPendingCourseJob(): Promise<boolean> {
  const now = new Date();
  const job = await CourseSubtitleJob.findOneAndUpdate(
    {
      subtitle_status: "pending",
      cloudinaryId: { $ne: "" },
      // Only pick up jobs whose not_before has elapsed (respects upload-processing delay)
      not_before: { $lte: now },
    },
    {
      $set: {
        subtitle_status: "processing",
        last_subtitle_attempt: new Date(),
      },
      $inc: { subtitle_retry_count: 1 },
    },
    { returnDocument: 'after' }
  );

  if (!job) return false; // nothing to process

  const publicId = String(job.cloudinaryId || "").trim();
  if (!publicId) {
    await CourseSubtitleJob.findByIdAndUpdate(job._id, {
      $set: {
        subtitle_status: "failed",
        subtitle_failure_reason: "Missing cloudinaryId",
        retryable: false,
      },
    });

    try {
      await Course.updateOne(
        { _id: job.courseId },
        {
          $set: {
            "chapters.$[].lessons.$[].videos.$[vid].subtitle_status": "failed",
            "chapters.$[].lessons.$[].videos.$[vid].subtitle_failure_reason": "Missing cloudinaryId",
            "chapters.$[].lessons.$[].videos.$[vid].retryable": false,
          },
        },
        { arrayFilters: [{ "vid.cloudinaryId": publicId }] }
      );
    } catch (e) {}

    return true;
  }

  // Sync "processing" state to embedded course videos
  try {
    await Course.updateOne(
      { _id: job.courseId },
      {
        $set: {
          "chapters.$[].lessons.$[].videos.$[vid].subtitle_status": "processing",
          "chapters.$[].lessons.$[].videos.$[vid].last_subtitle_attempt": job.last_subtitle_attempt,
        },
        $inc: { "chapters.$[].lessons.$[].videos.$[vid].subtitle_retry_count": 1 }
      },
      { arrayFilters: [{ "vid.cloudinaryId": publicId }] }
    );
  } catch (e) {}

  logger.info(
    `[SubtitleWorker] [Course] Triggering transcription for job ${job._id} (course: ${job.courseId}, publicId: ${publicId})`
  );

  try {
    await triggerTranscription(publicId);
    logger.info(`[SubtitleWorker] [Course] Transcription requested for job ${job._id}`);
  } catch (error: any) {
    const rawMessage =
      String(error?.error?.message || error?.message || "").trim() || "Cloudinary request failed";
    const httpCode = Number(error?.http_code || error?.error?.http_code || 0) || 0;
    const lower = rawMessage.toLowerCase();

    const quotaExceeded =
      httpCode === 420 ||
      lower.includes("rate limit exceeded") ||
      (lower.includes("limit of") && lower.includes("transcription"));

    logger.error(
      `[SubtitleWorker] [Course] Failed for job ${job._id}: ${rawMessage} (HTTP ${httpCode})`
    );

    const updateFields = {
      subtitle_status: "failed" as const,
      subtitle_failure_reason: quotaExceeded ? `Quota exceeded: ${rawMessage}` : rawMessage,
      retryable: true,
    };

    await CourseSubtitleJob.findByIdAndUpdate(job._id, {
      $set: updateFields,
    });

    try {
      await Course.updateOne(
        { _id: job.courseId },
        {
          $set: {
            "chapters.$[].lessons.$[].videos.$[vid].subtitle_status": "failed",
            "chapters.$[].lessons.$[].videos.$[vid].subtitle_failure_reason": updateFields.subtitle_failure_reason,
            "chapters.$[].lessons.$[].videos.$[vid].retryable": updateFields.retryable,
          },
        },
        { arrayFilters: [{ "vid.cloudinaryId": publicId }] }
      );
    } catch (e) {}
  }

  return true;
}

/* ─────────────────────────────────────────────
 * Main poll tick — process one from either queue
 * ───────────────────────────────────────────── */

async function pollTick(): Promise<void> {
  try {
    // Try short-videos first, then course jobs
    const didShort = await processPendingShortVideo();
    if (!didShort) {
      await processPendingCourseJob();
    }
  } catch (error) {
    logger.error("[SubtitleWorker] Unexpected error in poll tick:", error);
  }
}

/* ─────────────────────────────────────────────
 * Public API — start the worker
 * ───────────────────────────────────────────── */

export function startCaptionWorker(): void {
  logger.info("[SubtitleWorker] Starting subtitle polling worker (interval: 60s)");

  // Reset stale jobs from previous crash
  resetStaleShortVideos().catch((err) => {
    logger.error("[SubtitleWorker] Startup reset (short-videos) failed:", err);
  });
  resetStaleCourseJobs().catch((err) => {
    logger.error("[SubtitleWorker] Startup reset (course-jobs) failed:", err);
  });

  // Poll every 60 seconds
  setInterval(() => {
    pollTick().catch((err) => {
      logger.error("[SubtitleWorker] Poll tick error:", err);
    });
  }, POLL_INTERVAL_MS);

  // Immediate first tick
  pollTick().catch((err) => {
    logger.error("[SubtitleWorker] Initial tick error:", err);
  });
}
