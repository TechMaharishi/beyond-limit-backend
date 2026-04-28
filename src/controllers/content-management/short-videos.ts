import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import cloudinary from "@/config/cloudinary";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { ShortVideo } from "@/models/short-videos";
import { ShortVideoProgress } from "@/models/short-video-progress";
import { sendSuccess, sendError } from "@/utils/api-response";
import admin from "@/config/firebase";
import { DeviceToken } from "@/models/device-token";
import { Notification } from "@/models/notification";
import { isRoleIn } from "@/utils/roles";
import { escapeRegex, normalizeTag } from "@/utils/string";
import { isValidObjectId } from "@/utils/mongodb";
import { resolveTagSlugs } from "@/utils/tags";
import { buildAutoThumbnailUrl, buildHlsUrl } from "@/utils/cloudinary-helpers";

const MAX_TAGS = 10;
const MAX_RESOURCES = 10;

// ─── progress tracking ───────────────────────────────────────────────────────

/**
 * Returns the tracking ID for progress records.
 * - Admin / Trainer / Trainee → user account ID
 * - User role → activeProfileId from session (required; error if missing)
 */
function resolveProgressTrackingId(
  user: any,
  session: any
): { id: string | null; error?: string } {
  if (isRoleIn(user.role ?? "", "user")) {
    const profileId = (session?.session as any)?.activeProfileId as string | null;
    if (!profileId) {
      return { id: null, error: "No active profile selected. Select a profile before tracking progress." };
    }
    return { id: profileId };
  }
  return { id: String(user.id) };
}

// ─── resource validation ─────────────────────────────────────────────────────

type IResourceInput = { name: string; url: string; fileType?: string; cloudinaryPublicId?: string };

function parseResources(
  input: unknown,
  existingCount = 0
): { valid: IResourceInput[]; error?: string } {
  if (input === undefined || input === null) return { valid: [] };
  if (!Array.isArray(input)) return { valid: [], error: "resources must be an array" };
  if (input.length > MAX_RESOURCES) {
    return { valid: [], error: `Maximum ${MAX_RESOURCES} resources allowed` };
  }
  if (existingCount + input.length > MAX_RESOURCES) {
    return { valid: [], error: `Adding these resources would exceed the maximum of ${MAX_RESOURCES}` };
  }
  for (const item of input) {
    if (typeof item.name !== "string" || !item.name.trim()) {
      return { valid: [], error: "Each resource must have a non-empty name" };
    }
    if (typeof item.url !== "string" || !item.url.trim()) {
      return { valid: [], error: "Each resource must have a non-empty url" };
    }
  }
  return {
    valid: input.map((r: any) => ({
      name: String(r.name).trim(),
      url: String(r.url).trim(),
      fileType: String(r.fileType || "").trim(),
      cloudinaryPublicId: String(r.cloudinaryPublicId || "").trim(),
    })),
  };
}

// ─── createShortVideo ────────────────────────────────────────────────────────
// Creates a new short video record.
// Accessible by: Admin, Trainer, Trainee (User is blocked via RBAC — shortVideo:create).
// Thumbnail: uses provided thumbnailUrl, or auto-generates from cloudinaryId if omitted.
// Resources: optional array of attached documents/files ({ name, url, fileType }).

