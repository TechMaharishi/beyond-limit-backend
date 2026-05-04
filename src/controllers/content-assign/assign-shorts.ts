import { Request, Response, NextFunction } from "express";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendSuccess, sendError } from "@/utils/api-response";
import { ShortAssignment, ShortAssignerRole } from "@/models/short-assignment";
import { ShortVideo } from "@/models/short-videos";
import { ShortVideoProgress } from "@/models/short-video-progress";
import admin from "@/config/firebase";
import { DeviceToken } from "@/models/device-token";
import { Notification } from "@/models/notification";
import { sendLearningAssignmentEmail } from "@/utils/mailer";
import { isRoleIn } from "@/utils/roles";
import { isValidObjectId } from "@/utils/mongodb";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_PAGE_SIZE = 100;

function resolveTrackingId(role: unknown, userId: string, activeProfileId?: string | null): string {
  return isRoleIn(role, "user") ? (activeProfileId || userId) : userId;
}

function buildShortAssignmentFilter(role: unknown, userId: string, activeProfileId?: string | null) {
  return isRoleIn(role, "user")
    ? { assignedToId: userId, profileId: activeProfileId || "" }
    : { assignedToId: userId };
}

function resolveAssignerRole(role: unknown): ShortAssignerRole {
  if (isRoleIn(role, "trainer")) return "trainer";
  if (isRoleIn(role, "trainee")) return "trainee";
  return "admin";
}

function resolveAllowedTargetRoles(role: unknown): string[] {
  if (isRoleIn(role, "admin")) return ["trainer", "trainee", "user"];
  if (isRoleIn(role, "trainer")) return ["trainee", "user"];
  return ["user"]; // trainee
}

function parsePagination(query: any) {
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.limit) || 10));
  const page = Math.max(1, Number(query.page) || 1);
  const offset = (page - 1) * limit;
  return { limit, page, offset };
}

function buildShortShape(sv: any) {
  if (!sv) return null;
  return {
    _id: String(sv._id),
    title: sv.title,
    description: sv.description || "",
    thumbnailUrl: sv.thumbnailUrl || "",
    tags: Array.isArray(sv.tags) ? sv.tags : [],
    status: sv.status,
    accessLevel: sv.accessLevel || null,
    visibility: sv.visibility || "users",
    createdBy: sv.createdBy
      ? { _id: String(sv.createdBy._id || ""), name: sv.createdBy.name || "", email: sv.createdBy.email || "" }
      : null,
    durationSeconds: Number(sv.durationSeconds || 0),
    createdAt: sv.createdAt,
    updatedAt: sv.updatedAt,
  };
}

function buildProgressShape(prog: { watchedSeconds: number; completed: boolean }, durationSeconds: number) {
  const watchedSeconds = durationSeconds > 0 ? Math.min(prog.watchedSeconds, durationSeconds) : prog.watchedSeconds;
  const percentCompleted = durationSeconds > 0
    ? Number(Math.min((watchedSeconds / durationSeconds) * 100, 100).toFixed(2))
    : 0;
  return { watchedSeconds, percentCompleted, completed: Boolean(prog.completed) };
}

async function fetchShortMap(shortIds: string[]) {
  if (shortIds.length === 0) return new Map<string, any>();
  const unique = [...new Set(shortIds)];
  const shorts = await ShortVideo.find({ _id: { $in: unique } })
    .select("title description thumbnailUrl tags status accessLevel visibility durationSeconds createdAt updatedAt createdBy")
    .lean();
  return new Map<string, any>(shorts.map((s: any) => [String(s._id), s]));
}

async function fetchProgressMap(trackingId: string, shortIds: string[]) {
  if (shortIds.length === 0) return new Map<string, { watchedSeconds: number; completed: boolean }>();
  const docs = await ShortVideoProgress.find({ trackingId, shortVideoId: { $in: shortIds } })
    .select("shortVideoId watchedSeconds completed")
    .lean();
  const map = new Map<string, { watchedSeconds: number; completed: boolean }>();
  for (const p of docs) {
    map.set(String((p as any).shortVideoId), {
      watchedSeconds: Number((p as any).watchedSeconds) || 0,
      completed: Boolean((p as any).completed),
    });
  }
  return map;
}

// ─── createShortAssignment ────────────────────────────────────────────────────

