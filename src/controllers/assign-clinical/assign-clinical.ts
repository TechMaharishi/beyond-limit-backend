import { Request, Response, NextFunction } from "express";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendError, sendSuccess } from "@/utils/api-response";
import { ClinicalAssignment } from "@/models/clinical-assignment";
import firebaseAdmin from "@/config/firebase";
import { DeviceToken } from "@/models/device-token";
import { Notification } from "@/models/notification";

const MAX_PAGE_SIZE = 100;

function parsePagination(query: Record<string, any>): { limit: number; page: number; offset: number } {
  const rawLimit = Number(query.limit);
  const rawPage = Number(query.page);
  const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10, MAX_PAGE_SIZE);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  return { limit, page, offset: (page - 1) * limit };
}

function sendClinicalNotification(
  userId: string,
  clinicianId: string,
  event: "clinician-assigned" | "clinician-unassigned",
  title: string,
  body: string
) {
  void (async () => {
    try {
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
            data: { _id: String(clinicianId), event },
          } as any);
        }
      }
      try {
        await Notification.create({ userId, title, body, data: { _id: String(clinicianId), event }, read: false });
      } catch {}
    } catch {}
  })();
}

// ─── POST /assign-clinical/assign ────────────────────────────────────────────
// Admin only. Assigns a clinician (trainer or trainee) to a user's profile.

export const assignTraineeToUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canAssign = await auth.api.userHasPermission({
      body: { permissions: { clinicalAssign: ["create"] } },
      headers: apiHeaders,
    });
    if (!canAssign?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const body = req.body as {
      userId?: string;
      profileId?: string;
      clinicianRole?: string;
      clinicianId?: string;
      traineeId?: string;
      clinicianEmail?: string;
      traineeEmail?: string;
      clinicianName?: string;
      traineeName?: string;
    };

    const userId    = typeof body?.userId    === "string" ? body.userId.trim()    : "";
    const profileId = typeof body?.profileId === "string" ? body.profileId.trim() : "";

    if (!userId)    return sendError(res, 400, "userId is required");

    const clinicianRoleRaw = typeof body?.clinicianRole === "string" ? body.clinicianRole : undefined;
    if (clinicianRoleRaw !== undefined && clinicianRoleRaw !== "trainee" && clinicianRoleRaw !== "trainer") {
      return sendError(res, 400, "clinicianRole must be 'trainee' or 'trainer'");
    }
    const clinicianRole: "trainee" | "trainer" = clinicianRoleRaw === "trainer" ? "trainer" : "trainee";

    const clinicianId =
      typeof body?.clinicianId === "string" && body.clinicianId.trim().length > 0
        ? body.clinicianId.trim()
        : typeof body?.traineeId === "string"
        ? body.traineeId.trim()
        : undefined;
    const clinicianEmail =
      typeof body?.clinicianEmail === "string" && body.clinicianEmail.trim().length > 0
        ? body.clinicianEmail.trim()
        : typeof body?.traineeEmail === "string"
        ? body.traineeEmail.trim()
        : undefined;
    const clinicianName =
      typeof body?.clinicianName === "string" && body.clinicianName.trim().length > 0
        ? body.clinicianName.trim()
        : typeof body?.traineeName === "string"
        ? body.traineeName.trim()
        : undefined;

    if (!clinicianId || clinicianId.length === 0) {
      const existing = await ClinicalAssignment.findOne({ userId, profileId }).lean();
      return sendSuccess(res, 200, "No clinician selected; no changes made", existing || null);
    }

    if (clinicianId === userId) return sendError(res, 400, "A user cannot be their own clinician");

    if (!clinicianEmail || !clinicianName || clinicianEmail.length === 0 || clinicianName.length === 0) {
      return sendError(res, 400, "clinicianEmail and clinicianName are required when assigning a clinician");
    }

    const existingDoc = await ClinicalAssignment.findOne({ userId, profileId }).lean() as { clinicians?: any[] } | null;
    const clinicians = Array.isArray(existingDoc?.clinicians) ? existingDoc.clinicians : [];
    const hasLink = clinicians.some(
      (c: any) => String(c.clinicianId) === clinicianId && String(c.clinicianRole) === clinicianRole
    );
    if (!hasLink && clinicians.length >= 5) return sendError(res, 400, "Maximum 5 clinicians allowed");

    if (hasLink) {
      await ClinicalAssignment.updateOne(
        { userId, profileId },
        {
          $set: {
            "clinicians.$[c].clinicianEmail": clinicianEmail,
            "clinicians.$[c].clinicianName": clinicianName,
          },
        },
        { arrayFilters: [{ "c.clinicianId": clinicianId, "c.clinicianRole": clinicianRole }] }
      );
    } else {
      // Step 1: ensure document exists for (userId, profileId)
      await ClinicalAssignment.updateOne(
        { userId, profileId },
        { $setOnInsert: { userId, profileId, clinicians: [] } },
        { upsert: true }
      );
      // Step 2: push — doc is guaranteed to exist, so $expr + $elemMatch are safe
      const pushResult = await ClinicalAssignment.updateOne(
        {
          userId,
          profileId,
          $expr: { $lt: [{ $size: { $ifNull: ["$clinicians", []] } }, 5] },
          clinicians: { $not: { $elemMatch: { clinicianId, clinicianRole } } },
        },
        {
          $push: {
            clinicians: {
              clinicianId,
              clinicianRole,
              clinicianEmail,
              clinicianName,
            },
          },
        }
      );
      if (pushResult.matchedCount === 0) {
        return sendError(res, 400, "Maximum clinicians reached or clinician already assigned");
      }
    }

    const updated = await ClinicalAssignment.findOne({ userId, profileId }).lean();

    sendClinicalNotification(
      userId,
      clinicianId,
      "clinician-assigned",
      "New clinician assigned",
      `Connected with a new clinician: ${clinicianName}`
    );

    return sendSuccess(res, 200, "Clinician assignment updated", updated);
  } catch (error) {
    next(error);
  }
};

