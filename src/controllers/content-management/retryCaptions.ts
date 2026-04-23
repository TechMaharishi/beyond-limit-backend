/**
 * Retry Subtitles Controller
 *
 * POST /api/short-videos/:id/retry-subtitles
 *
 * Allows an admin to reset a failed or incomplete subtitle-transcription 
 * process back to "pending" so the polling worker picks it up again.
 */

import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { ShortVideo } from "@/models/short-videos";
import { sendSuccess, sendError } from "@/utils/api-response";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import logger from "@/utils/logger";

export const retryCaptions = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid video ID format");
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

    // Find the video
    const video = await ShortVideo.findById(id);
    if (!video) {
      return sendError(res, 404, "Short video not found");
    }

    // Verify the status allows a retry (failed or completed)
    const subtitleStatus = (video as any).subtitle_status;
    if (subtitleStatus === "processing") {
      return sendError(
        res,
        400,
        `Cannot retry: subtitle is currently being processed. Wait for it to complete or fail.`
      );
    }

    // Reset to "pending" so the polling worker will pick it up
    await ShortVideo.findByIdAndUpdate(id, {
      $set: {
        subtitle_status: "pending",
        subtitle_failure_reason: null,
        retryable: false,
        // Manual retry — process on next worker tick, no delay
        not_before: new Date(),
      },
    });

    logger.info(
      `[RetrySubtitles] Admin ${user.id} reset subtitle for video ${id} to pending`
    );

    return sendSuccess(res, 200, "Subtitle retry queued — the worker will process it shortly", {
      videoId: id,
      subtitle_status: "pending",
    });
  } catch (error) {
    next(error);
  }
};
