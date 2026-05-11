import express from "express";
import {
  createCourseBasic,
  addChapterToCourse,
  addLessonToChapter,
  addQuizToChapter,
  deleteQuizFromChapter,
  deleteChapter,
  deleteCourse,
  updateCourseVideo,
  deleteLessonFromChapter,
  getAllCourses,
  getCourse,
  getAllCoursesByUser,
  getCompletedCoursesByUser,
  saveCourseForUser,
  getSavedCoursesByUser,
  changeCourseStatus,
  uploadLessonVideo,
  updateCourse,
  uploadCourseResources,
  deleteCourseResource,
  deleteLessonVideo,
  updateLessonProgress,
  getCourseWithProgress,
  submitQuizResponses,
  deleteCloudinaryVideo,
  deleteCourseThumbnail
} from "@/controllers/content-management/course-videos";
import { retryCourseSubtitles } from "@/controllers/content-management/retryCourseSubtitles";
import { upload } from "@/config/cloudinary";
import { writeLimiter } from "@/utils/rate-limiter";

const router = express.Router();

router.post("/courses", writeLimiter, upload.single("thumbnail"), createCourseBasic);
router.get("/courses", getAllCourses);
router.get("/courses/published-videos", getAllCoursesByUser);
router.get("/courses/completed", getCompletedCoursesByUser);
router.get("/courses/saved-course", getSavedCoursesByUser);

router.get("/courses/:id", getCourse);
router.patch("/courses/:id", writeLimiter, upload.single("thumbnail"), updateCourse);
router.delete("/courses/:id", writeLimiter, deleteCourse);
router.delete("/courses/:id/thumbnail", writeLimiter, deleteCourseThumbnail);
router.get("/courses/:id/progress", getCourseWithProgress);
router.post("/courses/:id/save", writeLimiter, saveCourseForUser);
router.post("/courses/:id/resources/upload", writeLimiter, upload.array("files", 20), uploadCourseResources);
router.delete("/courses/:id/resources/:resourceIndex", writeLimiter, deleteCourseResource);

router.post("/courses/:courseId/chapters", writeLimiter, addChapterToCourse);
router.post("/courses/:courseId/chapters/:chapterIndex/lessons", writeLimiter, addLessonToChapter);
router.delete("/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex", writeLimiter, deleteLessonFromChapter);
router.post("/courses/:courseId/chapters/:chapterIndex/quizzes", writeLimiter, addQuizToChapter);
router.delete("/courses/:courseId/chapters/:chapterIndex/quizzes/:quizIndex", writeLimiter, deleteQuizFromChapter);
router.patch("/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/video", writeLimiter, updateCourseVideo);
router.delete("/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/videos/:videoIndex", writeLimiter, deleteLessonVideo);
router.put("/courses/:courseId/chapters/:chapterId/lessons/progress", writeLimiter, updateLessonProgress);
router.post("/courses/:courseId/chapters/:chapterId/quiz/responses", writeLimiter, submitQuizResponses);
router.delete("/courses/:courseId/chapters/:chapterIndex", writeLimiter, deleteChapter);

router.put("/admin/change-status-course/:id", writeLimiter, changeCourseStatus);
router.post("/courses/videos-upload", writeLimiter, uploadLessonVideo);
router.post("/courses/delete-cloudinary-video", writeLimiter, deleteCloudinaryVideo);

router.post("/courses/:courseId/retry-subtitles", writeLimiter, retryCourseSubtitles);


export default router;
