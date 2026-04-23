import { NextFunction, Request, Response } from "express";
import { auth, db } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendAccountCredentialsEmail } from "@/utils/mailer";
import { subscribeEmailToMailchimpSafe } from "@/utils/mailchimp";
import { ClinicalAssignment } from "@/models/clinical-assignment";
import { Profile } from "@/models/profile";
import { clearProfileFromAllSessions, clearAllActiveProfilesForUser } from "@/lib/profile-session";


// Role-based user creation endpoint
export const CreateRolebaseUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const role = req.body.role as string;

    if (["admin", "trainer", "trainee", "user"].includes(role) === false) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session || !session.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { user: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });

    if (!canCreate?.success) return res.status(403).json({ message: "Forbidden" });    

    const rawAccountType = String((req.body?.accountType ?? "")).toLowerCase().trim();
    const allowedAccountTypes = ["free", "develop", "master"];
    const accountType = rawAccountType && allowedAccountTypes.includes(rawAccountType) ? rawAccountType : "free";
    const phone = typeof (req.body as any)?.phone === "string" ? (req.body as any).phone : undefined;
    const rawNewsletter = (req.body as any)?.newsletter;
    const newsletter = String(rawNewsletter).toLowerCase() === "true" || rawNewsletter === true;
    const newUser = await auth.api.createUser({
      body: {
        email: req.body.email,
        password: req.body.password,
        name: req.body.name,
        role: req.body.role,
        data: { accountType, phone, newsletter },
      },
    });

    await sendAccountCredentialsEmail({
      to: req.body.email,
      username: req.body.email,
      password: req.body.password,
      firstName: typeof req.body.name === "string" ? String(req.body.name).split(/\s+/)[0] : undefined,
    });

    if (newsletter && typeof req.body.email === "string") {
      const name = typeof req.body.name === "string" ? req.body.name : undefined;
      await subscribeEmailToMailchimpSafe({
        email: String(req.body.email),
        name,
        tags: ["mobile-application"],
      });
    }

    return res.status(201).json({ data: newUser });
  } catch (error) {
    return next(error);
  }
};