// ─── DELETE /assign-clinical/assign ──────────────────────────────────────────

export const unassignTraineeFromUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canDelete = await auth.api.userHasPermission({
      body: { permissions: { clinicalAssign: ["delete"] } },
      headers: apiHeaders,
    });
    if (!canDelete?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const body = req.body as { userId?: string; profileId?: string; clinicianId?: string; clinicianRole?: string };
    const userId    = typeof body?.userId    === "string" ? body.userId.trim()    : "";
    const profileId = typeof body?.profileId === "string" ? body.profileId.trim() : "";
    const { clinicianId } = body;

    if (!userId) return sendError(res, 400, "userId is required");

    const clinicianRoleRaw = typeof body?.clinicianRole === "string" ? body.clinicianRole : undefined;
    if (clinicianRoleRaw !== undefined && clinicianRoleRaw !== "trainee" && clinicianRoleRaw !== "trainer") {
      return sendError(res, 400, "clinicianRole must be 'trainee' or 'trainer'");
    }
    const clinicianRole: "trainee" | "trainer" | undefined =
      clinicianRoleRaw === "trainer" ? "trainer" : clinicianRoleRaw === "trainee" ? "trainee" : undefined;

    const existing = await ClinicalAssignment.findOne({ userId, profileId }).lean() as { clinicians?: any[] } | null;
    if (!existing || !Array.isArray(existing.clinicians) || existing.clinicians.length === 0) {
      return sendSuccess(res, 200, "No clinician assigned; no changes made", null);
    }

    if (!clinicianId || !clinicianRole) {
      const arr = existing.clinicians;
      if (arr.length === 1) {
        await ClinicalAssignment.updateOne(
          { userId, profileId },
          { $pull: { clinicians: { clinicianId: String(arr[0].clinicianId), clinicianRole: String(arr[0].clinicianRole) } } }
        );
      } else {
        return sendError(res, 400, "clinicianId and clinicianRole are required when multiple clinicians are assigned");
      }
    } else {
      const result = await ClinicalAssignment.updateOne(
        { userId, profileId },
        { $pull: { clinicians: { clinicianId, clinicianRole } } }
      );
      if (!result.modifiedCount) {
        return sendSuccess(res, 200, "No matching clinician assignment found; no changes made", null);
      }
    }

    sendClinicalNotification(
      userId,
      clinicianId || "",
      "clinician-unassigned",
      "Clinician disconnected",
      "Disconnected from clinician"
    );

    return sendSuccess(res, 200, "Clinician unassigned");
  } catch (error) {
    next(error);
  }
};

// ─── GET /assign-clinical/:userId ─────────────────────────────────────────────
// Returns clinicians for a specific (userId, profileId) pair.
// profileId query param is optional — omit to get the default profile's clinicians.

export const getAssignedTraineeForUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { clinicalAssign: ["view"] } },
      headers: apiHeaders,
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const { userId } = req.params as { userId?: string };
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      return sendError(res, 400, "userId param is required");
    }

    const profileId = typeof req.query.profileId === "string" ? req.query.profileId.trim() : "";

    const assignment = await ClinicalAssignment.findOne({ userId, profileId }).lean() as { clinicians?: any[] } | null;
    const clinicians = Array.isArray(assignment?.clinicians) ? assignment.clinicians : [];
    const payload = {
      userId,
      profileId,
      clinicians: clinicians.map((c: any) => ({
        clinicianId:    String(c.clinicianId    || ""),
        clinicianRole:  String(c.clinicianRole  || ""),
        clinicianEmail: String(c.clinicianEmail || ""),
        clinicianName:  String(c.clinicianName  || ""),
      })),
    };

    return sendSuccess(res, 200, "Clinician assignments fetched", payload);
  } catch (error) {
    next(error);
  }
};

// ─── GET /assign-clinical/trainee/:traineeId ──────────────────────────────────

export const getUsersAssignedToTrainee = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { clinicalAssign: ["view"] } },
      headers: apiHeaders,
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const { traineeId } = req.params as { traineeId?: string };
    if (!traineeId || typeof traineeId !== "string" || traineeId.trim().length === 0) {
      return sendError(res, 400, "traineeId param is required");
    }

    const { limit, page, offset } = parsePagination(req.query as any);

    const filter = { clinicians: { $elemMatch: { clinicianId: traineeId, clinicianRole: "trainee" } } };

    const [docs, total] = await Promise.all([
      ClinicalAssignment.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      ClinicalAssignment.countDocuments(filter),
    ]);

    const ids = docs.map((d: any) => String(d.userId)).filter(Boolean);

    const userResults = await Promise.all(
      ids.map((id) =>
        auth.api
          .listUsers({
            query: { filterField: "id", filterValue: id, limit: 1, offset: 0, sortBy: "createdAt", sortDirection: "desc" },
            headers: fromNodeHeaders(req.headers),
          })
          .catch(() => null)
      )
    );

    const out = ids.map((id, i) => {
      const result = userResults[i];
      const u = result && Array.isArray(result.users) ? result.users[0] : null;
      const doc = docs[i] as any;
      return {
        id,
        profileId: String(doc?.profileId || ""),
        name: String(u?.name || ""),
        email: String(u?.email || ""),
      };
    });

    return sendSuccess(res, 200, "Assigned users for trainee fetched", out, {
      page,
      offset,
      limit,
      total,
      hasNext: offset + out.length < total,
    });
  } catch (error) {
    next(error);
  }
};