export const createShortVideo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { shortVideo: ["create"] } },
      headers: apiHeaders,
    });
    if (!canCreate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const {
      title, description, tags, accessLevel, status, visibility,
      cloudinaryUrl, cloudinaryId, thumbnailUrl, durationSeconds, resources,
    } = req.body as {
      title: string; description: string; tags?: string[] | string;
      accessLevel?: "free" | "develop" | "master";
      status?: "draft" | "pending" | "published";
      visibility?: "clinicians" | "users" | "all";
      cloudinaryUrl?: string; cloudinaryId?: string;
      thumbnailUrl?: string; durationSeconds?: number;
      resources?: IResourceInput[];
    };

    const requestedStatus = status || "draft";
    if (!["draft", "pending", "published", "rejected"].includes(requestedStatus)) {
      return sendError(res, 400, "Invalid status. Valid statuses are 'draft', 'pending', 'published'.");
    }

    const role = (user as any).role;
    const isAdmin = isRoleIn(role, "admin");
    if (!isAdmin && requestedStatus === "published") {
      return sendError(res, 403, "Forbidden: only admins can set status to 'published'.");
    }

    if (requestedStatus !== "draft") {
      if (!title || !description) return sendError(res, 400, "Title and description are required.");
      if (!tags || (Array.isArray(tags) ? tags.length === 0 : !tags.trim())) {
        return sendError(res, 400, "At least one tag is required.");
      }
      if (!cloudinaryUrl || !cloudinaryId) {
        return sendError(res, 400, "Video content (cloudinaryUrl and cloudinaryId) is required.");
      }
    }

    let verified: any = null;
    if (cloudinaryId) {
      try {
        verified = await (cloudinary as any).api.resource(cloudinaryId, { resource_type: "video" });
      } catch {
        return sendError(res, 400, "Cloudinary video not found");
      }
    }

    const durationInput = durationSeconds ? Number(durationSeconds) : 0;
    const duration = Number.isFinite(durationInput) && durationInput > 0
      ? durationInput : Number(verified?.duration) || 0;

    // Use provided thumbnail; auto-generate only if omitted and cloudinaryId is available
    const finalThumbnailUrl = thumbnailUrl
      ? thumbnailUrl
      : cloudinaryId
      ? buildAutoThumbnailUrl(cloudinaryId, duration)
      : "";

    // Tag validation — error if tags are supplied but none are valid (even in draft mode)
    let normalizedTags: string[] = [];
    if (tags) {
      const raw = Array.isArray(tags) ? tags : tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (raw.length > MAX_TAGS) {
        return sendError(res, 400, `Maximum ${MAX_TAGS} tags allowed`);
      }
      const slugs = await resolveTagSlugs(raw);
      if (raw.length > 0 && slugs.length === 0) {
        return sendError(res, 400, "Invalid tags: provide existing tag slugs.");
      }
      normalizedTags = slugs;
    }

    const requestedVisibility = visibility || "users";
    if (!["clinicians", "users", "all"].includes(requestedVisibility)) {
      return sendError(res, 400, "Invalid visibility");
    }

    const { valid: parsedResources, error: resourcesError } = parseResources(resources);
    if (resourcesError) return sendError(res, 400, resourcesError);

    const video = await ShortVideo.create({
      title: title ?? "", description: description ?? "",
      tags: normalizedTags, status: requestedStatus,
      user: user.id,
      createdBy: {
        _id: new mongoose.Types.ObjectId((user as any).id),
        name: String((user as any).name || ""),
        email: String((user as any).email || ""),
      },
      cloudinaryUrl: cloudinaryUrl ?? "",
      cloudinaryId: cloudinaryId ?? "",
      thumbnailUrl: finalThumbnailUrl,
      accessLevel: accessLevel || "free",
      visibility: requestedVisibility,
      durationSeconds: duration,
      resources: parsedResources,
    });

    // Notify admins about the new submission (fire-and-forget)
    try {
      const adminList = await auth.api.listUsers({
        query: { filterField: "role", filterValue: "admin", limit: 100, offset: 0, sortBy: "createdAt", sortDirection: "desc" },
        headers: apiHeaders,
      });
      const adminIds = ((adminList as any)?.users || [])
        .map((u: any) => String(u.id))
        .filter((id: string) => !!id && id !== String((user as any).id));

      const titleMsg = "New short video submission";
      const bodyMsg = `New short video submitted by: ${String((user as any).name || "Unknown")}`;

      for (const adminId of adminIds) {
        try {
          const tokenDoc = await DeviceToken.findOne({ userId: adminId }).lean();
          if (tokenDoc?.deviceToken) {
            const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
            if (isExpo) {
              await fetch("https://exp.host/--/api/v2/push/send", {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json" },
                body: JSON.stringify({ to: tokenDoc.deviceToken, sound: "default", title: titleMsg, body: bodyMsg }),
              });
            } else {
              await admin.messaging().send({
                token: tokenDoc.deviceToken,
                notification: { title: titleMsg, body: bodyMsg },
                data: { _id: String((video as any)._id), status: requestedStatus, event: "short-video-submitted" },
              } as any);
            }
          }
        } catch {}
        try {
          await Notification.create({
            userId: adminId, title: titleMsg, body: bodyMsg,
            data: { _id: String((video as any)._id), status: requestedStatus, event: "short-video-submitted" },
            read: false,
          });
        } catch {}
      }
    } catch {}

    return sendSuccess(res, 201, "Short video created successfully", video);
  } catch (error) {
    return next(error);
  }
};

// ─── deleteShortVideo ────────────────────────────────────────────────────────
// Deletes a short video record plus its Cloudinary video asset and any
// Cloudinary-hosted resource files attached to the video.
// Admin → any video. Trainer / Trainee → own videos only.

