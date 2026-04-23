import { Request, Response, NextFunction } from "express";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendSuccess, sendError } from "@/utils/api-response";
import { Course } from "@/models/course-videos";
import { LessonVideoProgress } from "@/models/lesson-video-progress";
import { CoursePopularity } from "@/models/popular-course";
import { SavedCourse } from "@/models/saved-course";
import { recomputePopularCoursesAllService } from "@/services/popular-course";
import { buildVisibilityFilterForRole } from "@/services/visibility";

// Recompute all-time popularity for all published courses
export const recomputePopularCoursesAll = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    await recomputePopularCoursesAllService();
    return sendSuccess(res, 200, "Popular courses recomputed (all-time)");
  } catch (error) {
    next(error);
  }
};

// Fetch popular courses (all-time), including current user's progressSummary
export const getPopularCoursesAll = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permission: { course: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const rawLimit = Number(req.query.limit);
    const rawPage = Number(req.query.page);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const offset = (page - 1) * limit;

    const popDocs = await CoursePopularity.find({ window: "all" })
      .sort({ score: -1, computedAt: -1 })
      .lean();

    const courseIds = popDocs.map((p: any) => String((p as any).courseId));
    const visFilter = buildVisibilityFilterForRole((user as any).role);
    const courses = await Course.find({ _id: { $in: courseIds }, status: "published", ...(visFilter as any) })
      .select("title description thumbnailUrl tags status accessLevel visibility createdAt updatedAt user totalDurationSeconds totalQuizzes createdBy")
      .lean();

    const popMap = new Map(popDocs.map((p: any) => [String((p as any).courseId), p]));
    const merged = courses.map((c: any) => ({ ...c, popularity: popMap.get(String((c as any)._id)) }));
    const orderMap = new Map<string, number>(courseIds.map((id: string, i: number) => [id, i] as [string, number]));
    const ordered = merged.sort(
      (a: any, b: any) =>
        (orderMap.get(String((b as any)._id)) ?? 0) - (orderMap.get(String((a as any)._id)) ?? 0)
    );

    // ProgressSummary for current user
    const progressDocs = await LessonVideoProgress.find({
      userId: (user as any).id,
      courseId: { $in: courseIds },
    })
      .select("courseId watchedSeconds")
      .lean();

    const watchedByCourse = new Map<string, number>();
    for (const p of progressDocs) {
      const key = String((p as any).courseId);
      const cur = watchedByCourse.get(key) || 0;
      watchedByCourse.set(key, cur + (Number((p as any).watchedSeconds) || 0));
    }

    const savedDocs = await SavedCourse.find({
      userId: (user as any).id,
      courseId: { $in: courseIds },
    })
      .select("courseId")
      .lean();
    const savedSet = new Set<string>(savedDocs.map((d: any) => String((d as any).courseId)));

    const withProgress = ordered.map((c: any) => {
      const idStr = String((c as any)._id);
      const totalDurationSeconds = Number((c as any).totalDurationSeconds) || 0;
      const totalQuizzes = Number((c as any).totalQuizzes) || 0;
      const videoDurationSeconds = Math.max(totalDurationSeconds - totalQuizzes * 30, 0);
      const watchedRaw = watchedByCourse.get(idStr) || 0;
      const watchedSeconds = videoDurationSeconds > 0 ? Math.min(watchedRaw, videoDurationSeconds) : watchedRaw;
      const percentWatched = videoDurationSeconds > 0 ? Math.min((watchedSeconds / videoDurationSeconds) * 100, 100) : 0;
      const completed = percentWatched >= 90 || (videoDurationSeconds > 0 && watchedSeconds >= videoDurationSeconds);
      return {
        ...c,
        saved: savedSet.has(idStr),
        progressSummary: {
          watchedSeconds,
          percentWatched: Number(percentWatched.toFixed(2)),
          completed,
          durationSeconds: videoDurationSeconds,
        },
      };
    });

    const total = withProgress.length;
    const data = withProgress.slice(offset, offset + limit);
    const hasNext = offset + data.length < total;

    return sendSuccess(res, 200, "Popular courses ", data, {
      page,
      offset,
      limit,
      total,
      hasNext,
    });
  } catch (error) {
    next(error);
  }
};