export const createShortAssignment = async (req: Request, res: Response, next: NextFunction) => {
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

    const callerRole = (user as any).role;
    const assignedByRole = resolveAssignerRole(callerRole);
    const allowedTargetRoles = resolveAllowedTargetRoles(callerRole);

    const { userId, shortVideoId, profileId } = req.body as {
      userId?: string;
      shortVideoId?: string;
      profileId?: string;
    };
    if (!userId || !shortVideoId) return sendError(res, 400, "userId and shortVideoId are required");
    if (!isValidObjectId(shortVideoId)) return sendError(res, 400, "shortVideoId is not a valid ObjectId");

    // Fetch video and target user in parallel — independent lookups
    const [video, listResult] = await Promise.all([
      ShortVideo.findById(shortVideoId).select("status title").lean(),
      auth.api.listUsers({
        query: { filterField: "id", filterValue: userId, limit: 1, offset: 0, sortBy: "createdAt", sortDirection: "desc" },
        headers: apiHeaders,
      }),
    ]);

    if (!video) return sendError(res, 404, "Short video not found");
    if ((video as any).status !== "published") {
      return sendError(res, 403, "Short video must be published to assign");
    }

    const targetUser = (listResult as any)?.users?.[0];
    if (!targetUser) return sendError(res, 404, "Assignee user not found");

    const targetRole = (targetUser as any).role;
    if (!isRoleIn(targetRole, ...allowedTargetRoles)) {
      return sendError(res, 403, `Assignee must have role ${allowedTargetRoles.join("/")}`);
    }

    // User-role accounts assign per-profile so each profile has its own assignment set
    const isUserTarget = isRoleIn(targetRole, "user");
    if (isUserTarget && !profileId) {
      return sendError(res, 400, "profileId is required when assigning to a user account");
    }
    const resolvedProfileId = isUserTarget ? (profileId as string) : "";

    const upsertResult = await ShortAssignment.updateOne(
      { assignedToId: userId, shortVideoId, assignedByRole, profileId: resolvedProfileId },
      {
        $setOnInsert: {
          assignedToId: userId,
          shortVideoId,
          profileId: resolvedProfileId,
          assignedById: (user as any).id,
          assignedByRole,
          assignedByName: (user as any).name || "",
        },
      },
      { upsert: true }
    );

    const wasInserted = upsertResult.upsertedCount > 0;
    if (!wasInserted) {
      return sendSuccess(res, 200, "Short already assigned");
    }

    // Push notification + in-app notification (fire-and-forget — do not await)
    void (async () => {
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
        await Notification.create({
          userId, title, body,
          data: { _id: String(shortVideoId), event: "short-assigned" },
          read: false,
        }).catch(() => {});
      } catch {}
    })();

    void sendLearningAssignmentEmail({
      to: String((targetUser as any)?.email || ""),
      firstName: String((targetUser as any)?.name || ""),
      learningTitle: String((video as any)?.title || ""),
      assignedByName: String((user as any)?.name || ""),
    }).catch(() => {});

    return sendSuccess(res, 201, "Short assigned to user");
  } catch (error) {
    return next(error);
  }
};

// ─── deleteShortAssignment ────────────────────────────────────────────────────

export const deleteShortAssignment = async (req: Request, res: Response, next: NextFunction) => {
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

    const callerRole = (user as any).role;
    const isAdmin = isRoleIn(callerRole, "admin");
    const assignedByRole = resolveAssignerRole(callerRole);

    const { userId, shortVideoId, profileId } = req.body as {
      userId?: string;
      shortVideoId?: string;
      profileId?: string;
    };
    if (!userId || !shortVideoId) return sendError(res, 400, "userId and shortVideoId are required");
    if (!isValidObjectId(shortVideoId)) return sendError(res, 400, "shortVideoId is not a valid ObjectId");

    // All roles (admin, trainer, trainee) can only unassign what they personally assigned
    const filter: any = {
      assignedToId: userId,
      shortVideoId,
      assignedById: (user as any).id,
      assignedByRole,
    };
    if (profileId) filter.profileId = profileId;
    else if (!isAdmin) filter.profileId = "";

    const result = await ShortAssignment.deleteOne(filter);
    const deletedCount = result.deletedCount || 0;

    if (deletedCount === 0) return sendError(res, 404, "No assignment found to remove");

    return sendSuccess(res, 200, "Short unassigned");
  } catch (error) {
    return next(error);
  }
};

// ─── deleteShortAssignmentsBulk ───────────────────────────────────────────────