export const deleteShortVideo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const { id } = req.params as { id: string };

    if (!isValidObjectId(id)) return sendError(res, 400, "Invalid video ID format.");

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canDelete = await auth.api.userHasPermission({
      body: { permissions: { shortVideo: ["delete"] } },
      headers: apiHeaders,
    });
    if (!canDelete?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const video = await ShortVideo.findById(id);
    if (!video) return sendError(res, 404, "Short video not found");

    const role = (user as any).role;
    const isAdmin = isRoleIn(role, "admin");
    const isOwner = video.user.equals(user.id);

    if (!isAdmin && !isOwner) return sendError(res, 403, "Forbidden: only admin or owner can delete");

    // Destroy the main video asset
    if (video.cloudinaryId) {
      try { await cloudinary.uploader.destroy(video.cloudinaryId, { resource_type: "video" }); } catch {}
    }

    // Destroy any Cloudinary-hosted resource files
    const cloudinaryResources = (video.resources ?? []).filter((r) => r.cloudinaryPublicId);
    for (const resource of cloudinaryResources) {
      try { await cloudinary.uploader.destroy(resource.cloudinaryPublicId!); } catch {}
    }

    const deleteResult = await ShortVideo.findByIdAndDelete(id);
    if (!deleteResult) return sendError(res, 500, "Failed to delete video from database.");

    return sendSuccess(res, 200, "Short video deleted", { id });
  } catch (error) {
    return next(error);
  }
};

// ─── removeShortVideoFile ────────────────────────────────────────────────────
// Removes only the video file from Cloudinary and clears media fields,
// keeping the short video record (title, description, tags, etc.) intact.
// Admin → any video. Trainer / Trainee → own videos only.

export const removeShortVideoFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const { id } = req.params as { id: string };

    if (!isValidObjectId(id)) return sendError(res, 400, "Invalid video ID format.");

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canUpdate = await auth.api.userHasPermission({
      body: { permissions: { shortVideo: ["update"] } },
      headers: apiHeaders,
    });
    if (!canUpdate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const video = await ShortVideo.findById(id);
    if (!video) return sendError(res, 404, "Short video not found");

    const role = (user as any).role;
    if (!isRoleIn(role, "admin") && !video.user.equals(user.id)) {
      return sendError(res, 403, "Forbidden: only admin or owner can delete");
    }

    if (video.cloudinaryId) {
      try { await cloudinary.uploader.destroy(video.cloudinaryId, { resource_type: "video" }); } catch {}
    }

    video.cloudinaryUrl = "";
    video.cloudinaryId = "";
    video.thumbnailUrl = "";
    video.durationSeconds = 0;
    (video as any).subtitles = [];
    await video.save();
    await ShortVideoProgress.deleteMany({ shortVideoId: id }).catch(() => {});

    return sendSuccess(res, 200, "Short video file deleted", {
      id: video._id, title: video.title, description: video.description,
      status: video.status, tags: video.tags,
      cloudinaryUrl: "", cloudinaryId: "", thumbnailUrl: "", durationSeconds: 0,
    });
  } catch (error) {
    return next(error);
  }
};

// ─── listShortVideosForManagement ────────────────────────────────────────────
// Management view — returns all shorts (both visibilities) for the requesting
// creator or, for admins, the full catalogue filtered by status.
// Accessible by: Admin, Trainer, Trainee only (blocked for User role).

