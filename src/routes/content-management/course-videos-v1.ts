import express from "express";
import {
  getSignedCourseVideoUploadUrl,
  getCourseVideoUploadStatus,
} from "@/controllers/content-management/course-videos-v1";

const courseVideosV1Router = express.Router();

courseVideosV1Router.post(
  "/v1/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/signed-upload-url",
  getSignedCourseVideoUploadUrl
);

courseVideosV1Router.get(
  "/v1/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/video-status",
  getCourseVideoUploadStatus
);

export default courseVideosV1Router;
