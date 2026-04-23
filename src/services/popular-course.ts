import mongoose from "mongoose";
import { Course } from "@/models/course-videos";
import { SavedCourse } from "@/models/saved-course";
import { LessonVideoProgress } from "@/models/lesson-video-progress";
import { CoursePopularity } from "@/models/popular-course";

export async function recomputePopularCoursesAllService(): Promise<void> {
  const courses = await Course.find({ status: "published" })
    .select("createdAt totalDurationSeconds totalQuizzes")
    .lean();
  const courseIds = courses.map((c: any) => String(c._id));
  const courseMap = new Map(courseIds.map((id, i) => [id, courses[i]]));

  const savedAgg = await SavedCourse.aggregate([
    { $match: { courseId: { $in: courseIds } } },
    { $group: { _id: "$courseId", savedCount: { $sum: 1 } } },
  ]);

  const progressAgg = await LessonVideoProgress.aggregate([
    { $match: { courseId: { $in: courseIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
    { $group: { _id: { courseId: "$courseId", userId: "$userId" }, watchedSeconds: { $sum: "$watchedSeconds" } } },
  ]);

  const perCourse: Record<string, { uniqueWatchers: number; totalWatchedSeconds: number; completionCount: number }> = {};
  for (const p of progressAgg) {
    const courseId = String((p as any)._id.courseId);
    const watched = Number((p as any).watchedSeconds) || 0;
    const entry = perCourse[courseId] || { uniqueWatchers: 0, totalWatchedSeconds: 0, completionCount: 0 };
    entry.uniqueWatchers += 1;
    entry.totalWatchedSeconds += watched;

    const course = courseMap.get(courseId);
    const videoDurationSeconds = Math.max(Number(course?.totalDurationSeconds || 0) - Number(course?.totalQuizzes || 0) * 30, 0);
    if (videoDurationSeconds > 0 && watched >= videoDurationSeconds) {
      entry.completionCount += 1;
    }
    perCourse[courseId] = entry;
  }

  const savedMap = new Map(savedAgg.map((d: any) => [String(d._id), Number(d.savedCount) || 0]));

  const w = { saved: 3, watchers: 2, watch: 1, complete: 4 };
  const halfLifeDays = 14;

  const ops = courseIds.map((cid) => {
    const savedCount = savedMap.get(cid) || 0;
    const stats = perCourse[cid] || { uniqueWatchers: 0, totalWatchedSeconds: 0, completionCount: 0 };
    const course = courseMap.get(cid);
    const ageDays = Math.max(1, Math.floor((Date.now() - new Date(course?.createdAt || Date.now()).getTime()) / (24 * 60 * 60 * 1000)));
    const decay = 1 / (1 + ageDays / halfLifeDays);
    const videoDurationSeconds = Math.max(Number(course?.totalDurationSeconds || 0) - Number(course?.totalQuizzes || 0) * 30, 0);

    const score =
      w.saved * savedCount +
      w.watchers * stats.uniqueWatchers +
      w.watch * (videoDurationSeconds > 0 ? stats.totalWatchedSeconds / videoDurationSeconds : 0) +
      w.complete * stats.completionCount;

    return {
      updateOne: {
        filter: { courseId: new mongoose.Types.ObjectId(cid), window: "all" as const },
        update: {
          $set: {
            score: Number((score * decay).toFixed(4)),
            savedCount,
            uniqueWatchers: stats.uniqueWatchers,
            totalWatchedSeconds: stats.totalWatchedSeconds,
            completionCount: stats.completionCount,
            computedAt: new Date(),
          },
        },
        upsert: true,
      },
    };
  });

  if (ops.length > 0) {
    await CoursePopularity.bulkWrite(ops);
  }
}
