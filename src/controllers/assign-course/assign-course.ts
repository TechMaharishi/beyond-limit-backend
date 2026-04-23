import { Request, Response, NextFunction } from "express";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendSuccess, sendError } from "@/utils/api-response";
import { Course } from "@/models/course-videos";
import { LessonVideoProgress } from "@/models/lesson-video-progress";
import { CourseAssignment } from "@/models/course-assignment";
import { QuizResponse } from "@/models/quiz-responses";
import admin from "@/config/firebase";
import { DeviceToken } from "@/models/device-token";
import { Notification } from "@/models/notification";
import { sendLearningAssignmentEmail } from "@/utils/mailer";

const computeProgressSummaryForUserCourses = async (
  userId: string,
  courseIds: string[]
) => {
  const progressDocs = await LessonVideoProgress.find({
    userId,
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

  return watchedByCourse;
};

export const assignCourse = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { assignCourse: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canCreate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const role = (user as any).role;
    const isTrainer = Array.isArray(role) ? role.includes("trainer") : role === "trainer";
    const isTrainee = Array.isArray(role) ? role.includes("trainee") : role === "trainee";
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    if (!isTrainer && !isTrainee && !isAdmin) return sendError(res, 403, "Forbidden: only trainers, trainees, or admins can assign courses");

    // Use a single body shape for unified API
    const { userId, courseId } = req.body as { userId?: string; courseId?: string };
    if (!userId || !courseId) return sendError(res, 400, "userId and courseId are required");

    const course = await Course.findById(courseId).select("status title");
    if (!course) return sendError(res, 404, "Course not found");
    if ((course as any).status !== "published") return sendError(res, 403, "Course must be published to assign");

    const assignedByRole = isTrainer ? "trainer" : isTrainee ? "trainee" : "admin"; // trainers -> trainees, trainees -> users, admin -> trainees/users

    // Validate target user's role based on caller role
    const result = await auth.api.listUsers({
      query: {
        filterField: "id",
        filterValue: userId,
        limit: 1,
        offset: 0,
        sortBy: "createdAt",
        sortDirection: "desc",
      },
      headers: fromNodeHeaders(req.headers),
    });
    const targetUser = (result as any)?.users?.[0];
    if (!targetUser) return sendError(res, 404, "Assignee user not found");
    const targetRole = (targetUser as any).role;
    const isTargetTrainee = Array.isArray(targetRole) ? targetRole.includes("trainee") : targetRole === "trainee";
    const isTargetUser = Array.isArray(targetRole) ? targetRole.includes("user") : targetRole === "user";

    if (isAdmin) {
      if (!(isTargetTrainee || isTargetUser)) {
        return sendError(res, 403, "Admins can assign only to trainees or users");
      }
    } else if (isTrainer) {
      if (!(isTargetTrainee || isTargetUser)) {
        return sendError(res, 403, "Trainers can assign only to trainees or users");
      }
    } else if (isTrainee) {
      if (!isTargetUser) {
        return sendError(res, 403, "Trainees can assign only to users");
      }
    } else {
      return sendError(res, 403, "Forbidden: only trainers, trainees, or admins can assign courses");
    }

    await CourseAssignment.updateOne(
      { assignedToId: userId, courseId, assignedByRole },
      {
        $setOnInsert: {
          assignedToId: userId,
          courseId,
          assignedById: (user as any).id,
          assignedByRole,
          assignedByName: (user as any).name || "",
        },
      },
      { upsert: true }
    );

    try {
      const tokenDoc = await DeviceToken.findOne({ userId }).lean();
      const title = "New learning assigned";
      const body = `New learning assigned by ${String((user as any).name || "Unknown")}`;
      if (tokenDoc?.deviceToken) {
        const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
        if (isExpo) {
          const expoMessage = { to: tokenDoc.deviceToken, sound: "default", title, body };
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify(expoMessage),
          });
        } else {
          const fcmMessage = {
            token: tokenDoc.deviceToken,
            notification: { title, body },
            data: { _id: String(courseId), event: "course-assigned" },
          } as any;
          await admin.messaging().send(fcmMessage);
        }
      }
      try {
        await Notification.create({
          userId,
          title,
          body,
          data: { _id: String(courseId), event: "course-assigned" },
          read: false,
        });
      } catch {}
    } catch {}

    try {
      const resultUser = await auth.api.listUsers({
        query: {
          filterField: "id",
          filterValue: userId,
          limit: 1,
          offset: 0,
          sortBy: "createdAt",
          sortDirection: "desc",
        },
        headers: fromNodeHeaders(req.headers),
      });
      const targetUser = (resultUser as any)?.users?.[0];
      const targetEmail = String((targetUser as any)?.email || "");
      const targetName = String((targetUser as any)?.name || "");
      await sendLearningAssignmentEmail({
        to: targetEmail,
        firstName: targetName,
        learningTitle: String((course as any)?.title || ""),
        assignedByName: String((user as any)?.name || ""),
      });
    } catch {}

    const msg = isTargetTrainee ? "Course assigned to trainee" : isTargetUser ? "Course assigned to user" : "Course assignment created";
    return sendSuccess(res, 201, msg);
  } catch (error) {
    next(error);
  }
};