export const deleteShortAssignmentsBulk = async (req: Request, res: Response, next: NextFunction) => {
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

    const callerRole = (user as any).role;
    const isAdmin = isRoleIn(callerRole, "admin");
    const assignedByRole = resolveAssignerRole(callerRole);

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) return sendError(res, 400, "items must be a non-empty array");
    if (items.length > 200) return sendError(res, 400, "Too many items; max 200");

    // Validate and collect unique conditions to delete
    type DeleteCondition = { assignedToId: string; shortVideoId: string; profileId?: string };
    const conditions: DeleteCondition[] = [];
    const invalid: Array<{ userId: string; shortVideoId: string; message: string }> = [];

    for (const it of items) {
      const userId = String(it?.userId || "");
      const shortVideoId = String(it?.shortVideoId || "");
      const profileId = typeof it?.profileId === "string" && it.profileId ? it.profileId : undefined;

      if (!userId || !shortVideoId) {
        invalid.push({ userId, shortVideoId, message: "Invalid item" });
        continue;
      }
      if (!isValidObjectId(shortVideoId)) {
        invalid.push({ userId, shortVideoId, message: "shortVideoId is not a valid ObjectId" });
        continue;
      }

      const cond: DeleteCondition = { assignedToId: userId, shortVideoId };
      // Always pin profileId — prevents accidental cross-profile deletion for all roles
      if (profileId) cond.profileId = profileId;
      else if (!isAdmin) cond.profileId = "";
      conditions.push(cond);
    }

    if (conditions.length === 0) {
      return sendError(res, 400, "No valid items to unassign", { invalid });
    }

    // All roles (admin, trainer, trainee) can only remove assignments they personally created
    const filter: any = {
      $or: conditions,
      assignedById: (user as any).id,
      assignedByRole,
    };

    const result = await ShortAssignment.deleteMany(filter);

    return sendSuccess(res, 200, "Bulk unassign processed", {
      requested: conditions.length,
      deleted: result.deletedCount,
      invalidItems: invalid.length > 0 ? invalid : undefined,
    });
  } catch (error) {
    return next(error);
  }
};

// ─── listShortAssignmentsForUser ──────────────────────────────────────────────
// Admin / trainer / trainee view of shorts assigned to a specific user account.
// Pass ?profileId= to scope to a single profile (for role=user targets).

export const listShortAssignmentsForUser = async (req: Request, res: Response, next: NextFunction) => {
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

    const profileId = req.query.profileId as string | undefined;
    const { limit, page, offset } = parsePagination(req.query);

    const filter: any = { assignedToId: userId };
    if (profileId) filter.profileId = profileId;

    const [docs, total] = await Promise.all([
      ShortAssignment.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      ShortAssignment.countDocuments(filter),
    ]);

    const shortIds = docs.map((d: any) => String(d.shortVideoId));
    const progressTrackingId = profileId || userId;

    // Fetch video details and progress in parallel
    const [shortMap, progressMap] = await Promise.all([
      fetchShortMap(shortIds),
      fetchProgressMap(progressTrackingId, shortIds),
    ]);

    const items = docs.map((a: any) => {
      const shortId = String(a.shortVideoId);
      const sv = shortMap.get(shortId);
      const durationSeconds = Number(sv?.durationSeconds || 0);
      const prog = progressMap.get(shortId) || { watchedSeconds: 0, completed: false };
      return {
        short: buildShortShape(sv),
        assignedBy: { id: String(a.assignedById), name: String(a.assignedByName || ""), role: String(a.assignedByRole || "") },
        assignedAt: a.createdAt,
        progress: buildProgressShape(prog, durationSeconds),
      };
    });

    return sendSuccess(res, 200, "Assigned shorts for user fetched", items, {
      page, offset, limit, total, hasNext: offset + items.length < total,
    });
  } catch (error) {
    return next(error);
  }
};

// ─── listMyShortAssignments ───────────────────────────────────────────────────
// Any authenticated user sees shorts assigned to them.
// For role=user: scoped to the active profile (activeProfileId in session).

export const listMyShortAssignments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const callerRole = (user as any).role;
    const userId = String((user as any).id);
    const isUserRole = isRoleIn(callerRole, "user");

    const activeProfileId: string | null = isUserRole
      ? ((session.session as any).activeProfileId as string | null) ?? null
      : null;

    if (isUserRole && !activeProfileId) {
      return sendError(res, 400, "No active profile selected. Please switch to a profile first.");
    }

    const { limit, page, offset } = parsePagination(req.query);
    const assignmentFilter = buildShortAssignmentFilter(callerRole, userId, activeProfileId);

    const [assignments, total] = await Promise.all([
      ShortAssignment.find(assignmentFilter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      ShortAssignment.countDocuments(assignmentFilter),
    ]);

    const shortIds = assignments.map((a: any) => String(a.shortVideoId));
    const progressTrackingId = resolveTrackingId(callerRole, userId, activeProfileId);

    // Fetch video details and progress in parallel
    const [shortMap, progressMap] = await Promise.all([
      fetchShortMap(shortIds),
      fetchProgressMap(progressTrackingId, shortIds),
    ]);

    const items = assignments.map((a: any) => {
      const shortId = String(a.shortVideoId);
      const sv = shortMap.get(shortId);
      const durationSeconds = Number(sv?.durationSeconds || 0);
      const prog = progressMap.get(shortId) || { watchedSeconds: 0, completed: false };
      return {
        short: buildShortShape(sv),
        assignedBy: { id: String(a.assignedById), name: String(a.assignedByName || ""), role: String(a.assignedByRole || "") },
        assignedAt: a.createdAt,
        progress: buildProgressShape(prog, durationSeconds),
      };
    });

    return sendSuccess(res, 200, "My assigned shorts fetched", items, {
      page, offset, limit, total, hasNext: offset + items.length < total,
    });
  } catch (error) {
    return next(error);
  }
};

