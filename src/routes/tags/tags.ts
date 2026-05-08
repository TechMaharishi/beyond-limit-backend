import express from "express";
import {
  createTag,
  getTag,
  deactivateTag,
  activateTag,
  deleteTag,
} from "@/controllers/tags/tags";
import { writeLimiter } from "@/utils/rate-limiter";

const router = express.Router();

router.post("/admin/create-tags", writeLimiter, createTag);
router.get("/admin/tags", getTag);
router.put("/admin/tags/:id/deactivate", writeLimiter, deactivateTag);
router.put("/admin/tags/:id/activate", writeLimiter, activateTag);
router.delete("/admin/tags/:id", writeLimiter, deleteTag);

export default router;
