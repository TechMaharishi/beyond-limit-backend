import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendSuccess, sendError } from "@/utils/api-response";
import { Tag } from "@/models/tags";

const normalizeTag = (s: string) => s.toLowerCase().trim().replace(/\s+/g, "-");

export const createTag = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { tag: ["create"] } },
      headers: apiHeaders,
    });
    if (!canCreate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const { name } = req.body as { name: string };
    if (!name || typeof name !== "string") return sendError(res, 400, "Tag name is required");

    const slug = normalizeTag(name);
    if (!slug) return sendError(res, 400, "Invalid tag name");

    const exists = await Tag.findOne({ slug });
    if (exists) return sendError(res, 409, "Tag already exists");

    const tag = await Tag.create({
      name,
      slug,
      createdBy: new mongoose.Types.ObjectId(user.id),
    });

    return sendSuccess(res, 201, "Tag created", tag);
  } catch (error) {
    return next(error);
  }
};

export const getTag = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const canView = await auth.api.userHasPermission({
      body: { permissions: { tag: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const tags = await Tag.find({})
      .select("name slug active createdBy createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .lean();

    return sendSuccess(res, 200, "Tags fetched", tags);
  } catch (error) {
    return next(error);
  }
};

export const deactivateTag = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const canDelete = await auth.api.userHasPermission({
      body: { permissions: { tag: ["delete"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canDelete?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const id = String(req.params.id || "");
    if (!id) return sendError(res, 400, "Tag id is required");
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, 400, "Invalid tag id");

    const tag = await Tag.findById(id);
    if (!tag) return sendError(res, 404, "Tag not found");

    const updated = await Tag.findByIdAndUpdate(
      id,
      { active: false, deletedAt: new Date() },
      { returnDocument: "after" }
    ).lean();

    return sendSuccess(res, 200, "Tag deactivated", updated);
  } catch (error) {
    return next(error);
  }
};

export const activateTag = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const canUpdate = await auth.api.userHasPermission({
      body: { permissions: { tag: ["update"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canUpdate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const id = String(req.params.id || "");
    if (!id) return sendError(res, 400, "Tag id is required");
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, 400, "Invalid tag id");

    const tag = await Tag.findById(id);
    if (!tag) return sendError(res, 404, "Tag not found");

    const reactivated = await Tag.findByIdAndUpdate(
      id,
      { $set: { active: true }, $unset: { deletedAt: 1 } },
      { returnDocument: "after" }
    ).lean();

    return sendSuccess(res, 200, "Tag activated", reactivated);
  } catch (error) {
    return next(error);
  }
};

export const deleteTag = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const canDelete = await auth.api.userHasPermission({
      body: { permissions: { tag: ["delete"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canDelete?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const id = String(req.params.id || "");
    if (!id) return sendError(res, 400, "Tag id is required");
    if (!mongoose.Types.ObjectId.isValid(id)) return sendError(res, 400, "Invalid tag id");

    const deleted = await Tag.findByIdAndDelete(id).lean();
    if (!deleted) return sendError(res, 404, "Tag not found");

    return sendSuccess(res, 200, "Tag hard deleted", deleted);
  } catch (error) {
    return next(error);
  }
};
