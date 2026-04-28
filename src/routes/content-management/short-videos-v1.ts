/**
 * Short Videos V1 Routes
 */

import express from "express";
import {
  createShortVideoShell,
  getSignedUploadUrl,
  publishShortVideo,
  getShortVideoUploadStatus,
} from "@/controllers/content-management/short-videos-v1";

const shortVideosV1Router = express.Router();

//create shell (draft, no video yet)
shortVideosV1Router.post("/v1/short-videos", createShortVideoShell);

//get signed Cloudinary upload URL for a specific shell
shortVideosV1Router.post("/v1/short-videos/:id/signed-upload-url", getSignedUploadUrl);

// Lightweight status poll — frontend checks when video is ready after upload
shortVideosV1Router.get("/v1/short-videos/:id/status", getShortVideoUploadStatus);

// publish once video is uploaded and ready
shortVideosV1Router.post("/v1/short-videos/:id/publish", publishShortVideo);

export default shortVideosV1Router;