// ─── listShortAssignmentsByMe ─────────────────────────────────────────────────
// Admin / trainer / trainee see the shorts they personally assigned.

export const listShortAssignmentsByMe = async (req: Request, res: Response, next: NextFunction) => {
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

    const callerRole = (user as any).role;
    const assignedByRole = resolveAssignerRole(callerRole);
    const { limit, page, offset } = parsePagination(req.query);

    const assignedByFilter = { assignedById: (user as any).id, assignedByRole };
    const [docs, total] = await Promise.all([
      ShortAssignment.find(assignedByFilter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      ShortAssignment.countDocuments(assignedByFilter),
    ]);

    const shortIds = docs.map((d: any) => String(d.shortVideoId));
    const shortMap = await fetchShortMap(shortIds);

    const items = docs.map((a: any) => {
      const sv = shortMap.get(String(a.shortVideoId));
      return {
        short: buildShortShape(sv),
        assignedTo: { id: String(a.assignedToId), profileId: a.profileId || null },
        assignedAt: a.createdAt,
      };
    });

    return sendSuccess(res, 200, "Shorts assigned by me fetched", items, {
      page, offset, limit, total, hasNext: offset + items.length < total,
    });
  } catch (error) {
    return next(error);
  }
};

// ─── createShortAssignmentsBulk ───────────────────────────────────────────────

