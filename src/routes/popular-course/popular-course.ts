import express from "express";
import { getPopularCoursesAll } from "@/controllers/popular-course/popular-course";

const router = express.Router();

// Public for authenticated users with 'user' role/permission
router.get("/courses/popular-all", getPopularCoursesAll);

export default router;