import { Request, Response, NextFunction } from "express";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendSuccess, sendError } from "@/utils/api-response";
import { ShortAssignment } from "@/models/short-assignment";
import { ShortVideo } from "@/models/short-videos";
import { ShortVideoProgress } from "@/models/short-video-progress";
import admin from "@/config/firebase";
import { DeviceToken } from "@/models/device-token";
import { Notification } from "@/models/notification";
import { sendLearningAssignmentEmail } from "@/utils/mailer";
import { isRoleIn } from "@/utils/roles";

// ─── assignShort ─────────────────────────────────────────────────────────────

export const assignShort = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { assignShorts: ["create"] } },
      headers: apiHeaders,
    });
    if (!canCreate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const role = (user as any).role;
    const isAdmin = isRoleIn(role, "admin");
    const isTrainer = isRoleIn(role, "trainer");
    const isTrainee = isRoleIn(role, "trainee");

    if (!isAdmin && !isTrainer && !isTrainee) {
      return sendError(res, 403, "Forbidden: only trainers, trainees, or admins can assign shorts");
    }

    const { userId, shortVideoId } = req.body as { userId?: string; shortVideoId?: string };
    if (!userId || !shortVideoId) return sendError(res, 400, "userId and shortVideoId are required");

    const video = await ShortVideo.findById(shortVideoId).select("status title durationSeconds");
    if (!video) return sendError(res, 404, "Short video not found");
    if ((video as any).status !== "published") {
      return sendError(res, 403, "Short video must be published to assign");
    }

    const result = await auth.api.listUsers({
      query: { filterField: "id", filterValue: userId, limit: 1, offset: 0, sortBy: "createdAt", sortDirection: "desc" },
      headers: apiHeaders,
    });
    const targetUser = (result as any)?.users?.[0];
    if (!targetUser) return sendError(res, 404, "Assignee user not found");

    const allowedTargetRoles = isAdmin ? ["trainer", "trainee", "user"] : isTrainer ? ["trainee", "user"] : ["user"];
    if (!isRoleIn((targetUser as any).role, ...allowedTargetRoles)) {
      return sendError(res, 403, `Assignee must have role ${allowedTargetRoles.join("/")}`);
    }

    const assignedByRole = isTrainer ? "trainer" : isTrainee ? "trainee" : "admin";
    await ShortAssignment.updateOne(
      { assignedToId: userId, shortVideoId, assignedByRole },
      {
        $setOnInsert: {
          assignedToId: userId,
          shortVideoId,
          assignedById: (user as any).id,
          assignedByRole,
          assignedByName: (user as any).name || "",
        },
      },
      { upsert: true }
    );

    // Push notification + in-app notification (fire-and-forget)
    try {
      const tokenDoc = await DeviceToken.findOne({ userId }).lean();
      const title = "New learning assigned";
      const body = `New short assigned by ${String((user as any).name || "Unknown")}`;
      if (tokenDoc?.deviceToken) {
        const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
        if (isExpo) {
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ to: tokenDoc.deviceToken, sound: "default", title, body }),
          });
        } else {
          await admin.messaging().send({
            token: tokenDoc.deviceToken,
            notification: { title, body },
            data: { _id: String(shortVideoId), event: "short-assigned" },
          } as any);
        }
      }
      try {
        await Notification.create({
          userId, title, body,
          data: { _id: String(shortVideoId), event: "short-assigned" },
          read: false,
        });
      } catch {}
    } catch {}

    try {
      await sendLearningAssignmentEmail({
        to: String((targetUser as any)?.email || ""),
        firstName: String((targetUser as any)?.name || ""),
        learningTitle: String((video as any)?.title || ""),
        assignedByName: String((user as any)?.name || ""),
      });
    } catch {}

    return sendSuccess(res, 201, "Short assigned to user");
  } catch (error) {
    return next(error);
  }
};

// ─── unassignShort ────────────────────────────────────────────────────────────