// Query params: role=admin|trainer|trainee|user, search=string, field=name|email, page=number, limit=number
export const ListUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const permission = await auth.api.userHasPermission({
      body: { permissions: { user: ["list"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!permission?.success) {
      return res.status(403).json({ error: "Not allowed to list users" });
    }

    const role = (req.query.role as string) || "";
    const search = (req.query.search as string) || "";
    const field = (req.query.field as string) || "name";
    const sortBy = (req.query.sortBy as string) || "createdAt";
    const sortDirection = (req.query.sortDirection as string) || "asc";

    // Validate role and field
    const allowedRoles = ["admin", "trainer", "trainee", "user"];
    const allowedFields = ["email", "name"];
    const allowedSortFields = ["createdAt", "updatedAt", "name", "email"];
    const allowedSortDirections = ["asc", "desc"];

    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ error: "Invalid search field" });
    }
    if (!allowedSortFields.includes(sortBy)) {
      return res.status(400).json({ error: "Invalid sort field" });
    }
    if (!allowedSortDirections.includes(sortDirection)) {
      return res.status(400).json({ error: "Invalid sort direction" });
    }

    // Pagination bounds and validation
    const rawPage = Number(req.query.page);
    const rawLimit = Number(req.query.limit);
    const page = !isNaN(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 10; // Max 100 per page
    const offset = (page - 1) * limit;

    // Page data
    const pageResult = await auth.api.listUsers({
      query: {
        searchValue: search || undefined,
        searchField: field as "email" | "name",
        filterField: role ? "role" : undefined,
        filterValue: role || undefined,
        limit,
        offset,
        sortBy: sortBy as any,
        sortDirection: sortDirection as "asc" | "desc",
        searchOperator: "contains",
      },
      headers: fromNodeHeaders(req.headers),
    });

    // Better Auth Admin API returns an object: { users, total, limit, offset }
    const { users, total, limit: appliedLimit, offset: appliedOffset } = pageResult as {
      users: any[];
      total: number;
      limit?: number;
      offset?: number;
    };

    const finalLimit = appliedLimit ?? limit;
    const finalOffset = appliedOffset ?? offset;
    const totalPages = Math.ceil(total / finalLimit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    const idsForAssignments = (users || [])
      .filter((u: any) => {
        const r = (u as any).role;
        return Array.isArray(r) ? r.includes("user") : r === "user";
      })
      .map((u: any) => String(u.id));

    let assignmentMap: Record<string, { name: string | null; email: string | null; id: string | null }> = {};
    if (idsForAssignments.length > 0) {
      const assignments = await ClinicalAssignment.find({ userId: { $in: idsForAssignments } }).lean();
      assignmentMap = Object.fromEntries(
        (assignments || []).map((a: any) => [
          String(a.userId),
          {
            name: a.traineeName ?? null,
            email: a.traineeEmail ?? null,
            id: a.traineeId ?? null,
          },
        ])
      );
    }

    return res.status(200).json({
      data: {
        users: (users || []).map((u: any) => {
          const isUser = Array.isArray((u as any).role) ? (u as any).role.includes("user") : (u as any).role === "user";
          const assignment = isUser ? assignmentMap[String(u.id)] : null;

          return {
            name: u.name,
            email: u.email,
            emailVerified: Boolean(u.emailVerified),
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
            role: (u as any).role,
            banned: Boolean(u.banned),
            phone: (u as any).phone,
            accountType: (u as any).accountType,
            id: u.id,
            traineeName: assignment?.name ?? null,
            traineeEmail: assignment?.email ?? null,
            traineeId: assignment?.id ?? null,
          };
        }),
        meta: {
          page,
          offset: finalOffset,
          limit: finalLimit,
          total,
          totalPages,
          hasNext,
          hasPrev,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const ListUserBadPagination = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const permission = await auth.api.userHasPermission({
      body: { permissions: { user: ["list"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!permission?.success) {
      return res.status(403).json({ error: "Not allowed to list users" });
    }

    const role = (req.query.role as string) || "";
    const search = (req.query.search as string) || "";
    const field = (req.query.field as string) || "name";
    const sortBy = (req.query.sortBy as string) || "createdAt";
    const sortDirection = (req.query.sortDirection as string) || "asc";
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const offset = (page - 1) * limit;

    // Validate role and field
    const allowedRoles = ["admin", "trainer", "trainee", "user"];
    const allowedFields = ["email", "name"];
    const allowedSortFields = ["createdAt", "updatedAt", "name", "email"];
    const allowedSortDirections = ["asc", "desc"];

    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ error: "Invalid search field" });
    }
    if (!allowedSortFields.includes(sortBy)) {
      return res.status(400).json({ error: "Invalid sort field" });
    }
    if (!allowedSortDirections.includes(sortDirection)) {
      return res.status(400).json({ error: "Invalid sort direction" });
    }

    // Page data
    const pageResult = await auth.api.listUsers({
      query: {
        searchValue: search || undefined,
        searchField: field as "email" | "name",
        filterField: role ? "role" : undefined,
        filterValue: role || undefined,
        limit,
        offset,
        sortBy: sortBy as any,
        sortDirection: sortDirection as "asc" | "desc",
        searchOperator: "contains",
      },
      headers: fromNodeHeaders(req.headers),
    });

    // Better Auth Admin API returns an object: { users, total, limit, offset }
    const { users, total, limit: appliedLimit } = pageResult as {
      users: any[];
      total: number;
      limit?: number;
      offset?: number;
    };

    const idsForAssignments = (users || [])
      .filter((u: any) => {
        const r = (u as any).role;
        return Array.isArray(r) ? r.includes("user") : r === "user";
      })
      .map((u: any) => String(u.id));

    let assignmentMap: Record<string, string | null> = {};
    if (idsForAssignments.length > 0) {
      const assignments = await ClinicalAssignment.find({ userId: { $in: idsForAssignments } }).lean();
      assignmentMap = Object.fromEntries(
        (assignments || []).map((a: any) => [String(a.userId), a.traineeName ?? null])
      );
    }

    return res.status(200).json({
      data: {
        users: (users || []).map((u: any) => ({
          name: u.name,
          email: u.email,
          emailVerified: Boolean(u.emailVerified),
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
          role: (u as any).role,
          banned: Boolean(u.banned),
          phone: (u as any).phone,
          accountType: (u as any).accountType,
          id: u.id,
          traineeName:
            (Array.isArray((u as any).role) ? (u as any).role.includes("user") : (u as any).role === "user")
              ? assignmentMap[String(u.id)] ?? null
              : null,
        })),
        total,
        limit: appliedLimit ?? limit,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const SetUserRole = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const permission = await auth.api.userHasPermission({
      body: { permissions: { user: ["update"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!permission?.success) {
      return res.status(403).json({ error: "Not allowed to set user role" });
    }
    const targetUserId = String(req.body.userId || "").trim();
    const newRole = String(req.body.role || "").trim();
    const validRoles = ["admin", "trainer", "trainee", "user"] as const;
    if (!validRoles.includes(newRole as any)) {
      return res.status(400).json({ error: "Invalid role. Must be one of: admin, trainer, trainee, user" });
    }

    // Snapshot the current role so we can revert if the profile step fails.
    const targetUser = await db.collection("user").findOne({ id: targetUserId });
    if (!targetUser) return res.status(404).json({ error: "User not found" });
    const previousRole = String(targetUser.role || "user");

    const data = await auth.api.setRole({
      body: { userId: targetUserId, role: newRole as typeof validRoles[number] },
      headers: fromNodeHeaders(req.headers),
    });

    // Role change and profile sync are one business operation. If the profile
    // step fails we attempt a compensating rollback of the role.
    try {
      if (newRole === "user") {
        await Profile.findOneAndUpdate(
          { userId: targetUserId, isDefault: true },
          { $setOnInsert: { userId: targetUserId, name: "My Profile", avatar: "", isDefault: true } },
          { upsert: true }
        );
      } else {
        // Profile.deleteMany is the hard, irreversible operation — it drives the rollback
        // decision. clearAllActiveProfilesForUser is soft (session metadata only): stale
        // activeProfileId values self-heal via ListMyProfiles revalidation, so a failure
        // here must not trigger a role rollback that would leave the user with zero profiles.
        await Profile.deleteMany({ userId: targetUserId });
        await clearAllActiveProfilesForUser(targetUserId).catch((err) =>
          console.error(`[SetUserRole] Session clearing failed for user ${targetUserId}:`, err)
        );
      }
    } catch (profileErr) {
      // Profile work failed — attempt to revert the role change.
      try {
        await auth.api.setRole({
          body: { userId: targetUserId, role: previousRole as typeof validRoles[number] },
          headers: fromNodeHeaders(req.headers),
        });
      } catch (revertErr) {
        // Both the profile step and the rollback failed — the system is now inconsistent.
        // Log everything for manual intervention and return 500.
        console.error(
          `CRITICAL: Role for user ${targetUserId} was changed to "${newRole}" but profile cleanup failed, ` +
          `and role revert to "${previousRole}" also failed. Manual intervention required.`,
          { profileErr, revertErr }
        );
        return res.status(500).json({ error: "Role change succeeded but cleanup failed and could not be reverted. Manual intervention required." });
      }
      // Rollback succeeded — surface the original error to the caller.
      return next(profileErr);
    }

    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
};

export const ResetUserPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const permission = await auth.api.userHasPermission({
      body: { permissions: { user: ["reset-password"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!permission?.success) {
      return res.status(403).json({ error: "Not allowed to reset user password" });
    }
    const data = await auth.api.setUserPassword({
      body: {
        newPassword: req.body.newPassword,
        userId: req.body.userId,
      },
      headers: fromNodeHeaders(req.headers),
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
};

export const BanUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const permission = await auth.api.userHasPermission({
      body: { permissions: { user: ["ban"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!permission?.success) {
      return res.status(403).json({ error: "Not allowed to ban users" });
    }
    const data = await auth.api.banUser({
      body: {
        userId: req.body.userId,
        banReason: req.body.banReason,
        banExpiresIn: req.body.banExpiresIn,
      },
      headers: fromNodeHeaders(req.headers),
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
};

export const UnbanUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const permission = await auth.api.userHasPermission({
      body: { permissions: { user: ["ban"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!permission?.success) {
      return res.status(403).json({ error: "Not allowed to unban users" });
    }
    const data = await auth.api.unbanUser({
      body: { userId: req.body.userId },
      headers: fromNodeHeaders(req.headers),
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
};

export const DeleteUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const permission = await auth.api.userHasPermission({
      body: { permissions: { user: ["delete"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!permission?.success) {
      return res.status(403).json({ error: "Not allowed to delete users" });
    }
    const data = await auth.api.removeUser({
      body: { userId: req.body.userId },
      headers: fromNodeHeaders(req.headers),
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
};

export const DeleteUsersBulk = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const permission = await auth.api.userHasPermission({
      body: { permissions: { user: ["delete"] } },
      headers: apiHeaders,
    });
    if (!permission?.success) {
      return res.status(403).json({ error: "Not allowed to delete users" });
    }
    const ids = Array.isArray((req.body as any)?.userIds)
      ? (req.body as any).userIds
      : [];
    const userIds = ids
      .map((x: any) => String(x || "").trim())
      .filter((x: string) => x.length > 0);
    if (userIds.length === 0) {
      return res.status(400).json({ error: "userIds array is required" });
    }
    const uniqueIds: string[] = Array.from(new Set(userIds));
    const maxBatch = 100;
    if (uniqueIds.length > maxBatch) {
      return res.status(400).json({ error: `Too many userIds, max ${maxBatch}` });
    }
    const success: string[] = [];
    const failed: Array<{ userId: string; error: string }> = [];
    const concurrency = 10;
    for (let i = 0; i < uniqueIds.length; i += concurrency) {
      const slice = uniqueIds.slice(i, i + concurrency);
      const chunk = await Promise.allSettled(
        slice.map((userId) =>
          auth.api.removeUser({
            body: { userId },
            headers: apiHeaders,
          })
        )
      );
      chunk.forEach((r, idx) => {
        const id = slice[idx];
        if (r.status === "fulfilled") {
          success.push(id);
        } else {
          const msg =
            r.reason instanceof Error
              ? r.reason.message
              : String(r.reason || "Unknown error");
          failed.push({ userId: id, error: msg });
        }
      });
    }
    return res.status(200).json({ data: { success, failed } });
  } catch (error) {
    return next(error);
  }
};

export const UpdateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const permission = await auth.api.userHasPermission({
      body: { permissions: { user: ["update"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!permission?.success) {
      return res.status(403).json({ error: "Not allowed to update users" });
    }
    const data = await auth.api.adminUpdateUser({
      body: {
        userId: req.body.userId,
        data: req.body.data,
      },
      headers: fromNodeHeaders(req.headers),
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
};

async function assertTargetIsUserRole(userId: string, res: Response): Promise<boolean> {
  const targetUser = await db.collection("user").findOne({ id: userId });
  if (!targetUser) {
    res.status(404).json({ message: "User not found" });
    return false;
  }
  if (targetUser.role !== "user") {
    res.status(400).json({ message: "Profiles can only be managed for accounts with role 'user'" });
    return false;
  }
  return true;
}

export const AdminListProfiles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const perm = await auth.api.userHasPermission({
      body: { permissions: { profile: ["manage"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!perm?.success) return res.status(403).json({ message: "Forbidden" });

    const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
    if (!userId) return res.status(400).json({ message: "userId query param is required" });
    if (!(await assertTargetIsUserRole(userId, res))) return;

    const profiles = await Profile.find({ userId }).sort({ createdAt: 1 }).lean();
    return res.status(200).json({ data: profiles });
  } catch (err) { next(err); }
};

export const AdminCreateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const perm = await auth.api.userHasPermission({
      body: { permissions: { profile: ["manage"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!perm?.success) return res.status(403).json({ message: "Forbidden" });

    const userId = typeof req.body.userId === "string" ? req.body.userId.trim() : "";
    if (!userId) return res.status(400).json({ message: "userId is required" });
    if (!(await assertTargetIsUserRole(userId, res))) return;

    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ message: "Profile name is required" });
    const avatar = typeof req.body.avatar === "string" ? req.body.avatar.trim() : "";

    let created: any = null;
    let limitExceeded = false;
    const mongoSession = await Profile.startSession();
    try {
      await mongoSession.withTransaction(async () => {
        const count = await Profile.countDocuments({ userId }).session(mongoSession);
        if (count >= 5) {
          limitExceeded = true;
          return;
        }
        const docs = await Profile.create(
          [{ userId, name, avatar, isDefault: count === 0 }],
          { session: mongoSession }
        );
        created = docs[0];
      });
    } finally {
      await mongoSession.endSession();
    }

    if (limitExceeded) {
      return res.status(400).json({ message: "Maximum 5 profiles allowed" });
    }
    return res.status(201).json({ data: created });
  } catch (err) { next(err); }
};

export const AdminUpdateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const perm = await auth.api.userHasPermission({
      body: { permissions: { profile: ["manage"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!perm?.success) return res.status(403).json({ message: "Forbidden" });

    const { profileId } = req.params;
    const profile = await Profile.findById(profileId);
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    // Verify the profile's owner is still a "user" role account. If their role was
    // changed since the profile was created, editing it would violate the invariant.
    if (!(await assertTargetIsUserRole(profile.userId, res))) return;

    if (typeof req.body.name === "string" && req.body.name.trim()) {
      profile.name = req.body.name.trim();
    }
    if (typeof req.body.avatar === "string") {
      profile.avatar = req.body.avatar.trim();
    }
    await profile.save();

    return res.status(200).json({ data: profile });
  } catch (err) { next(err); }
};

export const AdminDeleteProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const perm = await auth.api.userHasPermission({
      body: { permissions: { profile: ["manage"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!perm?.success) return res.status(403).json({ message: "Forbidden" });

    const { profileId } = req.params;
    const profile = await Profile.findById(profileId);
    if (!profile) return res.status(404).json({ message: "Profile not found" });

    // Check whether the profile owner is still a "user" role account.
    const owner = await db.collection("user").findOne({ id: profile.userId });
    const ownerIsUser = owner?.role === "user";

    if (ownerIsUser) {
      // Normal user account — protect against leaving them with zero profiles.
      const totalCount = await Profile.countDocuments({ userId: profile.userId });
      if (totalCount <= 1) {
        return res.status(400).json({ message: "Cannot delete the only profile" });
      }
    }
    // If the owner is no longer a "user" (role was changed, leaving orphan profiles),
    // admin may delete even the last remaining profile as part of data cleanup.

    await profile.deleteOne();
    // Clear this profile from all open sessions. The profile is already gone, so a
    // 500 here would be misleading — log the failure instead of blocking the response.
    await clearProfileFromAllSessions(profile.userId, String(profileId)).catch((err) =>
      console.error(`[AdminDeleteProfile] Session cleanup failed for profile ${String(profileId)}:`, err)
    );

    return res.status(200).json({ data: { deleted: true } });
  } catch (err) { next(err); }
};
