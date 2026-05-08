import express from "express";
import { writeLimiter } from "@/utils/rate-limiter";
import { resourceUpload } from "@/utils/multer";
import {
  createShortVideoShell,
  getSignedUploadUrl,
  publishShortVideo,
  getShortVideoUploadStatus,
} from "@/controllers/content-management/short-videos-v1";
import { uploadShortVideoThumbnail } from "@/controllers/content-management/short-videos";

const shortVideosV1Router = express.Router();

shortVideosV1Router.post("/v1/short-videos", createShortVideoShell);
shortVideosV1Router.post("/v1/short-videos/:id/signed-upload-url", getSignedUploadUrl);
shortVideosV1Router.get("/v1/short-videos/:id/status", getShortVideoUploadStatus);
shortVideosV1Router.post("/v1/short-videos/:id/publish", publishShortVideo);
shortVideosV1Router.post("/v1/short-videos/:id/thumbnail", writeLimiter, resourceUpload.single("thumbnail"), uploadShortVideoThumbnail);

export default shortVideosV1Router;