export const listShortVideosForManagement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { shortVideoStatus: ["view"] } },
      headers: apiHeaders,
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const rawLimit = Number(req.query.limit);
    const rawPage = Number(req.query.page);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const offset = (page - 1) * limit;

    const statusQuery = (req.query.status as string) || undefined;
    const tagsQuery = (req.query.tags as string | string[]) || (req.query.tag as string) || undefined;
    const q = (req.query.q as string) || undefined;

    if (statusQuery && !["draft", "pending", "published", "rejected"].includes(statusQuery)) {
      return sendError(res, 400, "Invalid status filter");
    }

    const baseConditions: any[] = [];

    if (tagsQuery) {
      const rawTags = Array.isArray(tagsQuery) ? tagsQuery : (tagsQuery as string).split(",");
      const slugs = await resolveTagSlugs(rawTags);
      if (slugs.length === 0) return sendError(res, 400, "Invalid tag filter: unknown tags");
      baseConditions.push({ tags: { $in: slugs } });
    }

    if (q) {
      // Use text index when available; the escaped literal regex is a safe fallback
      const safe = escapeRegex(q);
      baseConditions.push({ $or: [{ title: { $regex: safe, $options: "i" } }, { description: { $regex: safe, $options: "i" } }] });
    }

    const sortByParam = (req.query.sortBy as string) || (req.query.by as string) || "createdAt";
    const orderParam = (req.query.order as string) || (req.query.sort as string) || "desc";
    const sortDir: 1 | -1 = orderParam.toLowerCase() === "asc" ? 1 : -1;
    const sort: Record<string, 1 | -1> = {};
    switch (sortByParam.toLowerCase()) {
      case "tags": sort["tags"] = sortDir; break;
      case "title": sort["title"] = sortDir; break;
      default: sort["createdAt"] = sortDir;
    }

    const role = (user as any).role;
    const isAdmin = isRoleIn(role, "admin");

    let roleFilter: any;
    if (isAdmin) {
      roleFilter = statusQuery
        ? (statusQuery === "draft" ? { status: "draft", user: (user as any).id } : { status: statusQuery })
        : { $or: [{ status: "draft", user: (user as any).id }, { status: "pending" }, { status: "published" }, { status: "rejected" }] };
    } else {
      roleFilter = statusQuery
        ? { status: statusQuery, user: (user as any).id }
        : { user: (user as any).id, status: { $in: ["draft", "pending", "published", "rejected"] } };
    }

    const conditions = [...baseConditions, roleFilter].filter(Boolean);
    const mongoFilter = conditions.length > 1 ? { $and: conditions } : conditions[0] || {};

    const total = await ShortVideo.countDocuments(mongoFilter);
    const data = await ShortVideo.find(mongoFilter)
      .select("title description tags status thumbnailUrl accessLevel visibility durationSeconds createdAt updatedAt createdBy")
      .sort(sort).skip(offset).limit(limit);

    return sendSuccess(res, 200, "Short videos fetched", data, { page, offset, limit, total, hasNext: offset + data.length < total });
  } catch (error) {
    return next(error);
  }
};

// ─── getShortVideoById ───────────────────────────────────────────────────────
// Returns a single short video.
// Visibility gate: User role cannot view "clinicians" shorts.
// Access level gate (User role only): free / develop / master tier check.

export const getShortVideoById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const { id } = req.params as { id: string };

    if (!isValidObjectId(id)) return sendError(res, 400, "Invalid video ID format.");

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { shortVideo: ["view"] } },
      headers: apiHeaders,
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const video = await ShortVideo.findById(id);
    if (!video) return sendError(res, 404, "Short video not found");

    const role = (user as any).role;
    const isAdmin = isRoleIn(role, "admin");
    const isClinician = isRoleIn(role, "admin", "trainer", "trainee");
    const isOwner = video.user.toString() === user.id;

    if (!isAdmin && !isOwner) {
      if (video.status !== "published") return sendError(res, 403, "Forbidden: video not accessible");

      if (video.visibility === "clinicians" && !isClinician) {
        return sendError(res, 403, "Forbidden: this content is for clinicians only");
      }

      // Tier-based access check — applies to User role only
      if (!isClinician) {
        const accountType = String((user as any).accountType ?? "free");
        const accessMatrix: Record<string, string[]> = {
          free:    ["free"],
          develop: ["free", "develop"],
          master:  ["free", "develop", "master"],
        };
        const allowed = accessMatrix[accountType] ?? ["free"];
        if (!allowed.includes(video.accessLevel)) {
          return sendError(res, 403, "Forbidden: upgrade your account to access this content");
        }
      }
    }

    const publicId = String((video as any).cloudinaryId || "");
    const hlsUrl = publicId ? buildHlsUrl(publicId) : "";

    return sendSuccess(res, 200, "Short video fetched", {
      ...video.toObject(),
      cloudinaryUrl: hlsUrl || (video as any).cloudinaryUrl || "",
      createdBy: (video as any).createdBy ?? null,
    });
  } catch (error) {
    return next(error);
  }
};

// ─── updateShortVideo ────────────────────────────────────────────────────────
// Updates metadata, video file, or thumbnail for a short video.
// Resources are managed separately via addShortVideoResource / removeShortVideoResource.
// Thumbnail: uses provided thumbnailUrl, or auto-generates from the new cloudinaryId
//            if a new video is supplied without a thumbnail.
// Admin → any video. Trainer / Trainee → own videos only.

