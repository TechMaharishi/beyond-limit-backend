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
 * Expected format: "short-videos/<mongoId>"
 */
function extractShortVideoId(publicId: string): string | null {
  const match = publicId.match(/^short-videos\/([a-f0-9]{24})$/);
  return match ? match[1] : null;
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

    // Cloudinary upload payload fields
    const rawDuration = Number(body?.duration ?? body?.video?.bit_rate ?? 0);
    const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
    const secureUrl = String(body?.secure_url || "");

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
