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

export const assignShort = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { assignShorts: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canCreate?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const role = (user as any).role;
    const isTrainer = Array.isArray(role)
      ? role.includes("trainer")
      : role === "trainer";
    const isTrainee = Array.isArray(role)
      ? role.includes("trainee")
      : role === "trainee";
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    if (!isTrainer && !isTrainee && !isAdmin) {
      return sendError(
        res,
        403,
        "Forbidden: only trainers, trainees, or admins can assign shorts"
      );
    }

    const { userId, shortVideoId } = req.body as {
      userId?: string;
      shortVideoId?: string;
    };
    if (!userId || !shortVideoId) {
      return sendError(res, 400, "userId and shortVideoId are required");
    }

    const video = await ShortVideo.findById(shortVideoId).select(
      "status title durationSeconds"
    );
    if (!video) return sendError(res, 404, "Short video not found");
    if ((video as any).status !== "published")
      return sendError(res, 403, "Short video must be published to assign");

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
    const allowedTargetRoles = isAdmin
      ? ["trainer", "trainee", "user"]
      : isTrainer
      ? ["trainee", "user"]
      : ["user"];
    const targetHasAllowedRole = Array.isArray(targetRole)
      ? targetRole.some((r: any) => allowedTargetRoles.includes(String(r)))
      : allowedTargetRoles.includes(String(targetRole));
    if (!targetHasAllowedRole) {
      return sendError(
        res,
        403,
        `Assignee must have role ${allowedTargetRoles.join("/")}`
      );
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

    try {
      const tokenDoc = await DeviceToken.findOne({ userId }).lean();
      const title = "New learning assigned";
      const body = `New short assigned by ${String((user as any).name || "Unknown")}`;
      if (tokenDoc?.deviceToken) {
        const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
        if (isExpo) {
          const expoMessage = {
            to: tokenDoc.deviceToken,
            sound: "default",
            title,
            body,
          };
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(expoMessage),
          });
        } else {
          const fcmMessage = {
            token: tokenDoc.deviceToken,
            notification: { title, body },
            data: { _id: String(shortVideoId), event: "short-assigned" },
          } as any;
          await admin.messaging().send(fcmMessage);
        }
      }
      try {
        await Notification.create({
          userId,
          title,
          body,
          data: { _id: String(shortVideoId), event: "short-assigned" },
          read: false,
        });
      } catch {}
    } catch {}

    try {
      const targetEmail = String((targetUser as any)?.email || "");
      const targetName = String((targetUser as any)?.name || "");
      await sendLearningAssignmentEmail({
        to: targetEmail,
        firstName: targetName,
        learningTitle: String((video as any)?.title || ""),
        assignedByName: String((user as any)?.name || ""),
      });
    } catch {}

    return sendSuccess(res, 201, "Short assigned to user");
  } catch (error) {
    next(error);
  }
};