export const updateShortVideo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const { id } = req.params as { id: string };

    if (!isValidObjectId(id)) return sendError(res, 400, "Invalid video ID format.");

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canUpdate = await auth.api.userHasPermission({
      body: { permissions: { shortVideo: ["update"] } },
      headers: apiHeaders,
    });
    if (!canUpdate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const video = await ShortVideo.findById(id);
    if (!video) return sendError(res, 404, "Short video not found");

    const role = (user as any).role;
    const isAdmin = isRoleIn(role, "admin");
    const isOwner = video.user.toString() === user.id;

    if (!isAdmin && !isOwner) return sendError(res, 403, "Forbidden: only admin or owner can edit");

    const {
      title, description, tags, accessLevel, status, visibility,
      cloudinaryUrl, cloudinaryId, thumbnailUrl, durationSeconds,
    } = req.body as {
      title?: string; description?: string; tags?: string[] | string;
      accessLevel?: "free" | "develop" | "master";
      status?: string;
      visibility?: "clinicians" | "users" | "all";
      cloudinaryUrl?: string; cloudinaryId?: string;
      thumbnailUrl?: string; durationSeconds?: number;
    };

    const updates: any = {};
    if (typeof title === "string") updates.title = title;
    if (typeof description === "string") updates.description = description;
    if (typeof cloudinaryUrl === "string") updates.cloudinaryUrl = cloudinaryUrl;
    if (typeof cloudinaryId === "string") updates.cloudinaryId = cloudinaryId;
    if (typeof durationSeconds === "number") updates.durationSeconds = durationSeconds;

    let verified: any = null;
    if (typeof cloudinaryId === "string" && cloudinaryId.trim()) {
      try {
        verified = await (cloudinary as any).api.resource(cloudinaryId, { resource_type: "video" });
      } catch {
        return sendError(res, 400, "Cloudinary video not found");
      }
      if (typeof durationSeconds !== "number") {
        updates.durationSeconds = Number(verified?.duration) || video.durationSeconds || 0;
      }
      if (cloudinaryId !== video.cloudinaryId) {
        updates.subtitle_status = "pending";
        updates.subtitle_failure_reason = null;
        updates.subtitle_retry_count = 0;
        updates.retryable = false;
        updates.subtitles = [];
        updates.not_before = new Date(Date.now() + 2 * 60 * 1000);
      }
    }

    if (tags !== undefined) {
      const raw = Array.isArray(tags) ? tags : tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (raw.length > MAX_TAGS) return sendError(res, 400, `Maximum ${MAX_TAGS} tags allowed`);
      const slugs = await resolveTagSlugs(raw);
      if (raw.length > 0 && slugs.length === 0) {
        return sendError(res, 400, "Invalid tags: provide existing tag slugs");
      }
      if (slugs.length > 0) updates.tags = slugs;
    }

    if (accessLevel) {
      if (!["free", "develop", "master"].includes(accessLevel)) return sendError(res, 400, "Invalid accessLevel");
      updates.accessLevel = accessLevel;
    }

    if (status) {
      // "approved" is not a valid status — only draft/pending/published/rejected
      if (!["draft", "pending", "published", "rejected"].includes(status)) {
        return sendError(res, 400, "Invalid status. Valid values: draft, pending, published, rejected");
      }
      if (!isAdmin && (status === "published" || status === "rejected")) {
        return sendError(res, 403, "Forbidden: only admins can set status to 'published' or 'rejected'");
      }
      updates.status = status;
    }

    if (visibility) {
      if (!["clinicians", "users", "all"].includes(visibility)) return sendError(res, 400, "Invalid visibility");
      updates.visibility = visibility;
    }

    // Resolve thumbnail: explicit value wins; auto-generate only when a new video is set without a thumbnail
    if (thumbnailUrl) {
      updates.thumbnailUrl = thumbnailUrl;
    } else if (cloudinaryId) {
      const dur = typeof durationSeconds === "number"
        ? durationSeconds
        : Number(verified?.duration) || video.durationSeconds || 0;
      updates.thumbnailUrl = buildAutoThumbnailUrl(cloudinaryId, dur);
    }

    // Remove old Cloudinary asset when replacing with a different video
    if (updates.cloudinaryId && video.cloudinaryId && updates.cloudinaryId !== video.cloudinaryId) {
      try { await cloudinary.uploader.destroy(video.cloudinaryId, { resource_type: "video" }); } catch {}
    }

    const updated = await ShortVideo.findByIdAndUpdate(id, updates, { returnDocument: "after" });
    return sendSuccess(res, 200, "Short video updated", updated);
  } catch (error) {
    return next(error);
  }
};

// ─── addShortVideoResource ───────────────────────────────────────────────────
// Appends one resource to the video's resources array.
// Enforces the maximum of MAX_RESOURCES resources per video.
// Admin → any video. Trainer / Trainee → own videos only.

