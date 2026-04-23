import { Request, Response, NextFunction } from "express";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendError, sendSuccess } from "@/utils/api-response";
import { ClinicalAssignment } from "@/models/clinical-assignment";
import admin from "@/config/firebase";
import { DeviceToken } from "@/models/device-token";
import { Notification } from "@/models/notification";


export const assignTraineeToUser = async (
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
    const canUpdate = await auth.api.userHasPermission({
      body: { permissions: { trainee: ["update"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canUpdate?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const body = req.body as any;
    const userId = typeof body?.userId === "string" ? body.userId : undefined;
    const clinicianRoleRaw: any =
      typeof body?.clinicianRole === "string" ? body.clinicianRole : undefined;
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
    const clinicianRole: "trainee" | "trainer" =
      clinicianRoleRaw === "trainer" ? "trainer" : "trainee";

    if (!userId || userId.trim().length === 0) {
      return sendError(res, 400, "userId is required");
    }

    if (!clinicianId || clinicianId.trim().length === 0) {
      const existing = await ClinicalAssignment.findOne({ userId }).lean();
      return sendSuccess(
        res,
        200,
        "No clinician selected; no changes made",
        existing || null
      );
    }

    if (clinicianId === userId) {
      return sendError(res, 400, "A user cannot be their own trainee");
    }

    if (
      !clinicianEmail ||
      !clinicianName ||
      clinicianEmail.trim().length === 0 ||
      clinicianName.trim().length === 0
    ) {
      return sendError(
        res,
        400,
        "clinicianEmail and clinicianName are required when assigning a clinician"
      );
    }

    const existingDoc = await ClinicalAssignment.findOne({ userId }).lean();
    const clinicians = Array.isArray((existingDoc as any)?.clinicians)
      ? (existingDoc as any).clinicians
      : [];
    const hasLink = clinicians.some(
      (c: any) =>
        String((c as any).clinicianId) === clinicianId &&
        String((c as any).clinicianRole) === clinicianRole
    );
    if (!hasLink && clinicians.length >= 5) {
      return sendError(res, 400, "Maximum clinicians reached");
    }

    if (hasLink) {
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
    } else if (existingDoc) {
      await ClinicalAssignment.updateOne(
        { userId },
        {
          $push: {
            clinicians: {
              clinicianId,
              clinicianRole,
              clinicianEmail: clinicianEmail.trim(),
              clinicianName: clinicianName.trim(),
            },
          },
        }
      );
    } else {
      await ClinicalAssignment.create({
        userId,
        clinicians: [
          {
            clinicianId,
            clinicianRole,
            clinicianEmail: clinicianEmail.trim(),
            clinicianName: clinicianName.trim(),
          },
        ],
      });
    }
    const updated = await ClinicalAssignment.findOne({ userId }).lean();

    try {
      const tokenDoc = await DeviceToken.findOne({ userId }).lean();
      const title = "New learning assigned";
      const body = `Connected with a new clinician: ${String(clinicianName).trim()}`;
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
            data: { _id: String(clinicianId), event: "clinician-assigned" },
          } as any;
          await admin.messaging().send(fcmMessage);
        }
      }
      try {
        await Notification.create({
          userId,
          title,
          body,
          data: { _id: String(clinicianId), event: "clinician-assigned" },
          read: false,
        });
      } catch {}
    } catch {}

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
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");
    const canUpdate = await auth.api.userHasPermission({
      body: { permissions: { trainee: ["update"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canUpdate?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }
    const { userId, clinicianId, clinicianRole } = req.body as {
      userId?: string;
      clinicianId?: string;
      clinicianRole?: "trainee" | "trainer";
    };
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
          { $pull: { clinicians: { clinicianId: String((arr[0] as any).clinicianId), clinicianRole: String((arr[0] as any).clinicianRole) } } }
        );
      } else {
        return sendError(res, 400, "clinicianId and clinicianRole are required");
      }
    } else {
      const result = await ClinicalAssignment.updateOne(
        { userId },
        { $pull: { clinicians: { clinicianId, clinicianRole } } }
      );
      if (!result.modifiedCount) {
        return sendSuccess(res, 200, "No clinician assignment found; no changes made", null);
      }
    }
    try {
      const tokenDoc = await DeviceToken.findOne({ userId }).lean();
      const title = "Clinician disconnected";
      const body = `Disconnected from clinician`;
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
            data: { _id: String(clinicianId || ""), event: "clinician-unassigned" },
          } as any;
          await admin.messaging().send(fcmMessage);
        }
      }
      try {
        await Notification.create({
          userId,
          title,
          body,
          data: { _id: String(clinicianId || ""), event: "clinician-unassigned" },
          read: false,
        });
      } catch {}
    } catch {}
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
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");
    const canView = await auth.api.userHasPermission({
      body: { permissions: { trainee: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const { userId } = req.params as { userId?: string };
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      return sendError(res, 400, "userId param is required");
    }

    const assignment = await ClinicalAssignment.findOne({ userId }).lean();
    const clinicians = Array.isArray((assignment as any)?.clinicians)
      ? (assignment as any).clinicians
      : [];
    const payload = {
      userId,
      clinicians: clinicians.map((c: any) => ({
        clinicianId: String((c as any).clinicianId || ""),
        clinicianRole: String((c as any).clinicianRole || ""),
        clinicianEmail: String((c as any).clinicianEmail || ""),
        clinicianName: String((c as any).clinicianName || ""),
      })),
    };

    return sendSuccess(
      res,
      200,
      "Clinician assignments fetched",
      payload
    );
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
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");
    const canView = await auth.api.userHasPermission({
      body: { permissions: { trainee: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const { traineeId } = req.params as { traineeId?: string };
    if (!traineeId || typeof traineeId !== "string" || traineeId.trim().length === 0) {
      return sendError(res, 400, "traineeId param is required");
    }

    const rawLimit = Number(req.query.limit);
    const rawPage = Number(req.query.page);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const offset = (page - 1) * limit;

    const docs = await ClinicalAssignment.find({
      "clinicians.clinicianId": traineeId,
      "clinicians.clinicianRole": "trainee",
    })
      .sort({ createdAt: -1 })
      .lean();

    const total = docs.length;
    const sliced = docs.slice(offset, offset + limit);
    const ids = sliced.map((d: any) => String((d as any).userId)).filter(Boolean);

    const out: any[] = [];
    for (const id of ids) {
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
        out.push({
          id,
          name: String((u as any)?.name || ""),
          email: String((u as any)?.email || ""),
        });
      } catch {
        out.push({ id, name: "", email: "" });
      }
    }

    const hasNext = offset + sliced.length < total;
    return sendSuccess(res, 200, "Assigned users for trainee fetched", out, {
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
