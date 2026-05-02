import express from "express";
import { writeLimiter } from "@/utils/rate-limiter";
import {
  createShortAssignment,
  deleteShortAssignment,
  deleteShortAssignmentsBulk,
  listShortAssignmentsForUser,
  listMyShortAssignments,
  listShortAssignmentsByMe,
  createShortAssignmentsBulk,
} from "@/controllers/content-assign/assign-shorts";

const router = express.Router();

router.post("/assign-shorts", writeLimiter, createShortAssignment);
router.post("/assign-shorts/bulk", writeLimiter, createShortAssignmentsBulk);
router.delete("/assign-shorts", writeLimiter, deleteShortAssignment);
router.delete("/assign-shorts/bulk", writeLimiter, deleteShortAssignmentsBulk);
router.get("/assign-shorts/me", listMyShortAssignments);
router.get("/assign-shorts/assigned-by-me", listShortAssignmentsByMe);
router.get("/assign-shorts/assignees/:userId", listShortAssignmentsForUser);

export default router;