export const addShortVideoResource = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const { id } = req.params as { id: string };

    if (!isValidObjectId(id)) return sendError(res, 400, "Invalid video ID format.");

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canUpdate = await auth.api.userHasPermission({
      body: { permissions: { shortVideo: ["update"] } },
      headers: apiHeaders,
    });
    if (!canUpdate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const video = await ShortVideo.findById(id);
    if (!video) return sendError(res, 404, "Short video not found");

    const role = (user as any).role;
    if (!isRoleIn(role, "admin") && !video.user.equals(user.id)) {
      return sendError(res, 403, "Forbidden: only admin or owner can add resources");
    }

    const existingCount = (video.resources ?? []).length;
    const files = (req as any).files as Express.Multer.File[] | undefined;
    const hasFiles = Array.isArray(files) && files.length > 0;

    // Support mixed input: uploaded files + optional JSON resource entries
    // names[] must align with files[] when uploading; body.resources is for URL-only entries
    const urlResources: IResourceInput[] = [];
    if (req.body?.resources) {
      const parsed = typeof req.body.resources === "string"
        ? JSON.parse(req.body.resources)
        : req.body.resources;
      const { valid, error: resourceError } = parseResources(parsed, existingCount);
      if (resourceError) return sendError(res, 400, resourceError);
      urlResources.push(...valid);
    }

    const totalIncoming = (hasFiles ? files!.length : 0) + urlResources.length;
    if (totalIncoming === 0) return sendError(res, 400, "Provide at least one file or resource url");
    if (existingCount + totalIncoming > MAX_RESOURCES) {
      return sendError(res, 400, `Adding ${totalIncoming} resource(s) would exceed the maximum of ${MAX_RESOURCES}`);
    }

    // Upload all files to Cloudinary in parallel
    const uploadedResources: IResourceInput[] = [];
    if (hasFiles) {
      const names: string[] = Array.isArray(req.body?.names)
        ? req.body.names
        : typeof req.body?.names === "string"
        ? JSON.parse(req.body.names)
        : files!.map((f) => f.originalname);

      const results = await Promise.all(
        files!.map((file, i) =>
          new Promise<IResourceInput>((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                resource_type: "raw",
                folder: `short-videos/${id}/resources`,
                use_filename: true,
                unique_filename: true,
              },
              (error, result) => {
                if (error) return reject(error);
                resolve({
                  name: String(names[i] || file.originalname).trim(),
                  url: result!.secure_url,
                  fileType: file.mimetype,
                  cloudinaryPublicId: result!.public_id,
                });
              }
            );
            stream.end(file.buffer);
          })
        )
      );
      uploadedResources.push(...results);
    }

    const allNew = [...uploadedResources, ...urlResources];
    video.resources.push(...(allNew as any[]));
    await video.save();

    const added = video.resources.slice(existingCount);
    return sendSuccess(res, 201, `${added.length} resource(s) added`, added);
  } catch (error) {
    return next(error);
  }
};

// ─── removeShortVideoResource ────────────────────────────────────────────────
// Removes one resource by its _id from the video's resources array.
// Also destroys the Cloudinary asset if cloudinaryPublicId is set on the resource.
// Admin → any video. Trainer / Trainee → own videos only.

export const removeShortVideoResource = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const { id, resourceId } = req.params as { id: string; resourceId: string };

    if (!isValidObjectId(id)) return sendError(res, 400, "Invalid video ID format.");
    if (!isValidObjectId(resourceId)) return sendError(res, 400, "Invalid resource ID format.");

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canUpdate = await auth.api.userHasPermission({
      body: { permissions: { shortVideo: ["update"] } },
      headers: apiHeaders,
    });
    if (!canUpdate?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const video = await ShortVideo.findById(id);
    if (!video) return sendError(res, 404, "Short video not found");

    const role = (user as any).role;
    if (!isRoleIn(role, "admin") && !video.user.equals(user.id)) {
      return sendError(res, 403, "Forbidden: only admin or owner can remove resources");
    }

    const resource = video.resources.find((r) => r._id.toString() === resourceId);
    if (!resource) return sendError(res, 404, "Resource not found");

    if (resource.cloudinaryPublicId) {
      try { await cloudinary.uploader.destroy(resource.cloudinaryPublicId); } catch {}
    }

    video.resources = video.resources.filter((r) => r._id.toString() !== resourceId) as any;
    await video.save();

    return sendSuccess(res, 200, "Resource removed", { resourceId });
  } catch (error) {
    return next(error);
  }
};

// ─── trackShortVideoProgress ─────────────────────────────────────────────────
// Records how far a viewer has watched a short video (idempotent — stores max).
// Admin / Trainer / Trainee → tracked by user account ID.
// User role → tracked by activeProfileId (must be set in session).

