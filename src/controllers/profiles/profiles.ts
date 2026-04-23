import { NextFunction, Request, Response } from "express";
import { auth, db } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { Profile } from "@/models/profile";

const MAX_PROFILES = 5;

export const ListMyProfiles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ message: "Unauthorized" });

    const userId = (session.user as any).id as string;
    const profiles = await Profile.find({ userId }).sort({ createdAt: 1 }).lean();
    const activeProfileId = (session.session as any).activeProfileId ?? null;

    return res.status(200).json({ data: { profiles, activeProfileId } });
  } catch (err) { next(err); }
};

export const CreateMyProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ message: "Unauthorized" });

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { profile: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canCreate?.success) return res.status(403).json({ message: "Forbidden" });

    const userId = (session.user as any).id as string;
    const count = await Profile.countDocuments({ userId });
    if (count >= MAX_PROFILES) {
      return res.status(400).json({ message: `Maximum ${MAX_PROFILES} profiles allowed` });
    }

    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name) return res.status(400).json({ message: "Profile name is required" });
    const avatar = typeof req.body.avatar === "string" ? req.body.avatar.trim() : "";

    const profile = await Profile.create({ userId, name, avatar, isDefault: false });
    return res.status(201).json({ data: profile });
  } catch (err) { next(err); }
};

export const UpdateMyProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ message: "Unauthorized" });

    const canUpdate = await auth.api.userHasPermission({
      body: { permissions: { profile: ["update"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canUpdate?.success) return res.status(403).json({ message: "Forbidden" });

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

    const canDelete = await auth.api.userHasPermission({
      body: { permissions: { profile: ["delete"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canDelete?.success) return res.status(403).json({ message: "Forbidden" });

    const userId = (session.user as any).id as string;
    const { profileId } = req.params;

    const profile = await Profile.findById(profileId);
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    if (profile.userId !== userId) return res.status(403).json({ message: "Forbidden" });

    const totalCount = await Profile.countDocuments({ userId });
    if (totalCount <= 1) {
      return res.status(400).json({ message: "Cannot delete the only profile" });
    }

    const activeProfileId = (session.session as any).activeProfileId as string | null;
    if (activeProfileId === String(profile._id)) {
      const token = (session.session as any).token as string;
      await db.collection("session").updateOne(
        { token },
        { $set: { activeProfileId: null, updatedAt: new Date() } }
      );
    }

    await profile.deleteOne();
    return res.status(200).json({ data: { deleted: true } });
  } catch (err) { next(err); }
};

export const SwitchProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ message: "Unauthorized" });

    const userId = (session.user as any).id as string;
    const profileId = typeof req.body.profileId === "string" ? req.body.profileId.trim() : "";
    if (!profileId) return res.status(400).json({ message: "profileId is required" });

    const profile = await Profile.findById(profileId).lean();
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    if (profile.userId !== userId) return res.status(403).json({ message: "Forbidden" });

    const token = (session.session as any).token as string;
    await db.collection("session").updateOne(
      { token },
      { $set: { activeProfileId: profileId, updatedAt: new Date() } }
    );

    return res.status(200).json({ data: { activeProfileId: profileId } });
  } catch (err) { next(err); }
};
