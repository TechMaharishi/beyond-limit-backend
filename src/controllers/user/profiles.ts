import { NextFunction, Request, Response } from "express";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { Profile } from "@/models/profile";
import {
  setSessionActiveProfile,
  clearSessionActiveProfile,
  clearProfileFromAllSessions,
} from "@/lib/profile-session";

const MAX_PROFILES = 5;

function requireUserRole(session: any, res: Response): boolean {
  const role = (session.user as any).role as string;
  if (role !== "user") {
    res.status(403).json({ message: "Profiles are only available for user accounts" });
    return false;
  }
  return true;
}

export const ListMyProfiles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ message: "Unauthorized" });
    if (!requireUserRole(session, res)) return;

    const userId = (session.user as any).id as string;
    const profiles = await Profile.find({ userId }).sort({ createdAt: 1 }).lean();
    let activeProfileId = ((session.session as any).activeProfileId as string | null) ?? null;

    // Self-heal: if the session points to a profile that no longer exists (e.g. deleted
    // by admin from another device), clear it so the client shows the picker screen.
    if (activeProfileId && !profiles.some((p) => String(p._id) === activeProfileId)) {
      const token = (session.session as any).token as string;
      await clearSessionActiveProfile(token).catch((err) =>
        console.error(`[ListMyProfiles] Failed to clear stale activeProfileId for user ${userId}:`, err)
      );
      activeProfileId = null;
    }

    return res.status(200).json({ data: { profiles, activeProfileId } });
  } catch (err) { next(err); }
};

export const CreateMyProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ message: "Unauthorized" });
    if (!requireUserRole(session, res)) return;

    const userId = (session.user as any).id as string;
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ message: "Profile name is required" });
    const avatar = typeof req.body.avatar === "string" ? req.body.avatar.trim() : "";

    // Transaction ensures the count check and insert are atomic — prevents two
    // concurrent requests from both passing the MAX_PROFILES guard.
    // Requires MongoDB replica set (available on Atlas).
    let created: any = null;
    let limitExceeded = false;
    const mongoSession = await Profile.startSession();
    try {
      await mongoSession.withTransaction(async () => {
        const count = await Profile.countDocuments({ userId }).session(mongoSession);
        if (count >= MAX_PROFILES) {
          limitExceeded = true;
          return; // commit empty transaction — no insert
        }
        const docs = await Profile.create(
          [{ userId, name, avatar, isDefault: false }],
          { session: mongoSession }
        );
        created = docs[0];
      });
    } finally {
      await mongoSession.endSession();
    }

    if (limitExceeded) {
      return res.status(400).json({ message: `Maximum ${MAX_PROFILES} profiles allowed` });
    }
    return res.status(201).json({ data: created });
  } catch (err) { next(err); }
};

export const UpdateMyProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ message: "Unauthorized" });
    if (!requireUserRole(session, res)) return;

    const userId = (session.user as any).id as string;
    const { profileId } = req.params;

    const profile = await Profile.findById(profileId);
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    if (profile.userId !== userId) return res.status(403).json({ message: "Forbidden" });

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

export const DeleteMyProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ message: "Unauthorized" });
    if (!requireUserRole(session, res)) return;

    const userId = (session.user as any).id as string;
    const { profileId } = req.params;

    const profile = await Profile.findById(profileId);
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    if (profile.userId !== userId) return res.status(403).json({ message: "Forbidden" });

    const totalCount = await Profile.countDocuments({ userId });
    if (totalCount <= 1) {
      return res.status(400).json({ message: "Cannot delete the only profile" });
    }

    // Clear this profile from the caller's current session and any other open sessions
    const token = (session.session as any).token as string;
    const currentActiveId = (session.session as any).activeProfileId as string | null;
    await profile.deleteOne();

    if (currentActiveId === String(profile._id)) {
      await clearSessionActiveProfile(token);
    }
    // Also clear from any other device sessions the user may have open
    await clearProfileFromAllSessions(userId, String(profile._id));

    return res.status(200).json({ data: { deleted: true } });
  } catch (err) { next(err); }
};

export const SwitchProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ message: "Unauthorized" });
    if (!requireUserRole(session, res)) return;

    const userId = (session.user as any).id as string;
    const profileId = typeof req.body.profileId === "string" ? req.body.profileId.trim() : "";
    if (!profileId) return res.status(400).json({ message: "profileId is required" });

    const profile = await Profile.findById(profileId).lean();
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    if (profile.userId !== userId) return res.status(403).json({ message: "Forbidden" });

    const token = (session.session as any).token as string;
    await setSessionActiveProfile(token, profileId);

    return res.status(200).json({ data: { activeProfileId: profileId } });
  } catch (err) { next(err); }
};
