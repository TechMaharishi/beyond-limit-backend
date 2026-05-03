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

export const assignTraineeToUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canUpdate = await auth.api.userHasPermission({
      body: { permissions: { trainee: ["update"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canUpdate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const body = req.body as any;
    const userId = typeof body?.userId === "string" ? body.userId : undefined;

    // Explicit role validation — reject anything other than the two valid values
    const clinicianRoleRaw = typeof body?.clinicianRole === "string" ? body.clinicianRole : undefined;
    if (clinicianRoleRaw !== undefined && clinicianRoleRaw !== "trainee" && clinicianRoleRaw !== "trainer") {
      return sendError(res, 400, "clinicianRole must be 'trainee' or 'trainer'");
    }
    const clinicianRole: "trainee" | "trainer" = clinicianRoleRaw === "trainer" ? "trainer" : "trainee";

    const clinicianId =
      typeof body?.clinicianId === "string" && body.clinicianId.trim().length > 0
        ? body.clinicianId
        : typeof body?.traineeId === "string"
        ? body.traineeId
        : undefined;
    const clinicianEmail =
      typeof body?.clinicianEmail === "string" && body.clinicianEmail.trim().length > 0
        ? body.clinicianEmail
        : typeof body?.traineeEmail === "string"
        ? body.traineeEmail
        : undefined;
    const clinicianName =
      typeof body?.clinicianName === "string" && body.clinicianName.trim().length > 0
        ? body.clinicianName
        : typeof body?.traineeName === "string"
        ? body.traineeName
        : undefined;

    if (!userId || userId.trim().length === 0) return sendError(res, 400, "userId is required");

    if (!clinicianId || clinicianId.trim().length === 0) {
      const existing = await ClinicalAssignment.findOne({ userId }).lean();
      return sendSuccess(res, 200, "No clinician selected; no changes made", existing || null);
    }

    if (clinicianId === userId) return sendError(res, 400, "A user cannot be their own clinician");

    if (!clinicianEmail || !clinicianName || clinicianEmail.trim().length === 0 || clinicianName.trim().length === 0) {
      return sendError(res, 400, "clinicianEmail and clinicianName are required when assigning a clinician");
    }

    // Read existing doc once for pre-checks (hasLink + max-5 guard)
    const existingDoc = await ClinicalAssignment.findOne({ userId }).lean();
    const clinicians = Array.isArray((existingDoc as any)?.clinicians) ? (existingDoc as any).clinicians : [];
    const hasLink = clinicians.some(
      (c: any) => String(c.clinicianId) === clinicianId && String(c.clinicianRole) === clinicianRole
    );
    if (!hasLink && clinicians.length >= 5) return sendError(res, 400, "Maximum 5 clinicians allowed");

    if (hasLink) {
      // Update name/email only — atomic positional update, no race condition
      await ClinicalAssignment.updateOne(
        { userId },
        {
          $set: {
            "clinicians.$[c].clinicianEmail": clinicianEmail.trim(),
            "clinicians.$[c].clinicianName": clinicianName.trim(),
          },
        },
        { arrayFilters: [{ "c.clinicianId": clinicianId, "c.clinicianRole": clinicianRole }] }
      );
    } else {
      // Atomic add: filter prevents concurrent over-push (> 5) or duplicate
      // If another request sneaks in and fills the 5th slot, the upsert will hit a
      // duplicate-key error (userId unique index) — we catch E11000 and surface a
      // clean 400 instead of a 500.
      try {
        await ClinicalAssignment.findOneAndUpdate(
          {
            userId,
            $expr: { $lt: [{ $size: { $ifNull: ["$clinicians", []] } }, 5] },
            clinicians: { $not: { $elemMatch: { clinicianId, clinicianRole } } },
          },
          {
            $push: {
              clinicians: {
                clinicianId,
                clinicianRole,
                clinicianEmail: clinicianEmail.trim(),
                clinicianName: clinicianName.trim(),
              },
            },
          },
          { upsert: true }
        );
      } catch (e: any) {
        if (e.code === 11000) {
          // Concurrent request filled the last slot or added the same clinician
          return sendError(res, 400, "Maximum clinicians reached or clinician already assigned");
        }
        throw e;
      }
    }

    const updated = await ClinicalAssignment.findOne({ userId }).lean();

    sendClinicalNotification(
      userId,
      clinicianId,
      "clinician-assigned",
      "New clinician assigned",
      `Connected with a new clinician: ${String(clinicianName).trim()}`
    );

    return sendSuccess(res, 200, "Clinician assignment updated", updated);
  } catch (error) {
    next(error);
  }
};

export const unassignTraineeFromUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canUpdate = await auth.api.userHasPermission({
      body: { permissions: { trainee: ["update"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canUpdate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const { userId, clinicianId } = req.body as { userId?: string; clinicianId?: string };
    const clinicianRoleRaw = typeof req.body?.clinicianRole === "string" ? req.body.clinicianRole : undefined;

    // Explicit role validation
    if (clinicianRoleRaw !== undefined && clinicianRoleRaw !== "trainee" && clinicianRoleRaw !== "trainer") {
      return sendError(res, 400, "clinicianRole must be 'trainee' or 'trainer'");
    }
    const clinicianRole: "trainee" | "trainer" | undefined =
      clinicianRoleRaw === "trainer" ? "trainer" : clinicianRoleRaw === "trainee" ? "trainee" : undefined;

    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      return sendError(res, 400, "userId is required");
    }

    const existing = await ClinicalAssignment.findOne({ userId }).lean();
    if (!existing || !Array.isArray((existing as any)?.clinicians) || (existing as any).clinicians.length === 0) {
      return sendSuccess(res, 200, "No clinician assigned; no changes made", null);
    }

    if (!clinicianId || !clinicianRole) {
      const arr = (existing as any).clinicians as any[];
      if (arr.length === 1) {
        await ClinicalAssignment.updateOne(
          { userId },
          { $pull: { clinicians: { clinicianId: String(arr[0].clinicianId), clinicianRole: String(arr[0].clinicianRole) } } }
        );
      } else {
        return sendError(res, 400, "clinicianId and clinicianRole are required when multiple clinicians are assigned");
      }
    } else {
      const result = await ClinicalAssignment.updateOne(
        { userId },
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

export const getAssignedTraineeForUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { trainee: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const { userId } = req.params as { userId?: string };
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      return sendError(res, 400, "userId param is required");
    }

    const assignment = await ClinicalAssignment.findOne({ userId }).lean();
    const clinicians = Array.isArray((assignment as any)?.clinicians) ? (assignment as any).clinicians : [];
    const payload = {
      userId,
      clinicians: clinicians.map((c: any) => ({
        clinicianId: String(c.clinicianId || ""),
        clinicianRole: String(c.clinicianRole || ""),
        clinicianEmail: String(c.clinicianEmail || ""),
        clinicianName: String(c.clinicianName || ""),
      })),
    };

    return sendSuccess(res, 200, "Clinician assignments fetched", payload);
  } catch (error) {
    next(error);
  }
};

export const getUsersAssignedToTrainee = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { trainee: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const { traineeId } = req.params as { traineeId?: string };
    if (!traineeId || typeof traineeId !== "string" || traineeId.trim().length === 0) {
      return sendError(res, 400, "traineeId param is required");
    }

    const { limit, page, offset } = parsePagination(req.query as any);

    // $elemMatch ensures both conditions are on the same array element
    const filter = { clinicians: { $elemMatch: { clinicianId: traineeId, clinicianRole: "trainee" } } };

    const [docs, total] = await Promise.all([
      ClinicalAssignment.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      ClinicalAssignment.countDocuments(filter),
    ]);

    const ids = docs.map((d: any) => String(d.userId)).filter(Boolean);

    // Parallel user lookups — bounded by MAX_PAGE_SIZE (100)
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
      const u = (userResults[i] as any)?.users?.[0];
      return { id, name: String(u?.name || ""), email: String(u?.email || "") };
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
