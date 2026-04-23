import express from "express";
import {
  createShortVideo,
  deleteShortVideo,
  deleteShortVideoFile,
  updateShortVideo,
  getAllShortVideos,
  getShortVideo,
  updateShortVideoProgress,
  getShortVideoProgress,
  createTag,
  getTag,
  getAllShortVideoByUser,
  changeShortVideoStatus,
  deactivateTag,
  activateTag,
  deleteTag,
} from "@/controllers/content-management/short-videos";
import { retryCaptions } from "@/controllers/content-management/retryCaptions";

const router = express.Router();

router.post("/short-videos", createShortVideo);
router.get("/short-videos", getAllShortVideos);
router.get("/short-videos/published-videos", getAllShortVideoByUser);
router.post("/admin/create-tags", createTag);
router.get("/admin/tags", getTag);
router.put("/admin/tags/:id/deactivate", deactivateTag);
router.put("/admin/tags/:id/activate", activateTag);
router.delete("/admin/tags/:id", deleteTag);

router.get("/short-videos/:id", getShortVideo);
router.post("/short-videos/:id/progress", updateShortVideoProgress);
router.get("/short-videos/:id/progress", getShortVideoProgress);
router.delete("/short-videos/:id", deleteShortVideo);
router.put("/short-videos/:id", updateShortVideo);
router.delete("/short-videos/:id/video", deleteShortVideoFile);
router.put("/admin/change-status-short-video/:id", changeShortVideoStatus);

// Subtitle retry endpoint — resets a failed subtitle back to pending for the worker
router.post("/short-videos/:id/retry-subtitles", retryCaptions);

export default router;