export const unassignShort = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canDelete = await auth.api.userHasPermission({
      body: { permissions: { assignShorts: ["delete"] } },
      headers: apiHeaders,
    });
    if (!canDelete?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const role = (user as any).role;
    const isAdmin = isRoleIn(role, "admin");
    const isTrainer = isRoleIn(role, "trainer");
    const isTrainee = isRoleIn(role, "trainee");

    const { userId, shortVideoId } = req.body as { userId?: string; shortVideoId?: string };
    if (!userId || !shortVideoId) return sendError(res, 400, "userId and shortVideoId are required");

    const video = await ShortVideo.findById(shortVideoId).select("_id");
    if (!video) return sendError(res, 404, "Short video not found");

    let deletedCount = 0;
    if (isAdmin) {
      const result = await ShortAssignment.deleteMany({ assignedToId: userId, shortVideoId });
      deletedCount = result.deletedCount || 0;
    } else {
      const assignedByRole = isTrainer ? "trainer" : isTrainee ? "trainee" : "";
      const result = await ShortAssignment.deleteOne({
        assignedToId: userId,
        shortVideoId,
        assignedById: (user as any).id,
        assignedByRole,
      });
      deletedCount = result.deletedCount || 0;
    }

    if (deletedCount === 0) return sendError(res, 404, "No assignment found to unassign");

    return sendSuccess(res, 200, "Short unassigned");
  } catch (error) {
    return next(error);
  }
};

// ─── getAssignedShortsForAssignee ─────────────────────────────────────────────

export const getAssignedShortsForAssignee = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { assignShorts: ["view"] } },
      headers: apiHeaders,
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const { userId } = req.params as { userId?: string };
    if (!userId || !userId.trim()) return sendError(res, 400, "userId param is required");

    const rawLimit = Number(req.query.limit);
    const rawPage = Number(req.query.page);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const offset = (page - 1) * limit;

    const docs = await ShortAssignment.find({ assignedToId: userId }).sort({ createdAt: -1 }).lean();

    const shortIds = docs.map((d: any) => String(d.shortVideoId));
    const shorts = await ShortVideo.find({ _id: { $in: shortIds } })
      .select("title description thumbnailUrl tags status accessLevel visibility durationSeconds createdAt updatedAt user createdBy")
      .lean();
    const shortMap = new Map<string, any>(shorts.map((s: any) => [String(s._id), s]));

    const progressDocs = await ShortVideoProgress.find({ userId, shortVideoId: { $in: shortIds } })
      .select("shortVideoId watchedSeconds completed")
      .lean();
    const progressByShort = new Map<string, { watchedSeconds: number; completed: boolean }>();
    for (const p of progressDocs) {
      progressByShort.set(String((p as any).shortVideoId), {
        watchedSeconds: Number((p as any).watchedSeconds) || 0,
        completed: Boolean((p as any).completed),
      });
    }

    const merged = docs.map((a: any) => {
      const sid = String(a.shortVideoId);
      const sv = shortMap.get(sid);
      const dur = Number(sv?.durationSeconds || 0);
      const prog = progressByShort.get(sid) || { watchedSeconds: 0, completed: false };
      const watchedSeconds = dur > 0 ? Math.min(prog.watchedSeconds, dur) : prog.watchedSeconds;
      const percentCompleted = dur > 0 ? Number(Math.min((watchedSeconds / dur) * 100, 100).toFixed(2)) : 0;
      const shortSafe = sv
        ? {
            _id: String(sv._id),
            title: sv.title,
            description: sv.description || "",
            thumbnailUrl: sv.thumbnailUrl || "",
            tags: Array.isArray(sv.tags) ? sv.tags : [],
            status: sv.status,
            accessLevel: sv.accessLevel || null,
            visibility: sv.visibility || "users",
            user: String(sv.user || ""),
            createdBy: sv.createdBy
              ? { _id: String(sv.createdBy._id || ""), name: sv.createdBy.name || "", email: sv.createdBy.email || "" }
              : null,
            durationSeconds: dur,
            createdAt: sv.createdAt,
            updatedAt: sv.updatedAt,
          }
        : null;
      return {
        short: shortSafe,
        assignedBy: { id: String(a.assignedById), name: String(a.assignedByName || ""), role: String(a.assignedByRole || "") },
        assignedAt: a.createdAt,
        progress: { watchedSeconds, percentCompleted, completed: Boolean(prog.completed) },
      };
    });

    const total = merged.length;
    const data = merged.slice(offset, offset + limit);
    return sendSuccess(res, 200, "Assigned shorts for assignee fetched", data, {
      page, offset, limit, total, hasNext: offset + data.length < total,
    });
  } catch (error) {
    return next(error);
  }
};

// ─── getMyAssignedShorts ──────────────────────────────────────────────────────

