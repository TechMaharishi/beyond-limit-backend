import express from "express";
import { writeLimiter } from "@/utils/rate-limiter";
import {
  createCourseAssignment,
  createCourseAssignmentsBulk,
  deleteCourseAssignment,
  deleteCourseAssignmentsBulk,
  listMyCourseAssignments,
  listCourseAssignmentsByMe,
  listCourseAssignmentsForUser,
} from "@/controllers/content-assign/assign-course";

const router = express.Router();

router.post("/assign-course", writeLimiter, createCourseAssignment);
router.post("/assign-course/bulk", writeLimiter, createCourseAssignmentsBulk);
router.delete("/assign-course", writeLimiter, deleteCourseAssignment);
router.delete("/assign-course/bulk", writeLimiter, deleteCourseAssignmentsBulk);
router.get("/assign-course/me", listMyCourseAssignments);
router.get("/assign-course/assigned-by-me", listCourseAssignmentsByMe);
router.get("/assign-course/assignees/:userId", listCourseAssignmentsForUser);

export default router;
