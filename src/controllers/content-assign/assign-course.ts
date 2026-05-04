import { Request, Response, NextFunction } from "express";
import { isValidObjectId } from "mongoose";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendSuccess, sendError } from "@/utils/api-response";
import { Course } from "@/models/course-videos";
import { LessonVideoProgress } from "@/models/lesson-video-progress";
import { CourseAssignment, CourseAssignerRole } from "@/models/course-assignment";
import { QuizResponse } from "@/models/quiz-responses";
import firebaseAdmin from "@/config/firebase";
import { DeviceToken } from "@/models/device-token";
import { Notification } from "@/models/notification";
import { sendLearningAssignmentEmail } from "@/utils/mailer";

// ─── helpers ────────────────────────────────────────────────────────────────

const MAX_PAGE_SIZE = 100;

function resolveAssignerRole(role: string): CourseAssignerRole {
  if (role === "trainer") return "trainer";
  if (role === "trainee") return "trainee";
  return "admin";
}

function parsePagination(query: Record<string, any>): { limit: number; page: number; offset: number } {
  const rawLimit = Number(query.limit);
  const rawPage = Number(query.page);
  const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10, MAX_PAGE_SIZE);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  return { limit, page, offset: (page - 1) * limit };
}

async function fetchCourseMap(courseIds: string[]): Promise<Map<string, any>> {
  if (courseIds.length === 0) return new Map();
  const unique = [...new Set(courseIds)];
  const courses = await Course.find({ _id: { $in: unique } })
    .select("title description thumbnailUrl tags status accessLevel createdAt updatedAt user createdBy chapters")
    .lean();
  return new Map(courses.map((c: any) => [String(c._id), c]));
}