export const getMyAssignedShorts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const rawLimit = Number(req.query.limit);
    const rawPage = Number(req.query.page);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const offset = (page - 1) * limit;

    const assignments = await ShortAssignment.find({ assignedToId: (user as any).id }).sort({ createdAt: -1 }).lean();

    const shortIds = assignments.map((a: any) => String(a.shortVideoId));
    const shorts = await ShortVideo.find({ _id: { $in: shortIds } })
      .select("title description thumbnailUrl tags status accessLevel visibility durationSeconds createdAt updatedAt user createdBy")
      .lean();
    const shortMap = new Map<string, any>(shorts.map((s: any) => [String(s._id), s]));

    const progressDocs = await ShortVideoProgress.find({ userId: (user as any).id, shortVideoId: { $in: shortIds } })
      .select("shortVideoId watchedSeconds completed")
      .lean();
    const progressByShort = new Map<string, { watchedSeconds: number; completed: boolean }>();
    for (const p of progressDocs) {
      progressByShort.set(String((p as any).shortVideoId), {
        watchedSeconds: Number((p as any).watchedSeconds) || 0,
        completed: Boolean((p as any).completed),
      });
    }

    const merged = assignments.map((a: any) => {
      const sid = String(a.shortVideoId);
      const sv = shortMap.get(sid);
      const dur = Number(sv?.durationSeconds || 0);
      const prog = progressByShort.get(sid) || { watchedSeconds: 0, completed: false };
      const watchedSeconds = dur > 0 ? Math.min(prog.watchedSeconds, dur) : prog.watchedSeconds;
      const percentCompleted = dur > 0 ? Number(Math.min((watchedSeconds / dur) * 100, 100).toFixed(2)) : 0;
      const shortSafe = sv
        ? {
            _id: String(sv._id),
            title: sv.title,
            description: sv.description || "",
            thumbnailUrl: sv.thumbnailUrl || "",
            tags: Array.isArray(sv.tags) ? sv.tags : [],
            status: sv.status,
            accessLevel: sv.accessLevel || null,
            visibility: sv.visibility || "users",
            user: String(sv.user || ""),
            createdBy: sv.createdBy
              ? { _id: String(sv.createdBy._id || ""), name: sv.createdBy.name || "", email: sv.createdBy.email || "" }
              : null,
            durationSeconds: dur,
            createdAt: sv.createdAt,
            updatedAt: sv.updatedAt,
          }
        : null;
      return {
        short: shortSafe,
        assignedBy: { id: String(a.assignedById), name: String(a.assignedByName || ""), role: String(a.assignedByRole || "") },
        assignedAt: a.createdAt,
        progress: { watchedSeconds, percentCompleted, completed: Boolean(prog.completed) },
      };
    });

    const total = merged.length;
    const data = merged.slice(offset, offset + limit);
    return sendSuccess(res, 200, "Assigned shorts for me fetched", data, {
      page, offset, limit, total, hasNext: offset + data.length < total,
    });
  } catch (error) {
    return next(error);
  }
};

// ─── assignShortsBulk ────────────────────────────────────────────────────────

