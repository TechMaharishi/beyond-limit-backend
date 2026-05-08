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


shortVideosV1Router.post("/v1/short-videos", createShortVideoShell);
shortVideosV1Router.post("/v1/short-videos/:id/signed-upload-url", getSignedUploadUrl);
shortVideosV1Router.get("/v1/short-videos/:id/status", getShortVideoUploadStatus);
shortVideosV1Router.post("/v1/short-videos/:id/publish", publishShortVideo);

export default shortVideosV1Router;