export const createShortAssignmentsBulk = async (req: Request, res: Response, next: NextFunction) => {
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

    const callerRole = (user as any).role;
    const assignedByRole = resolveAssignerRole(callerRole);
    const allowedTargetRoles = resolveAllowedTargetRoles(callerRole);

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) return sendError(res, 400, "items array is required");
    if (items.length > 200) return sendError(res, 400, "Too many items; max 200");

    const uniqueUserIds = new Set<string>();
    const uniqueShortIds = new Set<string>();
    for (const it of items) {
      const uid = typeof it?.userId === "string" ? it.userId : "";
      const sid = typeof it?.shortVideoId === "string" ? it.shortVideoId : "";
      if (uid && sid && isValidObjectId(sid)) { uniqueUserIds.add(uid); uniqueShortIds.add(sid); }
    }
    if (uniqueUserIds.size === 0 || uniqueShortIds.size === 0) {
      return sendError(res, 400, "items must contain valid userId and shortVideoId");
    }

    // Fetch published shorts and all target users in parallel
    const [publishedShorts, userFetchResults] = await Promise.all([
      ShortVideo.find({ _id: { $in: Array.from(uniqueShortIds) as any }, status: "published" })
        .select("_id title").lean(),
      Promise.all(
        Array.from(uniqueUserIds).map(async (id) => {
          try {
            const result = await auth.api.listUsers({
              query: { filterField: "id", filterValue: id, limit: 1, offset: 0, sortBy: "createdAt", sortDirection: "desc" },
              headers: apiHeaders,
            });
            const u = (result as any)?.users?.[0];
            return u ? { id: String(u.id), role: u.role, email: String(u.email || ""), name: String(u.name || "") } : null;
          } catch {
            return null;
          }
        })
      ),
    ]);

    const validShortIds = new Set<string>(publishedShorts.map((s: any) => String(s._id)));
    const shortTitleById = new Map<string, string>(publishedShorts.map((s: any) => [String(s._id), String(s.title || "")]));

    const userInfoById = new Map<string, { role: any; email: string; name: string }>();
    for (const u of userFetchResults) {
      if (u) userInfoById.set(u.id, { role: u.role, email: u.email, name: u.name });
    }

    // ── Phase 1: validate each item and build the bulkWrite ops ─────────────────

    type ValidItem = {
      userId: string;
      shortVideoId: string;
      resolvedProfileId: string;
      targetInfo: { role: any; email: string; name: string };
      originalIndex: number;
    };

    const results: Array<{ userId: string; shortVideoId: string; profileId?: string; status: string; message?: string }> = [];
    const validItems: ValidItem[] = [];
    let failureCount = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const userId = String(it?.userId || "");
      const shortVideoId = String(it?.shortVideoId || "");
      const itemProfileId = typeof it?.profileId === "string" ? it.profileId : "";

      if (!userId || !shortVideoId) {
        results.push({ userId, shortVideoId, status: "error", message: "Invalid item" });
        failureCount++;
        continue;
      }
      if (!isValidObjectId(shortVideoId)) {
        results.push({ userId, shortVideoId, status: "error", message: "shortVideoId is not a valid ObjectId" });
        failureCount++;
        continue;
      }
      if (!validShortIds.has(shortVideoId)) {
        results.push({ userId, shortVideoId, status: "error", message: "Short not found or not published" });
        failureCount++;
        continue;
      }
      const targetInfo = userInfoById.get(userId);
      if (!targetInfo || !isRoleIn(targetInfo.role, ...allowedTargetRoles)) {
        results.push({ userId, shortVideoId, status: "error", message: `Assignee must have role ${allowedTargetRoles.join("/")}` });
        failureCount++;
        continue;
      }
      const isUserTarget = isRoleIn(targetInfo.role, "user");
      if (isUserTarget && !itemProfileId) {
        results.push({ userId, shortVideoId, status: "error", message: "profileId is required when assigning to a user account" });
        failureCount++;
        continue;
      }

      validItems.push({
        userId,
        shortVideoId,
        resolvedProfileId: isUserTarget ? itemProfileId : "",
        targetInfo,
        originalIndex: results.length, // placeholder index in results for this item
      });
      results.push({ userId, shortVideoId, status: "pending" }); // filled in after bulkWrite
    }

    // ── Phase 2: single bulkWrite for all valid items ────────────────────────────

    let successCount = 0;

    if (validItems.length > 0) {
      const ops = validItems.map((vi) => ({
        updateOne: {
          filter: { assignedToId: vi.userId, shortVideoId: vi.shortVideoId, assignedByRole, profileId: vi.resolvedProfileId },
          update: {
            $setOnInsert: {
              assignedToId: vi.userId,
              shortVideoId: vi.shortVideoId,
              profileId: vi.resolvedProfileId,
              assignedById: (user as any).id,
              assignedByRole,
              assignedByName: (user as any).name || "",
            },
          },
          upsert: true,
        },
      })) as any[];

      const bulkResult = await ShortAssignment.bulkWrite(ops, { ordered: false });

      // `upsertedIds` is a map of op-index → ObjectId for newly inserted docs
      const insertedIndices = new Set<number>(
        Object.keys(bulkResult.upsertedIds ?? {}).map(Number)
      );

      for (let i = 0; i < validItems.length; i++) {
        const vi = validItems[i];
        const wasInserted = insertedIndices.has(i);

        if (wasInserted) {
          const title = "New learning assigned";
          const body = `New short assigned by ${String((user as any).name || "Unknown")}`;

          // Fire-and-forget push + in-app notification
          void (async () => {
            try {
              const tokenDoc = await DeviceToken.findOne({ userId: vi.userId }).lean();
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
                    data: { _id: String(vi.shortVideoId), event: "short-assigned" },
                  } as any);
                }
              }
              await Notification.create({
                userId: vi.userId, title, body,
                data: { _id: String(vi.shortVideoId), event: "short-assigned" },
                read: false,
              }).catch(() => {});
            } catch {}
          })();

          // Fire-and-forget email
          void sendLearningAssignmentEmail({
            to: vi.targetInfo.email,
            firstName: vi.targetInfo.name,
            learningTitle: shortTitleById.get(vi.shortVideoId) || "",
            assignedByName: String((user as any)?.name || ""),
          }).catch(() => {});

          results[vi.originalIndex] = {
            userId: vi.userId,
            shortVideoId: vi.shortVideoId,
            profileId: vi.resolvedProfileId || undefined,
            status: "assigned",
          };
        } else {
          results[vi.originalIndex] = {
            userId: vi.userId,
            shortVideoId: vi.shortVideoId,
            profileId: vi.resolvedProfileId || undefined,
            status: "alreadyAssigned",
          };
        }
        successCount++;
      }
    }

    return sendSuccess(res, 201, "Bulk assignment processed", { successes: successCount, failures: failureCount, results });
  } catch (error) {
    return next(error);
  }
};