export const trackShortVideoProgress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const { id } = req.params as { id: string };
    const { watchedSeconds } = req.body as { watchedSeconds: number };

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    if (typeof watchedSeconds !== "number" || watchedSeconds < 0) {
      return sendError(res, 400, "Invalid watchedSeconds");
    }

    const { id: trackingId, error: trackingError } = resolveProgressTrackingId(user, session);
    if (trackingError) return sendError(res, 400, trackingError);

    const video = await ShortVideo.findById(id);
    if (!video) return sendError(res, 404, "Short video not found");

    const duration = video.durationSeconds || 0;
    const cappedWatched = duration > 0 ? Math.min(watchedSeconds, duration) : watchedSeconds;

    const progress = await ShortVideoProgress.findOneAndUpdate(
      { userId: trackingId, shortVideoId: id },
      { $max: { watchedSeconds: cappedWatched } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    const finalWatched = progress.watchedSeconds;
    const percentWatched = duration > 0 ? Math.min((finalWatched / duration) * 100, 100) : 0;
    const completed = percentWatched >= 90 || (duration > 0 && finalWatched >= duration);

    if (progress.completed !== completed) {
      progress.completed = completed;
      await progress.save();
    }

    return sendSuccess(res, 200, "Short video progress updated", {
      watchedSeconds: finalWatched,
      completed,
      percentWatched: Number(percentWatched.toFixed(2)),
      durationSeconds: duration,
    });
  } catch (error) {
    return next(error);
  }
};

// ─── getShortVideoProgress ───────────────────────────────────────────────────
// Returns the current watch progress for a short video.
// Tracking key follows the same role-based rules as trackShortVideoProgress.

export const getShortVideoProgress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const { id } = req.params as { id: string };

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const { id: trackingId, error: trackingError } = resolveProgressTrackingId(user, session);
    if (trackingError) return sendError(res, 400, trackingError);

    const video = await ShortVideo.findById(id).select("durationSeconds createdBy");
    if (!video) return sendError(res, 404, "Short video not found");

    const duration = video.durationSeconds || 0;
    const progress = await ShortVideoProgress.findOne({ userId: trackingId, shortVideoId: id });
    const watched = progress?.watchedSeconds || 0;
    const completed = progress?.completed || false;
    const percentWatched = duration > 0 ? Math.min((watched / duration) * 100, 100) : 0;

    return sendSuccess(res, 200, "Short video progress fetched", {
      watchedSeconds: watched,
      completed,
      percentWatched: Number(percentWatched.toFixed(2)),
      durationSeconds: duration,
      createdBy: (video as any).createdBy ?? null,
    });
  } catch (error) {
    return next(error);
  }
};

// ─── listPublishedShortVideos ─────────────────────────────────────────────────
// Returns published shorts available to the requesting user.
// Admin / Trainer / Trainee → all visibilities (clinicians + users + all).
// User role → cannot see "clinicians" shorts (users + all only).

export const listPublishedShortVideos = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { shortVideo: ["view"] } },
      headers: apiHeaders,
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 10;
    const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
    const offset = (page - 1) * limit;

    const tagsQuery = (req.query.tags as string | string[]) || (req.query.tag as string) || undefined;
    const q = (req.query.q as string) || undefined;

    const sortByParam = (req.query.sortBy as string) || (req.query.by as string) || "createdAt";
    const orderParam = (req.query.order as string) || (req.query.sort as string) || "desc";
    const sortDir: 1 | -1 = orderParam.toLowerCase() === "asc" ? 1 : -1;
    const sort: Record<string, 1 | -1> = {};
    switch (sortByParam.toLowerCase()) {
      case "tags": sort["tags"] = sortDir; break;
      case "title": sort["title"] = sortDir; break;
      default: sort["createdAt"] = sortDir;
    }

    const role = (user as any).role;
    const isClinician = isRoleIn(role, "admin", "trainer", "trainee");

    const visibilityFilter = isClinician
      ? { visibility: { $in: ["clinicians", "users", "all"] } }
      : { visibility: { $in: ["users", "all"] } };

    const filter: any = { status: "published", ...visibilityFilter };

    if (tagsQuery) {
      const rawTags = Array.isArray(tagsQuery) ? tagsQuery : (tagsQuery as string).split(",");
      const slugs = await resolveTagSlugs(rawTags);
      if (slugs.length === 0) return sendError(res, 400, "Invalid tag filter: unknown tags");
      filter.tags = { $in: slugs };
    }

    if (q) {
      const safe = escapeRegex(q);
      filter.$or = [{ title: { $regex: safe, $options: "i" } }, { description: { $regex: safe, $options: "i" } }];
    }

    const total = await ShortVideo.countDocuments(filter);
    const data = await ShortVideo.find(filter)
      .select("title description tags status thumbnailUrl accessLevel visibility durationSeconds createdAt updatedAt createdBy")
      .sort(sort).skip(offset).limit(limit);

    return sendSuccess(res, 200, "Published short videos fetched", data, { page, offset, limit, total, hasNext: offset + data.length < total });
  } catch (error) {
    return next(error);
  }
};