export const unassignShort = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canDelete = await auth.api.userHasPermission({
      body: { permissions: { assignShorts: ["delete"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canDelete?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const role = (user as any).role;
    const isTrainer = Array.isArray(role)
      ? role.includes("trainer")
      : role === "trainer";
    const isTrainee = Array.isArray(role)
      ? role.includes("trainee")
      : role === "trainee";
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";

    const { userId, shortVideoId } = req.body as {
      userId?: string;
      shortVideoId?: string;
    };
    if (!userId || !shortVideoId)
      return sendError(res, 400, "userId and shortVideoId are required");

    const video = await ShortVideo.findById(shortVideoId).select("_id");
    if (!video) return sendError(res, 404, "Short video not found");

    let deletedCount = 0;
    if (isAdmin) {
      const result = await ShortAssignment.deleteMany({
        assignedToId: userId,
        shortVideoId,
      });
      deletedCount = result.deletedCount || 0;
    } else {
      const assignedByRole = isTrainer ? "trainer" : "trainee";
      const result = await ShortAssignment.deleteOne({
        assignedToId: userId,
        shortVideoId,
        assignedById: (user as any).id,
        assignedByRole,
      });
      deletedCount = result.deletedCount || 0;
    }

    if (deletedCount === 0) {
      return sendError(res, 404, "No assignment found to unassign");
    }

    return sendSuccess(res, 200, "Short unassigned");
  } catch (error) {
    next(error);
  }
};

export const getAssignedShortsForAssignee = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { assignShorts: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const { userId } = req.params as { userId?: string };
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      return sendError(res, 400, "userId param is required");
    }

    const rawLimit = Number(req.query.limit);
    const rawPage = Number(req.query.page);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const offset = (page - 1) * limit;

    const docs = await ShortAssignment.find({
      assignedToId: userId,
    })
      .sort({ createdAt: -1 })
      .lean();

    const shortIds = docs.map((d: any) => String((d as any).shortVideoId));
    const shorts = await ShortVideo.find({ _id: { $in: shortIds } })
      .select(
        "title description thumbnailUrl tags status accessLevel visibility durationSeconds createdAt updatedAt user createdBy"
      )
      .lean();
    const shortMap = new Map<string, any>(
      shorts.map((s: any) => [String((s as any)._id), s])
    );

    const progressDocs = await ShortVideoProgress.find({
      userId,
      shortVideoId: { $in: shortIds },
    })
      .select("shortVideoId watchedSeconds completed")
      .lean();
    const progressByShort = new Map<
      string,
      { watchedSeconds: number; completed: boolean }
    >();
    for (const p of progressDocs) {
      progressByShort.set(String((p as any).shortVideoId), {
        watchedSeconds: Number((p as any).watchedSeconds) || 0,
        completed: Boolean((p as any).completed),
      });
    }

    const merged = docs.map((a: any) => {
      const sid = String((a as any).shortVideoId);
      const sv = shortMap.get(sid);
      const dur = Number((sv as any)?.durationSeconds || 0);
      const prog = progressByShort.get(sid) || {
        watchedSeconds: 0,
        completed: false,
      };
      const watchedSeconds =
        dur > 0 ? Math.min(prog.watchedSeconds, dur) : prog.watchedSeconds;
      const percentCompleted =
        dur > 0 ? Number(Math.min((watchedSeconds / dur) * 100, 100).toFixed(2)) : 0;
      const shortSafe = sv
        ? {
            _id: String((sv as any)._id),
            title: (sv as any).title,
            description: (sv as any).description || "",
            thumbnailUrl: (sv as any).thumbnailUrl || "",
            tags: Array.isArray((sv as any).tags) ? (sv as any).tags : [],
            status: (sv as any).status,
            accessLevel: (sv as any).accessLevel || null,
            visibility: (sv as any).visibility || "users",
            user: String((sv as any).user || ""),
            createdBy: (sv as any).createdBy
              ? {
                  _id: String((sv as any).createdBy._id || ""),
                  name: (sv as any).createdBy.name || "",
                  email: (sv as any).createdBy.email || "",
                }
              : null,
            durationSeconds: dur,
            createdAt: (sv as any).createdAt,
            updatedAt: (sv as any).updatedAt,
          }
        : null;
      return {
        short: shortSafe,
        assignedBy: {
          id: String((a as any).assignedById),
          name: String((a as any).assignedByName || ""),
          role: String((a as any).assignedByRole || ""),
        },
        assignedAt: (a as any).createdAt,
        progress: {
          watchedSeconds,
          percentCompleted,
          completed: Boolean(prog.completed),
        },
      };
    });

    const total = merged.length;
    const data = merged.slice(offset, offset + limit);
    const hasNext = offset + data.length < total;

    return sendSuccess(res, 200, "Assigned shorts for assignee fetched", data, {
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

export const getMyAssignedShorts = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const rawLimit = Number(req.query.limit);
    const rawPage = Number(req.query.page);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const offset = (page - 1) * limit;

    const assignments = await ShortAssignment.find({
      assignedToId: (user as any).id,
    })
      .sort({ createdAt: -1 })
      .lean();

    const shortIds = assignments.map((a: any) =>
      String((a as any).shortVideoId)
    );
    const shorts = await ShortVideo.find({ _id: { $in: shortIds } })
      .select(
        "title description thumbnailUrl tags status accessLevel visibility durationSeconds createdAt updatedAt user createdBy"
      )
      .lean();
    const shortMap = new Map<string, any>(
      shorts.map((s: any) => [String((s as any)._id), s])
    );

    const progressDocs = await ShortVideoProgress.find({
      userId: (user as any).id,
      shortVideoId: { $in: shortIds },
    })
      .select("shortVideoId watchedSeconds completed")
      .lean();
    const progressByShort = new Map<
      string,
      { watchedSeconds: number; completed: boolean }
    >();
    for (const p of progressDocs) {
      progressByShort.set(String((p as any).shortVideoId), {
        watchedSeconds: Number((p as any).watchedSeconds) || 0,
        completed: Boolean((p as any).completed),
      });
    }

    const merged = assignments.map((a: any) => {
      const sid = String((a as any).shortVideoId);
      const sv = shortMap.get(sid);
      const dur = Number((sv as any)?.durationSeconds || 0);
      const prog = progressByShort.get(sid) || {
        watchedSeconds: 0,
        completed: false,
      };
      const watchedSeconds =
        dur > 0 ? Math.min(prog.watchedSeconds, dur) : prog.watchedSeconds;
      const percentCompleted =
        dur > 0 ? Number(Math.min((watchedSeconds / dur) * 100, 100).toFixed(2)) : 0;
      const shortSafe = sv
        ? {
            _id: String((sv as any)._id),
            title: (sv as any).title,
            description: (sv as any).description || "",
            thumbnailUrl: (sv as any).thumbnailUrl || "",
            tags: Array.isArray((sv as any).tags) ? (sv as any).tags : [],
            status: (sv as any).status,
            accessLevel: (sv as any).accessLevel || null,
            visibility: (sv as any).visibility || "users",
            user: String((sv as any).user || ""),
            createdBy: (sv as any).createdBy
              ? {
                  _id: String((sv as any).createdBy._id || ""),
                  name: (sv as any).createdBy.name || "",
                  email: (sv as any).createdBy.email || "",
                }
              : null,
            durationSeconds: dur,
            createdAt: (sv as any).createdAt,
            updatedAt: (sv as any).updatedAt,
          }
        : null;
      return {
        short: shortSafe,
        assignedBy: {
          id: String((a as any).assignedById),
          name: String((a as any).assignedByName || ""),
          role: String((a as any).assignedByRole || ""),
        },
        assignedAt: (a as any).createdAt,
        progress: {
          watchedSeconds,
          percentCompleted,
          completed: Boolean(prog.completed),
        },
      };
    });

    const total = merged.length;
    const data = merged.slice(offset, offset + limit);
    const hasNext = offset + data.length < total;

    return sendSuccess(res, 200, "Assigned shorts for me fetched", data, {
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

export const assignShortsBulk = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { assignShorts: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canCreate?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const role = (user as any).role;
    const isTrainer = Array.isArray(role)
      ? role.includes("trainer")
      : role === "trainer";
    const isTrainee = Array.isArray(role)
      ? role.includes("trainee")
      : role === "trainee";
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    if (!isTrainer && !isTrainee && !isAdmin) {
      return sendError(
        res,
        403,
        "Forbidden: only trainers, trainees, or admins can assign shorts"
      );
    }
    const assignedByRole = isTrainer ? "trainer" : isTrainee ? "trainee" : "admin";

    const body = req.body as any;
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      return sendError(res, 400, "items array is required");
    }
    if (items.length > 200) {
      return sendError(res, 400, "Too many items; max 200");
    }

    const uniqueUserIds = new Set<string>();
    const uniqueShortIds = new Set<string>();
    for (const it of items) {
      const uid = typeof it?.userId === "string" ? it.userId : "";
      const sid = typeof it?.shortVideoId === "string" ? it.shortVideoId : "";
      if (uid && sid) {
        uniqueUserIds.add(uid);
        uniqueShortIds.add(sid);
      }
    }
    if (uniqueUserIds.size === 0 || uniqueShortIds.size === 0) {
      return sendError(res, 400, "items must contain valid userId and shortVideoId");
    }

    const shorts = await ShortVideo.find({
      _id: { $in: Array.from(uniqueShortIds) as any },
      status: "published",
    })
      .select("_id title")
      .lean();
    const validShorts = new Set<string>(shorts.map((s: any) => String((s as any)._id)));
    const shortTitleById = new Map<string, string>();
    for (const s of shorts) {
      shortTitleById.set(String((s as any)?._id), String((s as any)?.title || ""));
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

    const allowedTargetRoles = isAdmin
      ? ["trainer", "trainee", "user"]
      : isTrainer
      ? ["trainee", "user"]
      : ["user"];

    const results: Array<{
      userId: string;
      shortVideoId: string;
      status: string;
      message?: string;
    }> = [];
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
        results.push({
          userId,
          shortVideoId,
          status: "error",
          message: "Short not found or not published",
        });
        failureCount++;
        continue;
      }
      const info = userInfoById.get(userId);
      const userRole = info?.role;
      const targetHasAllowedRole = Array.isArray(userRole)
        ? (userRole as any[]).some((r: any) => allowedTargetRoles.includes(String(r)))
        : allowedTargetRoles.includes(String(userRole));
      if (!targetHasAllowedRole) {
        results.push({
          userId,
          shortVideoId,
          status: "error",
          message: `Assignee must have role ${allowedTargetRoles.join("/")}`,
        });
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
        const inserted =
          typeof r?.upsertedCount === "number"
            ? r.upsertedCount > 0
            : Boolean((r as any)?.upsertedId);
        if (inserted) {
          try {
            const tokenDoc = await DeviceToken.findOne({ userId }).lean();
            const title = "New learning assigned";
            const body = `New short assigned by ${String((user as any).name || "Unknown")}`;
            if (tokenDoc?.deviceToken) {
              const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
              if (isExpo) {
                const expoMessage = {
                  to: tokenDoc.deviceToken,
                  sound: "default",
                  title,
                  body,
                };
                await fetch("https://exp.host/--/api/v2/push/send", {
                  method: "POST",
                  headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(expoMessage),
                });
              } else {
                const fcmMessage = {
                  token: tokenDoc.deviceToken,
                  notification: { title, body },
                  data: { _id: String(shortVideoId), event: "short-assigned" },
                } as any;
                await admin.messaging().send(fcmMessage);
              }
            }
            try {
              await Notification.create({
                userId,
                title,
                body,
                data: { _id: String(shortVideoId), event: "short-assigned" },
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
              learningTitle: String(shortTitleById.get(shortVideoId) || ""),
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
        results.push({
          userId,
          shortVideoId,
          status: "error",
          message: String(e?.message || "Assignment failed"),
        });
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
