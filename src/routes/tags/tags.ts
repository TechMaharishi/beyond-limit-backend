import express from "express";
import {
  createTag,
  getTag,
  deactivateTag,
  activateTag,
  deleteTag,
} from "@/controllers/tags/tags";

const router = express.Router();

router.post("/admin/create-tags", createTag);
router.get("/admin/tags", getTag);
router.put("/admin/tags/:id/deactivate", deactivateTag);
router.put("/admin/tags/:id/activate", activateTag);
router.delete("/admin/tags/:id", deleteTag);

export default router;