async function fetchProgressRaw(
  userId: string,
  courseIds: string[]
): Promise<{
  watchedByCourse: Map<string, number>;
  answersByCourseChapter: Map<string, Map<string, Map<number, true>>>;
}> {
  if (courseIds.length === 0) {
    return { watchedByCourse: new Map(), answersByCourseChapter: new Map() };
  }

  const [progressDocs, quizDocs] = await Promise.all([
    LessonVideoProgress.find({ userId, courseId: { $in: courseIds } })
      .select("courseId watchedSeconds")
      .lean(),
    QuizResponse.find({ userId, courseId: { $in: courseIds } })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const watchedByCourse = new Map<string, number>();
  for (const p of progressDocs) {
    const key = String((p as any).courseId);
    watchedByCourse.set(key, (watchedByCourse.get(key) || 0) + (Number((p as any).watchedSeconds) || 0));
  }

  const answersByCourseChapter = new Map<string, Map<string, Map<number, true>>>();
  for (const resp of quizDocs) {
    const cId = String((resp as any).courseId);
    const chId = String((resp as any).chapterId);
    let chMap = answersByCourseChapter.get(cId);
    if (!chMap) { chMap = new Map(); answersByCourseChapter.set(cId, chMap); }
    let qSet = chMap.get(chId);
    if (!qSet) { qSet = new Map<number, true>(); chMap.set(chId, qSet); }
    for (const a of (Array.isArray((resp as any).answers) ? (resp as any).answers : [])) {
      qSet.set(Number((a as any).questionIndex), true);
    }
  }

  return { watchedByCourse, answersByCourseChapter };
}

function computeProgressForCourse(
  cid: string,
  courseData: any,
  watchedByCourse: Map<string, number>,
  answersByCourseChapter: Map<string, Map<string, Map<number, true>>>
): { percentCompleted: number; completed: boolean } {
  const chapters = Array.isArray(courseData?.chapters) ? courseData.chapters : [];

  const lessonDurationSeconds = chapters.reduce((sum: number, ch: any) => {
    const lessons = Array.isArray(ch?.lessons) ? ch.lessons : [];
    return sum + lessons.reduce((lsSum: number, ls: any) => {
      const videos = Array.isArray(ls?.videos) ? ls.videos : [];
      return lsSum + videos.reduce((acc: number, v: any) => acc + (Number(v?.durationSeconds) || 0), 0);
    }, 0);
  }, 0);

  const watchedRaw = watchedByCourse.get(cid) || 0;
  const watchedSeconds = lessonDurationSeconds > 0 ? Math.min(watchedRaw, lessonDurationSeconds) : watchedRaw;
  const lessonsPercent = lessonDurationSeconds > 0 ? Math.min((watchedSeconds / lessonDurationSeconds) * 100, 100) : 0;

  let totalQuestions = 0;
  let attemptedQuestions = 0;
  const chMap = answersByCourseChapter.get(cid);
  for (const ch of chapters) {
    const quizObj = Array.isArray(ch?.quizzes) && ch.quizzes.length > 0 ? ch.quizzes[0] : null;
    const questions = Array.isArray(quizObj?.questions) ? quizObj.questions : [];
    totalQuestions += questions.length;
    const qSet = chMap?.get(String(ch?._id));
    attemptedQuestions += qSet ? qSet.size : 0;
  }
  const quizPercent = totalQuestions > 0 ? Number(((attemptedQuestions / totalQuestions) * 100).toFixed(2)) : 0;

  const hasLessons = lessonDurationSeconds > 0;
  const hasQuiz = totalQuestions > 0;
  let raw: number;
  if (hasLessons && hasQuiz) raw = (lessonsPercent + quizPercent) / 2;
  else if (hasLessons) raw = lessonsPercent;
  else if (hasQuiz) raw = quizPercent;
  else raw = 0;

  const percentCompleted = Number(Math.min(raw, 100).toFixed(2));
  return { percentCompleted, completed: percentCompleted >= 90 };
}

function buildCourseSafe(course: any) {
  if (!course) return null;
  return {
    _id: String(course._id),
    title: course.title || "",
    description: course.description || "",
    thumbnailUrl: course.thumbnailUrl || "",
    tags: Array.isArray(course.tags) ? course.tags : [],
    status: course.status,
    accessLevel: course.accessLevel || null,
    user: String(course.user || ""),
    createdBy: course.createdBy
      ? { _id: String(course.createdBy._id || ""), name: course.createdBy.name || "", email: course.createdBy.email || "" }
      : null,
    createdAt: course.createdAt || null,
    updatedAt: course.updatedAt || null,
  };
}

function sendNotification(userId: string, courseId: string, assignerName: string) {
  void (async () => {
    try {
      const title = "New learning assigned";
      const body = `New learning assigned by ${assignerName}`;
      const tokenDoc = await DeviceToken.findOne({ userId }).lean();
      if (tokenDoc?.deviceToken) {
        const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
        if (isExpo) {
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ to: tokenDoc.deviceToken, sound: "default", title, body }),
          });
        } else {
          await firebaseAdmin.messaging().send({
            token: tokenDoc.deviceToken,
            notification: { title, body },
            data: { _id: String(courseId), event: "course-assigned" },
          } as any);
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
  })();
}

function sendAssignmentEmail(
  email: string,
  name: string,
  courseTitle: string,
  assignerName: string
) {
  void (async () => {
    try {
      await sendLearningAssignmentEmail({
        to: email,
        firstName: name,
        learningTitle: courseTitle,
        assignedByName: assignerName,
      });
    } catch {}
  })();
}

// ─── controllers ────────────────────────────────────────────────────────────

export const createCourseAssignment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { assignCourse: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canCreate?.success) return sendError(res, 403, "Forbidden");

    const role = String((user as any).role || "");

    const { userId, courseId, profileId } = req.body as {
      userId?: string;
      courseId?: string;
      profileId?: string;
    };
    if (!userId || !courseId) return sendError(res, 400, "userId and courseId are required");
    if (!isValidObjectId(courseId)) return sendError(res, 400, "Invalid courseId");

    const [course, targetResult] = await Promise.all([
      Course.findById(courseId).select("status title").lean(),
      auth.api.listUsers({
        query: { filterField: "id", filterValue: userId, limit: 1, offset: 0, sortBy: "createdAt", sortDirection: "desc" },
        headers: fromNodeHeaders(req.headers),
      }),
    ]);

    if (!course) return sendError(res, 404, "Course not found");
    if ((course as any).status !== "published") return sendError(res, 403, "Course must be published to assign");

    const targetUser = (targetResult as any)?.users?.[0];
    if (!targetUser) return sendError(res, 404, "Assignee not found");

    const targetRole = String((targetUser as any).role || "");
    const isTargetTrainee = targetRole === "trainee";
    const isTargetUser = targetRole === "user";
    if (!isTargetTrainee && !isTargetUser) {
      return sendError(res, 403, "Courses can only be assigned to trainees or users");
    }

    // User-role targets require a profileId
    const resolvedProfileId = isTargetUser ? (profileId || "") : "";
    if (isTargetUser && !resolvedProfileId) {
      return sendError(res, 400, "profileId is required when assigning to a user account");
    }

    const assignedByRole = resolveAssignerRole(role);
    const filter = { assignedToId: userId, courseId, assignedByRole, profileId: resolvedProfileId };
    const result = await CourseAssignment.updateOne(
      filter,
      {
        $setOnInsert: {
          assignedToId: userId,
          courseId,
          profileId: resolvedProfileId,
          assignedById: String((user as any).id),
          assignedByRole,
          assignedByName: String((user as any).name || ""),
        },
      },
      { upsert: true }
    );

    const isNew = result.upsertedCount > 0;
    if (isNew) {
      sendNotification(userId, courseId, String((user as any).name || "Unknown"));
      sendAssignmentEmail(
        String((targetUser as any).email || ""),
        String((targetUser as any).name || ""),
        String((course as any).title || ""),
        String((user as any).name || "")
      );
    }

    return sendSuccess(res, isNew ? 201 : 200, isNew ? "Course assigned" : "Course already assigned");
  } catch (error) {
    next(error);
  }
};

