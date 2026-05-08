import express from "express";
import { getPopularCoursesAll } from "@/controllers/content-management/popular-course";

const router = express.Router();

router.get("/courses/popular-all", getPopularCoursesAll);

export default router;