export const unassignCourse = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canDelete = await auth.api.userHasPermission({
      body: { permissions: { assignCourse: ["delete"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canDelete?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const role = (user as any).role;
    const isTrainer = Array.isArray(role) ? role.includes("trainer") : role === "trainer";
    const isTrainee = Array.isArray(role) ? role.includes("trainee") : role === "trainee";
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";

    const { userId, courseId } = req.body as { userId?: string; courseId?: string };
    if (!userId || !courseId) return sendError(res, 400, "userId and courseId are required");

    const course = await Course.findById(courseId).select("title");
    if (!course) return sendError(res, 404, "Course not found");

    let deletedCount = 0;
    if (isAdmin) {
      const result = await CourseAssignment.deleteMany({ assignedToId: userId, courseId });
      deletedCount = result.deletedCount || 0;
    } else {
      const assignedByRole = isTrainer ? "trainer" : "trainee";
      const result = await CourseAssignment.deleteOne({
        assignedToId: userId,
        courseId,
        assignedById: (user as any).id,
        assignedByRole,
      });
      deletedCount = result.deletedCount || 0;
    }

    if (deletedCount === 0) {
      return sendError(res, 404, "No assignment found to unassign");
    }

    

    return sendSuccess(res, 200, "Course unassigned");
  } catch (error) {
    next(error);
  }
};

export const getAssignedCoursesForAssignee = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { assignCourse: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const role = (user as any).role;
    const isTrainer = Array.isArray(role) ? role.includes("trainer") : role === "trainer";
    const isTrainee = Array.isArray(role) ? role.includes("trainee") : role === "trainee";
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    if (!isTrainer && !isTrainee && !isAdmin) return sendError(res, 403, "Forbidden: only trainers, trainees, or admins can view assignments");

    const { userId } = req.params as { userId: string };
    const assigneeId = userId;
    const rawLimit = Number(req.query.limit);
    const rawPage = Number(req.query.page);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const offset = (page - 1) * limit;

    const assignedByRoleFilter: any = isAdmin ? { $in: ["trainer", "trainee", "admin"] } : (isTrainer ? "trainer" : "trainee");

    const assignments = await CourseAssignment.find({ assignedToId: assigneeId, assignedByRole: assignedByRoleFilter })
      .sort({ createdAt: -1 })
      .lean();

    const courseIds = assignments.map((a: any) => String((a as any).courseId));
    const courses = await Course.find({ _id: { $in: courseIds } })
      .select("title description thumbnailUrl tags status accessLevel createdAt updatedAt user createdBy totalDurationSeconds totalQuizzes chapters")
      .lean();

    const courseMap = new Map<string, any>(courses.map((c: any) => [String((c as any)._id), c]));
    const watchedByCourse = await computeProgressSummaryForUserCourses(assigneeId, courseIds);

    const quizResponseDocs = await QuizResponse.find({
      userId: assigneeId,
      courseId: { $in: courseIds },
    })
      .sort({ createdAt: -1 })
      .lean();

    const latestAnswersByCourseChapter = new Map<string, Map<string, Map<number, true>>>();
    for (const resp of quizResponseDocs) {
      const cId = String((resp as any).courseId);
      const chId = String((resp as any).chapterId);
      let chMapByCourse = latestAnswersByCourseChapter.get(cId);
      if (!chMapByCourse) {
        chMapByCourse = new Map();
        latestAnswersByCourseChapter.set(cId, chMapByCourse);
      }
      let qSet = chMapByCourse.get(chId);
      if (!qSet) {
        qSet = new Map<number, true>();
        chMapByCourse.set(chId, qSet);
      }
      const ansArr = Array.isArray((resp as any)?.answers) ? (resp as any).answers : [];
      for (const a of ansArr) {
        const qIdx = Number((a as any).questionIndex);
        if (!qSet.has(qIdx)) qSet.set(qIdx, true);
      }
    }

    const merged = assignments.map((a: any) => {
      const cid = String((a as any).courseId);
      const course = courseMap.get(cid);
      const chapters = Array.isArray((course as any)?.chapters) ? (course as any).chapters : [];
      const lessonDurationSeconds = chapters.reduce((sum: number, ch: any) => {
        const lessons = Array.isArray(ch?.lessons) ? ch.lessons : [];
        return sum + lessons.reduce((lsSum: number, ls: any) => {
          const videos = Array.isArray(ls?.videos) ? ls.videos : [];
          return lsSum + videos.reduce((acc: number, v: any) => acc + (Number(v?.durationSeconds) || 0), 0);
        }, 0);
      }, 0);
      const watchedRaw = watchedByCourse.get(cid) || 0;
      const watchedSeconds = lessonDurationSeconds > 0 ? Math.min(watchedRaw, lessonDurationSeconds) : watchedRaw;
      const lessonsPercentWatchedRaw = lessonDurationSeconds > 0 ? Math.min((watchedSeconds / lessonDurationSeconds) * 100, 100) : 0;

      let totalQuestions = 0;
      let attemptedQuestions = 0;
      for (const ch of chapters) {
        const quizObj = Array.isArray(ch?.quizzes) && ch.quizzes.length > 0 ? ch.quizzes[0] : null;
        const questions = Array.isArray(quizObj?.questions) ? quizObj.questions : [];
        totalQuestions += questions.length;
        const chMapByCourse = latestAnswersByCourseChapter.get(cid);
        const qSet = chMapByCourse ? chMapByCourse.get(String(ch?._id)) : undefined;
        attemptedQuestions += qSet ? qSet.size : 0;
      }
      const quizAttemptedPercent = totalQuestions > 0 ? Number(((attemptedQuestions / totalQuestions) * 100).toFixed(2)) : 0;

      const hasLessons = lessonDurationSeconds > 0;
      const hasQuiz = totalQuestions > 0;
      let percentCompletedRaw: number;
      if (hasLessons && hasQuiz) percentCompletedRaw = (lessonsPercentWatchedRaw + quizAttemptedPercent) / 2;
      else if (hasLessons) percentCompletedRaw = lessonsPercentWatchedRaw;
      else if (hasQuiz) percentCompletedRaw = quizAttemptedPercent;
      else percentCompletedRaw = 0;
      const percentCompleted = Number(Math.min(percentCompletedRaw, 100).toFixed(2));
      const completed = percentCompleted >= 90;
      const courseSafe = course
        ? {
            _id: (course as any)._id,
            title: (course as any).title,
            description: (course as any).description,
            thumbnailUrl: (course as any).thumbnailUrl,
            tags: (course as any).tags,
            status: (course as any).status,
            accessLevel: (course as any).accessLevel,
            createdAt: (course as any).createdAt,
            updatedAt: (course as any).updatedAt,
            user: (course as any).user,
          }
        : null;
      return {
        course: courseSafe,
        assignedBy: {
          id: String((a as any).assignedById),
          name: String((a as any).assignedByName || ""),
          role: String((a as any).assignedByRole || ""),
        },
        assignedAt: (a as any).createdAt,
        progressSummary: {
          percentCompleted,
          completed,
        },
      };
    });

    const total = merged.length;
    const data = merged.slice(offset, offset + limit);
    const hasNext = offset + data.length < total;

    const msg = isTrainer
      ? "Assigned courses for trainee fetched"
      : isTrainee
      ? "Assigned courses for user fetched"
      : "Assigned courses for assignee fetched";
    return sendSuccess(res, 200, msg, data, { page, offset, limit, total, hasNext });
  } catch (error) {
    next(error);
  }
};

export const getMyAssignedCourses = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { assignCourse: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const role = (user as any).role;
    const isTrainee = Array.isArray(role) ? role.includes("trainee") : role === "trainee";
    const isUserRole = Array.isArray(role) ? role.includes("user") : role === "user";

    const rawLimit = Number(req.query.limit);
    const rawPage = Number(req.query.page);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const offset = (page - 1) * limit;

    // If neither trainee nor user, there's nothing to show
    if (!isTrainee && !isUserRole) {
      return sendSuccess(res, 200, "No assignments", [], { page, offset, limit, total: 0, hasNext: false });
    }

    const assignedByRoleFilter = isTrainee ? { $in: ["trainer", "admin"] } : { $in: ["trainer", "trainee", "admin"] };
    const assignments = await CourseAssignment.find({ assignedToId: (user as any).id, assignedByRole: assignedByRoleFilter })
      .sort({ createdAt: -1 })
      .lean();

    const courseIds = assignments.map((a: any) => String((a as any).courseId));
    const courses = await Course.find({ _id: { $in: courseIds } })
      .select("title description thumbnailUrl tags status accessLevel createdAt updatedAt user createdBy totalDurationSeconds totalQuizzes chapters")
      .lean();

    const courseMap = new Map<string, any>(courses.map((c: any) => [String((c as any)._id), c]));
    const watchedByCourse = await computeProgressSummaryForUserCourses((user as any).id, courseIds);

    const quizResponseDocs = await QuizResponse.find({
      userId: (user as any).id,
      courseId: { $in: courseIds },
    })
      .sort({ createdAt: -1 })
      .lean();

    const latestAnswersByCourseChapter = new Map<string, Map<string, Map<number, true>>>();
    for (const resp of quizResponseDocs) {
      const cId = String((resp as any).courseId);
      const chId = String((resp as any).chapterId);
      let chMapByCourse = latestAnswersByCourseChapter.get(cId);
      if (!chMapByCourse) {
        chMapByCourse = new Map();
        latestAnswersByCourseChapter.set(cId, chMapByCourse);
      }
      let qSet = chMapByCourse.get(chId);
      if (!qSet) {
        qSet = new Map<number, true>();
        chMapByCourse.set(chId, qSet);
      }
      const ansArr = Array.isArray((resp as any)?.answers) ? (resp as any).answers : [];
      for (const a of ansArr) {
        const qIdx = Number((a as any).questionIndex);
        if (!qSet.has(qIdx)) qSet.set(qIdx, true);
      }
    }

    const merged = assignments.map((a: any) => {
      const cid = String((a as any).courseId);
      const course = courseMap.get(cid);
      const chapters = Array.isArray((course as any)?.chapters) ? (course as any).chapters : [];
      const lessonDurationSeconds = chapters.reduce((sum: number, ch: any) => {
        const lessons = Array.isArray(ch?.lessons) ? ch.lessons : [];
        return sum + lessons.reduce((lsSum: number, ls: any) => {
          const videos = Array.isArray(ls?.videos) ? ls.videos : [];
          return lsSum + videos.reduce((acc: number, v: any) => acc + (Number(v?.durationSeconds) || 0), 0);
        }, 0);
      }, 0);
      const watchedRaw = watchedByCourse.get(cid) || 0;
      const watchedSeconds = lessonDurationSeconds > 0 ? Math.min(watchedRaw, lessonDurationSeconds) : watchedRaw;
      const lessonsPercentWatchedRaw = lessonDurationSeconds > 0 ? Math.min((watchedSeconds / lessonDurationSeconds) * 100, 100) : 0;

      let totalQuestions = 0;
      let attemptedQuestions = 0;
      for (const ch of chapters) {
        const quizObj = Array.isArray(ch?.quizzes) && ch.quizzes.length > 0 ? ch.quizzes[0] : null;
        const questions = Array.isArray(quizObj?.questions) ? quizObj.questions : [];
        totalQuestions += questions.length;
        const chMapByCourse = latestAnswersByCourseChapter.get(cid);
        const qSet = chMapByCourse ? chMapByCourse.get(String(ch?._id)) : undefined;
        attemptedQuestions += qSet ? qSet.size : 0;
      }
      const quizAttemptedPercent = totalQuestions > 0 ? Number(((attemptedQuestions / totalQuestions) * 100).toFixed(2)) : 0;

      const hasLessons = lessonDurationSeconds > 0;
      const hasQuiz = totalQuestions > 0;
      let percentCompletedRaw: number;
      if (hasLessons && hasQuiz) percentCompletedRaw = (lessonsPercentWatchedRaw + quizAttemptedPercent) / 2;
      else if (hasLessons) percentCompletedRaw = lessonsPercentWatchedRaw;
      else if (hasQuiz) percentCompletedRaw = quizAttemptedPercent;
      else percentCompletedRaw = 0;
      const percentCompleted = Number(Math.min(percentCompletedRaw, 100).toFixed(2));
      const completed = percentCompleted >= 90;

      const courseSafe = course
        ? {
            _id: String((course as any)._id),
            title: (course as any).title,
            description: (course as any).description || "",
            tags: Array.isArray((course as any).tags) ? (course as any).tags : [],
            status: (course as any).status,
            accessLevel: (course as any).accessLevel || null,
            user: String((course as any).user || ""),
            createdBy: (course as any).createdBy
              ? {
                  _id: String((course as any).createdBy._id || ""),
                  name: (course as any).createdBy.name || "",
                  email: (course as any).createdBy.email || "",
                }
              : null,
            thumbnailUrl: (course as any).thumbnailUrl || "",
            createdAt: (course as any).createdAt || null,
            updatedAt: (course as any).updatedAt || null,
          }
        : null;

      return {
        course: courseSafe,
        assignedBy: {
          id: String((a as any).assignedById),
          name: String((a as any).assignedByName || ""),
          role: String((a as any).assignedByRole || ""),
        },
        assignedAt: (a as any).createdAt,
        progressSummary: {
          percentCompleted,
          completed,
        },
      };
    });

    const total = merged.length;
    const data = merged.slice(offset, offset + limit);
    const hasNext = offset + data.length < total;

    return sendSuccess(res, 200, "My assigned courses fetched", data, {
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

export const assignCourseBulk = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { assignCourse: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canCreate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const role = (user as any).role;
    const isTrainer = Array.isArray(role) ? role.includes("trainer") : role === "trainer";
    const isTrainee = Array.isArray(role) ? role.includes("trainee") : role === "trainee";
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    if (!isTrainer && !isTrainee && !isAdmin) return sendError(res, 403, "Forbidden: only trainers, trainees, or admins can assign courses");
    const assignedByRole = isTrainer ? "trainer" : isTrainee ? "trainee" : "admin";

    const body = req.body as any;
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) return sendError(res, 400, "items array is required");
    if (items.length > 200) return sendError(res, 400, "Too many items; max 200");

    const uniqueUserIds = new Set<string>();
    const uniqueCourseIds = new Set<string>();
    for (const it of items) {
      const uid = typeof it?.userId === "string" ? it.userId : "";
      const cid = typeof it?.courseId === "string" ? it.courseId : "";
      if (uid && cid) {
        uniqueUserIds.add(uid);
        uniqueCourseIds.add(cid);
      }
    }
    if (uniqueUserIds.size === 0 || uniqueCourseIds.size === 0) return sendError(res, 400, "items must contain valid userId and courseId");

    const courses = await Course.find({
      _id: { $in: Array.from(uniqueCourseIds) as any },
      status: "published",
    })
      .select("_id title")
      .lean();
    const validCourses = new Set<string>(courses.map((c: any) => String((c as any)._id)));
    const courseTitleById = new Map<string, string>();
    for (const c of courses) {
      courseTitleById.set(String((c as any)?._id), String((c as any)?.title || ""));
    }

    const userInfoById = new Map<string, { role: any; email: string; name: string }>();
    for (const id of Array.from(uniqueUserIds)) {
      try {
        const resUsers = await auth.api.listUsers({
          query: {
            filterField: "id",
            filterValue: id,
            limit: 1,
            offset: 0,
            sortBy: "createdAt",
            sortDirection: "desc",
          },
          headers: fromNodeHeaders(req.headers),
        });
        const u = (resUsers as any)?.users?.[0];
        if (u) {
          userInfoById.set(String((u as any).id), {
            role: (u as any).role,
            email: String((u as any).email || ""),
            name: String((u as any).name || ""),
          });
        }
      } catch {}
    }

    const allowedTargetRoles = isAdmin ? ["trainer", "trainee", "user"] : isTrainer ? ["trainee", "user"] : ["user"];

    const results: Array<{ userId: string; courseId: string; status: string; message?: string }> = [];
    let successCount = 0;
    let failureCount = 0;

    for (const it of items) {
      const userId = String(it?.userId || "");
      const courseId = String(it?.courseId || "");
      if (!userId || !courseId) {
        results.push({ userId, courseId, status: "error", message: "Invalid item" });
        failureCount++;
        continue;
      }
      if (!validCourses.has(courseId)) {
        results.push({ userId, courseId, status: "error", message: "Course not found or not published" });
        failureCount++;
        continue;
      }
      const info = userInfoById.get(userId);
      const userRole = info?.role;
      const targetHasAllowedRole = Array.isArray(userRole) ? (userRole as any[]).some((r: any) => allowedTargetRoles.includes(String(r))) : allowedTargetRoles.includes(String(userRole));
      if (!targetHasAllowedRole) {
        results.push({ userId, courseId, status: "error", message: `Assignee must have role ${allowedTargetRoles.join("/")}` });
        failureCount++;
        continue;
      }
      try {
        const r: any = await CourseAssignment.updateOne(
          { assignedToId: userId, courseId, assignedByRole },
          {
            $setOnInsert: {
              assignedToId: userId,
              courseId,
              assignedById: (user as any).id,
              assignedByRole,
              assignedByName: (user as any).name || "",
            },
          },
          { upsert: true }
        );
        const inserted = typeof r?.upsertedCount === "number" ? r.upsertedCount > 0 : Boolean((r as any)?.upsertedId);
        if (inserted) {
          try {
            const tokenDoc = await DeviceToken.findOne({ userId }).lean();
            const title = "New learning assigned";
            const body = `New learning assigned by ${String((user as any).name || "Unknown")}`;
            if (tokenDoc?.deviceToken) {
              const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
              if (isExpo) {
                const expoMessage = { to: tokenDoc.deviceToken, sound: "default", title, body };
                await fetch("https://exp.host/--/api/v2/push/send", {
                  method: "POST",
                  headers: { Accept: "application/json", "Content-Type": "application/json" },
                  body: JSON.stringify(expoMessage),
                });
              } else {
                const fcmMessage = {
                  token: tokenDoc.deviceToken,
                  notification: { title, body },
                  data: { _id: String(courseId), event: "course-assigned" },
                } as any;
                await admin.messaging().send(fcmMessage);
              }
            }
            try {
              await Notification.create({
                userId,
                title,
                body,
                data: { _id: String(courseId), event: "course-assigned" },
                read: false,
              });
            } catch {}
          } catch {}
          try {
            const targetEmail = String(info?.email || "");
            const targetName = String(info?.name || "");
            await sendLearningAssignmentEmail({
              to: targetEmail,
              firstName: targetName,
              learningTitle: String(courseTitleById.get(courseId) || ""),
              assignedByName: String((user as any)?.name || ""),
            });
          } catch {}
          results.push({ userId, courseId, status: "assigned" });
          successCount++;
        } else {
          results.push({ userId, courseId, status: "alreadyAssigned" });
          successCount++;
        }
      } catch (e: any) {
        results.push({ userId, courseId, status: "error", message: String(e?.message || "Assignment failed") });
        failureCount++;
      }
    }

    return sendSuccess(res, 201, "Bulk assignment processed", {
      successes: successCount,
      failures: failureCount,
      results,
    });
  } catch (error) {
    next(error);
  }
};