export const assignShortsBulk = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { assignShorts: ["create"] } },
      headers: apiHeaders,
    });
    if (!canCreate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const role = (user as any).role;
    const isAdmin = isRoleIn(role, "admin");
    const isTrainer = isRoleIn(role, "trainer");
    const isTrainee = isRoleIn(role, "trainee");

    if (!isAdmin && !isTrainer && !isTrainee) {
      return sendError(res, 403, "Forbidden: only trainers, trainees, or admins can assign shorts");
    }
    const assignedByRole = isTrainer ? "trainer" : isTrainee ? "trainee" : "admin";

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) return sendError(res, 400, "items array is required");
    if (items.length > 200) return sendError(res, 400, "Too many items; max 200");

    const uniqueUserIds = new Set<string>();
    const uniqueShortIds = new Set<string>();
    for (const it of items) {
      const uid = typeof it?.userId === "string" ? it.userId : "";
      const sid = typeof it?.shortVideoId === "string" ? it.shortVideoId : "";
      if (uid && sid) { uniqueUserIds.add(uid); uniqueShortIds.add(sid); }
    }
    if (uniqueUserIds.size === 0 || uniqueShortIds.size === 0) {
      return sendError(res, 400, "items must contain valid userId and shortVideoId");
    }

    const shorts = await ShortVideo.find({ _id: { $in: Array.from(uniqueShortIds) as any }, status: "published" })
      .select("_id title").lean();
    const validShorts = new Set<string>(shorts.map((s: any) => String(s._id)));
    const shortTitleById = new Map<string, string>(shorts.map((s: any) => [String(s._id), String(s.title || "")]));

    // Fetch all target users in parallel using the single shared apiHeaders instance
    const userInfoById = new Map<string, { role: any; email: string; name: string }>();
    await Promise.all(
      Array.from(uniqueUserIds).map(async (id) => {
        try {
          const res = await auth.api.listUsers({
            query: { filterField: "id", filterValue: id, limit: 1, offset: 0, sortBy: "createdAt", sortDirection: "desc" },
            headers: apiHeaders,
          });
          const u = (res as any)?.users?.[0];
          if (u) {
            userInfoById.set(String(u.id), {
              role: u.role,
              email: String(u.email || ""),
              name: String(u.name || ""),
            });
          }
        } catch {}
      })
    );

    const allowedTargetRoles = isAdmin ? ["trainer", "trainee", "user"] : isTrainer ? ["trainee", "user"] : ["user"];

    const results: Array<{ userId: string; shortVideoId: string; status: string; message?: string }> = [];
    let successCount = 0;
    let failureCount = 0;

    for (const it of items) {
      const userId = String(it?.userId || "");
      const shortVideoId = String(it?.shortVideoId || "");

      if (!userId || !shortVideoId) {
        results.push({ userId, shortVideoId, status: "error", message: "Invalid item" });
        failureCount++;
        continue;
      }
      if (!validShorts.has(shortVideoId)) {
        results.push({ userId, shortVideoId, status: "error", message: "Short not found or not published" });
        failureCount++;
        continue;
      }
      const info = userInfoById.get(userId);
      if (!info || !isRoleIn(info.role, ...allowedTargetRoles)) {
        results.push({ userId, shortVideoId, status: "error", message: `Assignee must have role ${allowedTargetRoles.join("/")}` });
        failureCount++;
        continue;
      }

      try {
        const r: any = await ShortAssignment.updateOne(
          { assignedToId: userId, shortVideoId, assignedByRole },
          {
            $setOnInsert: {
              assignedToId: userId,
              shortVideoId,
              assignedById: (user as any).id,
              assignedByRole,
              assignedByName: (user as any).name || "",
            },
          },
          { upsert: true }
        );
        const inserted = typeof r?.upsertedCount === "number" ? r.upsertedCount > 0 : Boolean(r?.upsertedId);

        if (inserted) {
          try {
            const tokenDoc = await DeviceToken.findOne({ userId }).lean();
            const title = "New learning assigned";
            const body = `New short assigned by ${String((user as any).name || "Unknown")}`;
            if (tokenDoc?.deviceToken) {
              const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
              if (isExpo) {
                await fetch("https://exp.host/--/api/v2/push/send", {
                  method: "POST",
                  headers: { Accept: "application/json", "Content-Type": "application/json" },
                  body: JSON.stringify({ to: tokenDoc.deviceToken, sound: "default", title, body }),
                });
              } else {
                await admin.messaging().send({
                  token: tokenDoc.deviceToken,
                  notification: { title, body },
                  data: { _id: String(shortVideoId), event: "short-assigned" },
                } as any);
              }
            }
            try {
              await Notification.create({
                userId, title, body,
                data: { _id: String(shortVideoId), event: "short-assigned" },
                read: false,
              });
            } catch {}
          } catch {}
          try {
            await sendLearningAssignmentEmail({
              to: info.email,
              firstName: info.name,
              learningTitle: shortTitleById.get(shortVideoId) || "",
              assignedByName: String((user as any)?.name || ""),
            });
          } catch {}
          results.push({ userId, shortVideoId, status: "assigned" });
          successCount++;
        } else {
          results.push({ userId, shortVideoId, status: "alreadyAssigned" });
          successCount++;
        }
      } catch (e: any) {
        results.push({ userId, shortVideoId, status: "error", message: String(e?.message || "Assignment failed") });
        failureCount++;
      }
    }

    return sendSuccess(res, 201, "Bulk assignment processed", { successes: successCount, failures: failureCount, results });
  } catch (error) {
    return next(error);
  }
};
