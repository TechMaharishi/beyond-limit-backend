import express from "express";
import {
  assignCourse,
  assignCourseBulk,
  getAssignedCoursesForAssignee,
  getMyAssignedCourses,
  unassignCourse,
} from "@/controllers/assign-course/assign-course";

const router = express.Router();

router.post("/assign-course", assignCourse);
router.post("/assign-course/bulk", assignCourseBulk);
router.delete("/assign-course", unassignCourse);
router.get("/assign-course/me", getMyAssignedCourses);
router.get("/assign-course/assignees/:userId", getAssignedCoursesForAssignee);


export default router;
