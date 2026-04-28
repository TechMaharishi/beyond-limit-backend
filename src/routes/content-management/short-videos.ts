import express from "express";
import { writeLimiter } from "@/utils/rate-limiter";
import {
  createShortVideo,
  deleteShortVideo,
  removeShortVideoFile,
  updateShortVideo,
  listShortVideosForManagement,
  getShortVideoById,
  trackShortVideoProgress,
  getShortVideoProgress,
  listPublishedShortVideos,
  updateShortVideoStatus,
  addShortVideoResource,
  removeShortVideoResource,
} from "@/controllers/content-management/short-videos";
import { retryCaptions } from "@/controllers/content-management/retryCaptions";

const router = express.Router();

// ── Read routes (no rate limit) ──────────────────────────────────────────────
router.get("/short-videos", listShortVideosForManagement);
router.get("/short-videos/published-videos", listPublishedShortVideos);
router.get("/short-videos/:id", getShortVideoById);
router.get("/short-videos/:id/progress", getShortVideoProgress);

// ── Write routes (rate limited) ──────────────────────────────────────────────
router.post("/short-videos", writeLimiter, createShortVideo);
router.put("/short-videos/:id", writeLimiter, updateShortVideo);
router.delete("/short-videos/:id", writeLimiter, deleteShortVideo);
router.delete("/short-videos/:id/video", writeLimiter, removeShortVideoFile);
router.post("/short-videos/:id/progress", writeLimiter, trackShortVideoProgress);
router.put("/admin/change-status-short-video/:id", writeLimiter, updateShortVideoStatus);

// ── Resource management ──────────────────────────────────────────────────────
router.post("/short-videos/:id/resources", writeLimiter, addShortVideoResource);
router.delete("/short-videos/:id/resources/:resourceId", writeLimiter, removeShortVideoResource);

// ── Subtitle retry ───────────────────────────────────────────────────────────
router.post("/short-videos/:id/retry-subtitles", writeLimiter, retryCaptions);

export default router;
