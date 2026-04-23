import express from "express";
import {
  assignShort,
  unassignShort,
  getAssignedShortsForAssignee,
  getMyAssignedShorts,
  assignShortsBulk,
} from "@/controllers/assign-shorts/assign-shorts";

const router = express.Router();

router.post("/assign-shorts", assignShort);
router.post("/assign-shorts/bulk", assignShortsBulk);
router.delete("/assign-shorts", unassignShort);
router.get("/assign-shorts/me", getMyAssignedShorts);
router.get("/assign-shorts/assignees/:userId", getAssignedShortsForAssignee);

export default router;
