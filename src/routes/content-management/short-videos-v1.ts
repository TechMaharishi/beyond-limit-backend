/**
 * Short Videos V1 Routes
 *
 * Mounted at /api in app.ts → final paths are /api/v1/short-videos/...
 *
 * These routes implement the two-phase upload flow and do NOT replace the
 * existing /api/short-videos routes which remain unchanged.
 */

import express from "express";
import {
  createShortVideoShell,
  getSignedUploadUrl,
  publishShortVideo,
  getShortVideoUploadStatus,
} from "@/controllers/content-management/short-videos-v1";

const shortVideosV1Router = express.Router();

// Phase 1 — create shell (draft, no video yet)
shortVideosV1Router.post("/v1/short-videos", createShortVideoShell);

// Phase 1 — get signed Cloudinary upload URL for a specific shell
shortVideosV1Router.post("/v1/short-videos/:id/signed-upload-url", getSignedUploadUrl);

// Lightweight status poll — frontend checks when video is ready after upload
shortVideosV1Router.get("/v1/short-videos/:id/status", getShortVideoUploadStatus);

// Phase 2 — publish once video is uploaded and ready
shortVideosV1Router.post("/v1/short-videos/:id/publish", publishShortVideo);

export default shortVideosV1Router;