// ─── updateShortVideoStatus ──────────────────────────────────────────────────
// Changes the moderation status of a short video.
// Admin       → published or rejected (any video)
// Trainer / Trainee → draft or pending (own videos only)

export const updateShortVideoStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const { id } = req.params as { id: string };

    if (!isValidObjectId(id)) return sendError(res, 400, "Invalid video ID format.");

    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const role = (user as any).role;
    const isAdmin = isRoleIn(role, "admin");
    const isCreator = isRoleIn(role, "trainer", "trainee");

    if (!isAdmin && !isCreator) return sendError(res, 403, "Forbidden: insufficient permissions");

    const video = await ShortVideo.findById(id);
    if (!video) return sendError(res, 404, "Short video not found");

    const { status, rejectReason } = req.body as {
      status?: string;
      rejectReason?: string;
    };

    if (!status || typeof status !== "string") return sendError(res, 400, "Status is required");

    if (isAdmin) {
      if (!["published", "rejected"].includes(status)) {
        return sendError(res, 400, "Admin can only set status to 'published' or 'rejected'");
      }
    } else {
      if (!["draft", "pending"].includes(status)) {
        return sendError(res, 400, "You can only set status to 'draft' or 'pending'");
      }
      if (!video.user.equals(user.id)) {
        return sendError(res, 403, "Forbidden: you can only change the status of your own videos");
      }
    }

    if (status === "rejected") {
      const reason = typeof rejectReason === "string" ? rejectReason.trim() : "";
      if (!reason) return sendError(res, 400, "rejectReason is required when status is 'rejected'");
      video.rejectReason = reason;
    } else if (status === "published" && video.rejectReason) {
      video.rejectReason = "";
    }

    if (video.status === status && status !== "rejected") {
      return sendError(res, 400, "Video is already in requested status");
    }

    video.status = status as any;
    await video.save();

    // Notify the video owner when admin publishes or rejects (fire-and-forget)
    if (isAdmin && (status === "published" || status === "rejected")) {
      try {
        const ownerId = String((video as any).user || "");
        if (ownerId) {
          const tokenDoc = await DeviceToken.findOne({ userId: ownerId }).lean();
          const titleMsg = status === "published" ? "Short video published" : "Short video rejected";
          const vTitle = String((video as any).title || "your short video");
          const rejectText = String((video as any).rejectReason || "");
          const bodyMsg = status === "published"
            ? `Your ${vTitle} has been approved.`
            : rejectText
            ? `Your ${vTitle} was declined. Please review the feedback: ${rejectText}`
            : `Your ${vTitle} was declined. Please review the feedback.`;

          if (tokenDoc?.deviceToken) {
            const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
            if (isExpo) {
              await fetch("https://exp.host/--/api/v2/push/send", {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json" },
                body: JSON.stringify({ to: tokenDoc.deviceToken, sound: "default", title: titleMsg, body: bodyMsg }),
              });
            } else {
              await admin.messaging().send({
                token: tokenDoc.deviceToken,
                notification: { title: titleMsg, body: bodyMsg },
                data: { _id: String((video as any)._id), status, event: status === "published" ? "short-video-published" : "short-video-rejected" },
              } as any);
            }
          }

          try {
            await Notification.create({
              userId: ownerId, title: titleMsg, body: bodyMsg,
              data: { _id: String((video as any)._id), status, event: status === "published" ? "short-video-published" : "short-video-rejected" },
              read: false,
            });
          } catch {}
        }
      } catch {}
    }

    return sendSuccess(res, 200, "Short video status updated", {
      id: video._id, title: video.title, description: video.description,
      status: video.status, rejectReason: (video as any).rejectReason,
      tags: video.tags, cloudinaryUrl: (video as any).cloudinaryUrl,
      accessLevel: (video as any).accessLevel, durationSeconds: (video as any).durationSeconds,
      createdAt: video.createdAt, updatedAt: video.updatedAt, user: video.user,
    });
  } catch (error) {
    return next(error);
  }
};

// ─── Tag management (kept for backward compatibility with existing routes) ───

export { createTag, getTag, deactivateTag, activateTag, deleteTag } from "@/controllers/tags/tags";
