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

const router = express.Router();

router.post("/courses", upload.single("thumbnail"), createCourseBasic); 
router.get("/courses", getAllCourses);
router.get("/courses/published-videos", getAllCoursesByUser);
router.get("/courses/completed", getCompletedCoursesByUser);
router.get("/courses/saved-course", getSavedCoursesByUser);

router.get("/courses/:id", getCourse);
router.patch("/courses/:id", upload.single("thumbnail"), updateCourse);
router.delete("/courses/:id", deleteCourse);
router.delete("/courses/:id/thumbnail", deleteCourseThumbnail);
router.get("/courses/:id/progress", getCourseWithProgress);
router.post("/courses/:id/save", saveCourseForUser);
router.post("/courses/:id/resources/upload", upload.array("files", 20), uploadCourseResources); 
router.delete("/courses/:id/resources/:resourceIndex", deleteCourseResource);

router.post("/courses/:courseId/chapters", addChapterToCourse);
router.post("/courses/:courseId/chapters/:chapterIndex/lessons", addLessonToChapter);
router.delete("/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex", deleteLessonFromChapter);
router.post("/courses/:courseId/chapters/:chapterIndex/quizzes", addQuizToChapter);
router.delete("/courses/:courseId/chapters/:chapterIndex/quizzes/:quizIndex", deleteQuizFromChapter);
router.patch("/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/video", updateCourseVideo);
router.delete("/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/videos/:videoIndex", deleteLessonVideo);
router.put("/courses/:courseId/chapters/:chapterId/lessons/progress", updateLessonProgress);
router.post("/courses/:courseId/chapters/:chapterId/quiz/responses", submitQuizResponses);
router.delete("/courses/:courseId/chapters/:chapterIndex", deleteChapter);

router.put("/admin/change-status-course/:id", changeCourseStatus);
router.post("/courses/videos-upload", uploadLessonVideo);
router.post("/courses/delete-cloudinary-video", deleteCloudinaryVideo);

// Subtitle retry endpoint for course videos
router.post("/courses/:courseId/retry-subtitles", retryCourseSubtitles);


export default router;