export const createCourseAssignmentsBulk = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { assignCourse: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canCreate?.success) return sendError(res, 403, "Forbidden");

    const role = String((user as any).role || "");

    const items: Array<{ userId?: string; courseId?: string; profileId?: string }> =
      Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) return sendError(res, 400, "items array is required");
    if (items.length > 200) return sendError(res, 400, "Maximum 200 items per request");

    const uniqueCourseIds = new Set<string>();
    const uniqueUserIds = new Set<string>();
    for (const it of items) {
      if (typeof it?.courseId === "string" && isValidObjectId(it.courseId)) uniqueCourseIds.add(it.courseId);
      if (typeof it?.userId === "string" && it.userId) uniqueUserIds.add(it.userId);
    }

    const [courses, ...userResults] = await Promise.all([
      Course.find({ _id: { $in: [...uniqueCourseIds] }, status: "published" }).select("_id title").lean(),
      ...[...uniqueUserIds].map((id) =>
        auth.api.listUsers({
          query: { filterField: "id", filterValue: id, limit: 1, offset: 0, sortBy: "createdAt", sortDirection: "desc" },
          headers: fromNodeHeaders(req.headers),
        })
      ),
    ]);

    const validCourses = new Map<string, string>(
      (courses as any[]).map((c: any) => [String(c._id), String(c.title || "")])
    );
    const userInfoById = new Map<string, { role: string; email: string; name: string }>();
    for (const res of userResults) {
      const u = (res as any)?.users?.[0];
      if (u) {
        userInfoById.set(String(u.id), {
          role: String(u.role || ""),
          email: String(u.email || ""),
          name: String(u.name || ""),
        });
      }
    }

    const assignedByRole = resolveAssignerRole(role);
    const ops: any[] = [];
    const results: Array<{ userId: string; courseId: string; profileId: string; status: string; message?: string }> = [];
    const notifyQueue: Array<{ userId: string; courseId: string; courseTitle: string; email: string; name: string }> = [];
    let failureCount = 0;

    for (const it of items) {
      const userId = typeof it?.userId === "string" ? it.userId : "";
      const courseId = typeof it?.courseId === "string" ? it.courseId : "";
      const profileId = typeof it?.profileId === "string" ? it.profileId : "";

      if (!userId || !courseId || !isValidObjectId(courseId)) {
        results.push({ userId, courseId, profileId, status: "error", message: "Invalid item" });
        failureCount++;
        continue;
      }
      if (!validCourses.has(courseId)) {
        results.push({ userId, courseId, profileId, status: "error", message: "Course not found or not published" });
        failureCount++;
        continue;
      }
      const info = userInfoById.get(userId);
      if (!info) {
        results.push({ userId, courseId, profileId, status: "error", message: "User not found" });
        failureCount++;
        continue;
      }
      const isTargetUser = info.role === "user";
      const isTargetTrainee = info.role === "trainee";
      if (!isTargetUser && !isTargetTrainee) {
        results.push({ userId, courseId, profileId, status: "error", message: "Courses can only be assigned to trainees or users" });
        failureCount++;
        continue;
      }
      if (isTargetUser && !profileId) {
        results.push({ userId, courseId, profileId, status: "error", message: "profileId required for user-role targets" });
        failureCount++;
        continue;
      }

      const resolvedProfileId = isTargetUser ? profileId : "";
      ops.push({
        updateOne: {
          filter: { assignedToId: userId, courseId, assignedByRole, profileId: resolvedProfileId },
          update: {
            $setOnInsert: {
              assignedToId: userId,
              courseId,
              profileId: resolvedProfileId,
              assignedById: String((user as any).id),
              assignedByRole,
              assignedByName: String((user as any).name || ""),
            },
          },
          upsert: true,
        },
      });
      results.push({ userId, courseId, profileId: resolvedProfileId, status: "queued" });
      notifyQueue.push({
        userId,
        courseId,
        courseTitle: validCourses.get(courseId) || "",
        email: info.email,
        name: info.name,
      });
    }

    let upsertedIndices = new Set<number>();
    if (ops.length > 0) {
      const bulkResult = await CourseAssignment.bulkWrite(ops, { ordered: false });
      // bulkWrite upsertedIds uses string-indexed keys matching ops array position
      upsertedIndices = new Set(
        Object.keys(bulkResult.upsertedIds || {}).map(Number)
      );
    }

    let opIdx = 0;
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "queued") {
        const isNew = upsertedIndices.has(opIdx);
        results[i].status = isNew ? "assigned" : "alreadyAssigned";
        if (isNew) {
          const nq = notifyQueue[opIdx];
          sendNotification(nq.userId, nq.courseId, String((user as any).name || "Unknown"));
          sendAssignmentEmail(nq.email, nq.name, nq.courseTitle, String((user as any).name || ""));
        }
        opIdx++;
      }
    }

    const successCount = results.filter((r) => r.status === "assigned" || r.status === "alreadyAssigned").length;
    return sendSuccess(res, 201, "Bulk assignment processed", {
      successes: successCount,
      failures: failureCount,
      results,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteCourseAssignment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canDelete = await auth.api.userHasPermission({
      body: { permissions: { assignCourse: ["delete"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canDelete?.success) return sendError(res, 403, "Forbidden");

    const role = String((user as any).role || "");

    const { userId, courseId, profileId } = req.body as {
      userId?: string;
      courseId?: string;
      profileId?: string;
    };
    if (!userId || !courseId) return sendError(res, 400, "userId and courseId are required");

    const resolvedProfileId = profileId || "";
    const filter: Record<string, any> = {
      assignedToId: userId,
      courseId,
      profileId: resolvedProfileId,
      assignedById: String((user as any).id),
      assignedByRole: resolveAssignerRole(role),
    };

    const result = await CourseAssignment.deleteOne(filter);
    if (result.deletedCount === 0) return sendError(res, 404, "Assignment not found");

    return sendSuccess(res, 200, "Course unassigned");
  } catch (error) {
    next(error);
  }
};

export const deleteCourseAssignmentsBulk = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canDelete = await auth.api.userHasPermission({
      body: { permissions: { assignCourse: ["delete"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canDelete?.success) return sendError(res, 403, "Forbidden");

    const role = String((user as any).role || "");

    const items: Array<{ userId?: string; courseId?: string; profileId?: string }> =
      Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) return sendError(res, 400, "items array is required");
    if (items.length > 200) return sendError(res, 400, "Maximum 200 items per request");

    const assignedByRole = resolveAssignerRole(role);
    const conditions = items
      .filter((it) => typeof it?.userId === "string" && typeof it?.courseId === "string" && it.userId && it.courseId)
      .map((it) => ({
        assignedToId: it.userId!,
        courseId: it.courseId!,
        profileId: it.profileId || "",
        assignedById: String((user as any).id),
        assignedByRole,
      }));

    if (conditions.length === 0) return sendError(res, 400, "No valid items provided");

    const result = await CourseAssignment.deleteMany({ $or: conditions });
    return sendSuccess(res, 200, "Bulk unassign completed", { deletedCount: result.deletedCount });
  } catch (error) {
    next(error);
  }
};

export const listCourseAssignmentsForUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { assignCourse: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden");

    const role = String((user as any).role || "");

    const { userId } = req.params as { userId: string };
    const profileId = typeof req.query.profileId === "string" ? req.query.profileId : undefined;
    const { limit, page, offset } = parsePagination(req.query as any);

    const filter: Record<string, any> = { assignedToId: userId };
    if (profileId !== undefined) filter.profileId = profileId;

    const [assignments, total] = await Promise.all([
      CourseAssignment.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      CourseAssignment.countDocuments(filter),
    ]);

    const courseIds = assignments.map((a: any) => String(a.courseId));
    const [courseMap, { watchedByCourse, answersByCourseChapter }] = await Promise.all([
      fetchCourseMap(courseIds),
      fetchProgressRaw(userId, courseIds),
    ]);

    const data = assignments.map((a: any) => {
      const cid = String(a.courseId);
      const course = courseMap.get(cid);
      const progress = course
        ? computeProgressForCourse(cid, course, watchedByCourse, answersByCourseChapter)
        : { percentCompleted: 0, completed: false };
      return {
        course: buildCourseSafe(course),
        assignedBy: {
          id: String(a.assignedById),
          name: String(a.assignedByName || ""),
          role: String(a.assignedByRole || ""),
        },
        profileId: a.profileId || "",
        assignedAt: a.createdAt,
        progressSummary: progress,
      };
    });

    return sendSuccess(res, 200, "Assigned courses for user fetched", data, {
      page,
      offset,
      limit,
      total,
      hasNext: offset + data.length < total,
    });
  } catch (error) {
    next(error);
  }
};

export const listMyCourseAssignments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { assignCourse: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden");

    const role = String((user as any).role || "");
    const isTrainee = role === "trainee";
    const isUserRole = role === "user";

    if (!isTrainee && !isUserRole) {
      return sendSuccess(res, 200, "No assignments", [], { page: 1, offset: 0, limit: 10, total: 0, hasNext: false });
    }

    const userId = String((user as any).id);
    const activeProfileId = isUserRole
      ? (String((session.session as any).activeProfileId || "") || null)
      : null;

    if (isUserRole && !activeProfileId) {
      return sendError(res, 400, "No active profile selected. Switch to a profile first.");
    }

    const profileId = isUserRole ? activeProfileId! : "";
    const { limit, page, offset } = parsePagination(req.query as any);

    const filter: Record<string, any> = { assignedToId: userId, profileId };

    const [assignments, total] = await Promise.all([
      CourseAssignment.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      CourseAssignment.countDocuments(filter),
    ]);

    const courseIds = assignments.map((a: any) => String(a.courseId));
    const [courseMap, { watchedByCourse, answersByCourseChapter }] = await Promise.all([
      fetchCourseMap(courseIds),
      fetchProgressRaw(userId, courseIds),
    ]);

    const data = assignments.map((a: any) => {
      const cid = String(a.courseId);
      const course = courseMap.get(cid);
      const progress = course
        ? computeProgressForCourse(cid, course, watchedByCourse, answersByCourseChapter)
        : { percentCompleted: 0, completed: false };
      return {
        course: buildCourseSafe(course),
        assignedBy: {
          id: String(a.assignedById),
          name: String(a.assignedByName || ""),
          role: String(a.assignedByRole || ""),
        },
        assignedAt: a.createdAt,
        progressSummary: progress,
      };
    });

    return sendSuccess(res, 200, "My assigned courses fetched", data, {
      page,
      offset,
      limit,
      total,
      hasNext: offset + data.length < total,
    });
  } catch (error) {
    next(error);
  }
};

export const listCourseAssignmentsByMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { assignCourse: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden");

    const role = String((user as any).role || "");

    const { limit, page, offset } = parsePagination(req.query as any);
    const assignedByRole = resolveAssignerRole(role);
    const filter = { assignedById: String((user as any).id), assignedByRole };

    const [assignments, total] = await Promise.all([
      CourseAssignment.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      CourseAssignment.countDocuments(filter),
    ]);

    const courseIds = assignments.map((a: any) => String(a.courseId));
    const courseMap = await fetchCourseMap(courseIds);

    const data = assignments.map((a: any) => ({
      course: buildCourseSafe(courseMap.get(String(a.courseId))),
      assignedTo: { id: String(a.assignedToId), profileId: a.profileId || "" },
      assignedAt: a.createdAt,
    }));

    return sendSuccess(res, 200, "Courses assigned by me fetched", data, {
      page,
      offset,
      limit,
      total,
      hasNext: offset + data.length < total,
    });
  } catch (error) {
    next(error);
  }
};
