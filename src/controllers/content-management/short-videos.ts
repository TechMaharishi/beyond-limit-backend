import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import cloudinary from "@/config/cloudinary";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { ShortVideo } from "@/models/short-videos";
import { ShortVideoProgress } from "@/models/short-video-progress";
import { sendSuccess, sendError } from "@/utils/api-response";
import { Tag } from "@/models/tags";
import admin from "@/config/firebase";
import { DeviceToken } from "@/models/device-token";
import { Notification } from "@/models/notification";
import { buildVisibilityFilterForRole, canViewVideo } from "@/services/visibility";


const normalizeTag = (s: string) => s.toLowerCase().trim().replace(/\s+/g, "-");

// Create short video (admin, trainer, trainee)
export const createShortVideo = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    const canCreate = await auth.api.userHasPermission({
      body: { permission: { shortVideo: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canCreate?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const {
      title,
      description,
      tags,
      accessLevel,
      status,
      visibility,
      cloudinaryUrl,
      cloudinaryId,
      thumbnailUrl,
      durationSeconds,
    } = req.body as {
      title: string;
      description: string;
      tags?: string[] | string;
      accessLevel?: "free" | "develop" | "master";
      status?: "draft" | "pending" | "published";
      visibility?: "clinicians" | "users" | "all";
      cloudinaryUrl?: string;
      cloudinaryId?: string;
      thumbnailUrl?: string;
      durationSeconds?: number;
    };

    const requestedStatus = status || "draft";
    const allowedStatuses = ["draft", "pending", "published", "rejected"] as const;
    if (!allowedStatuses.includes(requestedStatus)) {
      return sendError(
        res,
        400,
        "Invalid status. Valid statuses are 'draft', 'pending', 'published'."
      );
    }

    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    if (!isAdmin && requestedStatus === "published") {
      return sendError(
        res,
        403,
        "Forbidden: only admins can set status to 'published'."
      );
    }

    if (requestedStatus !== "draft") {
      if (!title || !description) {
        return sendError(res, 400, "Title and description are required.");
      }
      let tmpTags: string[] = [];
      if (typeof tags === "string") {
        tmpTags = tags
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
      } else if (Array.isArray(tags)) {
        tmpTags = tags;
      }
      if (tmpTags.length === 0) {
        return sendError(res, 400, "At least one tag is required.");
      }
      if (!cloudinaryUrl || !cloudinaryId) {
        return sendError(
          res,
          400,
          "Video content (cloudinaryUrl and cloudinaryId) is required."
        );
      }
    }

    let verified: any | null = null;
    if (cloudinaryId) {
      try {
        // @ts-ignore
        verified = await (cloudinary as any).api.resource(cloudinaryId, { resource_type: "video" });
      } catch {
        return sendError(res, 400, "Cloudinary video not found");
      }
    }

    const durationInput = durationSeconds ? Number(durationSeconds) : 0;
    const duration = Number.isFinite(durationInput) && durationInput > 0
      ? durationInput
      : Number(verified?.duration) || 0;
    const thumbOffset = duration >= 1 ? 1 : 0;
    const finalThumbnailUrl =
      thumbnailUrl
        ? thumbnailUrl
        : cloudinaryId
        ? cloudinary.url(cloudinaryId, {
            resource_type: "video",
            format: "jpg",
            transformation: [{ start_offset: thumbOffset }],
          })
        : "";

    let rawTagsInput: string[] = [];
    if (typeof tags === "string") {
      rawTagsInput = tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    } else if (Array.isArray(tags)) {
      rawTagsInput = tags;
    }

    const hadTagsInput = Array.isArray(rawTagsInput) && rawTagsInput.length > 0;
    const normalizedTags = hadTagsInput
      ? Array.from(new Set(rawTagsInput.map(normalizeTag)))
      : [];

    if (hadTagsInput) {
      const existing = await Tag.find({
        slug: { $in: normalizedTags },
        active: true,
      })
        .select("slug")
        .lean();
      const existingSlugs = new Set(existing.map((c: any) => c.slug));
      const validNormalized = normalizedTags.filter((t) =>
        existingSlugs.has(t)
      );

      if (requestedStatus !== "draft" && validNormalized.length === 0) {
        return sendError(res, 400, "Invalid tags: provide existing tag slugs.");
      }
      if (
        requestedStatus === "draft" &&
        normalizedTags.length > 0 &&
        validNormalized.length === 0
      ) {
        return sendError(res, 400, "Invalid tags: provide existing tag slugs.");
      }
      normalizedTags.splice(0, normalizedTags.length, ...validNormalized);
    }

    const requestedVisibility = visibility || "users";
    const allowedVisibility = ["clinicians", "users", "all"] as const;
    if (!allowedVisibility.includes(requestedVisibility as any)) {
      return sendError(res, 400, "Invalid visibility");
    }

    // Subtitles are NOT checked inline anymore.
    // The video is created with caption_status = "pending" (schema default).
    // The background captionWorker will pick it up and trigger Cloudinary transcription.

    const video = await ShortVideo.create({
      title: title ?? "",
      description: description ?? "",
      tags: normalizedTags,
      status: requestedStatus,
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
      // caption_status defaults to "pending" via the schema
    });

    try {
      const adminList = await auth.api.listUsers({
        query: {
          filterField: "role",
          filterValue: "admin",
          limit: 100,
          offset: 0,
          sortBy: "createdAt",
          sortDirection: "desc",
        },
        headers: fromNodeHeaders(req.headers),
      });
      const admins: any[] = ((adminList as any)?.users || []) as any[];
      const adminIds: string[] = admins
        .map((u: any) => String((u as any).id))
        .filter((id: string) => !!id && id !== String((user as any).id));
      const titleMsg = "New short video submission";
      const bodyMsg = `New short video submitted by: ${String((user as any).name || "Unknown")}`;
      for (const adminId of adminIds) {
        try {
          const tokenDoc = await DeviceToken.findOne({ userId: adminId }).lean();
          if (tokenDoc?.deviceToken) {
            const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
            if (isExpo) {
              const expoMessage = { to: tokenDoc.deviceToken, sound: "default", title: titleMsg, body: bodyMsg };
              await fetch("https://exp.host/--/api/v2/push/send", {
                method: "POST",
                headers: { Accept: "application/json", "Content-Type": "application/json" },
                body: JSON.stringify(expoMessage),
              });
            } else {
              const fcmMessage = {
                token: tokenDoc.deviceToken,
                notification: { title: titleMsg, body: bodyMsg },
                data: { _id: String((video as any)._id), status: String(requestedStatus), event: "short-video-submitted" },
              } as any;
              await admin.messaging().send(fcmMessage);
            }
          }
        } catch {}
        try {
          await Notification.create({
            userId: adminId,
            title: titleMsg,
            body: bodyMsg,
            data: { _id: String((video as any)._id), status: String(requestedStatus), event: "short-video-submitted" },
            read: false,
          });
        } catch {}
      }
    } catch {}

    return sendSuccess(res, 201, "Short video created successfully", video);
  } catch (error) {
    next(error);
  }
};

// Delete a short video (admin or owner only)
export const deleteShortVideo = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid video ID format.");
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    const video = await ShortVideo.findById(id);
    if (!video) {
      return sendError(res, 404, "Short video not found");
    }

    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    const isOwner = video.user.equals(user.id);

    if (!isAdmin && !isOwner) {
      return sendError(res, 403, "Forbidden: only admin or owner can delete");
    }

    try {
      await cloudinary.uploader.destroy(video.cloudinaryId, {
        resource_type: "video",
      });
    } catch (cloudErr) {
      
    }

    const deleteResult = await ShortVideo.findByIdAndDelete(id);
    if (!deleteResult) {
      return sendError(res, 500, "Failed to delete video from database.");
    }

    return sendSuccess(res, 200, "Short video deleted", { id });
  } catch (error) {
    next(error);
  }
};

export const deleteShortVideoFile = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid video ID format.");
    }
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }
    const video = await ShortVideo.findById(id);
    if (!video) {
      return sendError(res, 404, "Short video not found");
    }
    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = video.user.equals(user.id);
    if (!isAdmin && !isOwner) {
      return sendError(res, 403, "Forbidden: only admin or owner can delete");
    }
    const publicId = (video as any).cloudinaryId || "";
    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId, { resource_type: "video" });
      } catch {}
    }
    video.cloudinaryUrl = "";
    video.cloudinaryId = "";
    video.thumbnailUrl = "";
    video.durationSeconds = 0;
    ;(video as any).subtitles = [];
    await video.save();
    await ShortVideoProgress.deleteMany({ shortVideoId: id }).catch(() => {});
    return sendSuccess(res, 200, "Short video deleted", {
      id: video._id,
      title: video.title,
      description: video.description,
      status: video.status,
      tags: video.tags,
      cloudinaryUrl: "",
      cloudinaryId: "",
      thumbnailUrl: "",
      durationSeconds: 0,
    });
  } catch (error) {
    next(error);
  }
};

// Get all short videos
export const getAllShortVideos = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    const canView = await auth.api.userHasPermission({
      body: { permission: { shortVideoStatus: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const rawLimit = Number(req.query.limit);
    const rawPage = Number(req.query.page);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 10;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const offset = (page - 1) * limit;

    const statusQuery = (req.query.status as string) || undefined;
    const tagsQuery =
      (req.query.tags as string | string[]) ||
      (req.query.tag as string) ||
      undefined;
    const q = (req.query.q as string) || undefined;
    const baseConditions: any[] = [];
    const allowedStatuses = ["draft", "pending", "published", "rejected"] as const;
    if (statusQuery) {
      if (!allowedStatuses.includes(statusQuery as any)) {
        return sendError(res, 400, "Invalid status filter");
      }
    }

    if (tagsQuery) {
      const rawTags = Array.isArray(tagsQuery)
        ? tagsQuery
        : (tagsQuery as string).split(",");
      const normalized = Array.from(new Set(rawTags.map(normalizeTag)));
      const existing = await Tag.find({
        slug: { $in: normalized },
        active: true,
      })
        .select("slug")
        .lean();
      const slugs = existing.map((c: any) => c.slug);
      if (slugs.length === 0) {
        return sendError(res, 400, "Invalid tag filter: unknown tags");
      }
      baseConditions.push({ tags: { $in: slugs } });
    }
    if (q) {
      baseConditions.push({
        $or: [
          { title: { $regex: q, $options: "i" } },
          { description: { $regex: q, $options: "i" } },
        ],
      });
    }

    const sortByParam =
      (req.query.sortBy as string) || (req.query.by as string) || "createdAt";
    const orderParam =
      (req.query.order as string) || (req.query.sort as string) || "desc";
    const orderNormalized = (orderParam || "").toLowerCase();
    const sortOrder = orderNormalized === "asc" ? 1 : -1;
    const finalSortOrder = orderNormalized === "dsc" ? -1 : sortOrder;

    const sort: Record<string, 1 | -1> = {};
    switch ((sortByParam || "").toLowerCase()) {
      case "tags":
        sort["tags"] = finalSortOrder;
        break;
      case "title":
        sort["title"] = finalSortOrder;
        break;
      case "createdat":
      default:
        sort["createdAt"] = finalSortOrder;
        break;
    }

    // Role-based visibility rules
    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";

    let roleFilter: any;
    if (isAdmin) {
      // Admins: own drafts; all pending and published
      if (statusQuery) {
        if (statusQuery === "draft") {
          roleFilter = { status: "draft", user: (user as any).id };
        } else {
          roleFilter = { status: statusQuery };
        }
      } else {
        roleFilter = {
          $or: [
            { status: "draft", user: (user as any).id },
            { status: "pending" },
            { status: "published" },
          ],
        };
      }
    } else {
      if (statusQuery) {
        roleFilter = { status: statusQuery, user: (user as any).id };
      } else {
        roleFilter = {
          user: (user as any).id,
          status: { $in: ["draft", "pending", "published"] },
        };
      }
    }

    const combinedConditions = [...baseConditions, roleFilter].filter(Boolean);
    const mongoFilter =
      combinedConditions.length > 1
        ? { $and: combinedConditions }
        : combinedConditions[0] || {};

    const total = await ShortVideo.countDocuments(mongoFilter);

    const data = await ShortVideo.find(mongoFilter)
      .select(
        "title description tags status cloudinaryUrl thumbnailUrl accessLevel durationSeconds createdAt updatedAt user createdBy subtitles"
      )
      .sort(sort)
      .skip(offset)
      .limit(limit);

    const hasNext = offset + data.length < total;

    return sendSuccess(res, 200, "Short videos fetched", data, {
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

// Fetch a single short video by ID
export const getShortVideo = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    const canView = await auth.api.userHasPermission({
      body: { permission: { shortVideo: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const video = await ShortVideo.findById(id);
    if (!video) {
      return sendError(res, 404, "Short video not found");
    }

    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    const isOwner = video.user.toString() === user.id;

    if (!isAdmin && !isOwner) {
      if (video.status !== "published") {
        return sendError(res, 403, "Forbidden: video not accessible");
      }
      const visible = canViewVideo(role as any, (video as any).visibility);
      if (!visible) {
        return sendError(res, 403, "Forbidden: visibility not allowed");
      }
    }

    const makeHlsUrl = (publicId: string) =>
      publicId
        ? cloudinary.url(publicId, {
            resource_type: "video",
            format: "m3u8",
            transformation: [{ streaming_profile: "auto" }],
          })
        : "";
    const publicId = String((video as any).cloudinaryId || "");
    const hlsUrl = makeHlsUrl(publicId);

    const base = video.toObject();
    const payload = {
      ...base,
      cloudinaryUrl: hlsUrl || (base as any).cloudinaryUrl || "",
      createdBy: (video as any).createdBy ?? null,
    };

    return sendSuccess(res, 200, "Short video fetched", payload);
  } catch (error) {
    next(error);
  }
};

// Update an existing short video (admin or owner only)
export const updateShortVideo = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    const video = await ShortVideo.findById(id);
    if (!video) {
      return sendError(res, 404, "Short video not found");
    }

    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    const isOwner = video.user.toString() === user.id;

    if (!isAdmin && !isOwner) {
      return res
        .status(403)
        .json({ message: "Forbidden: only admin or owner can edit" });
    }

    const {
      title,
      description,
      tags,
      accessLevel,
      status,
      visibility,
      cloudinaryUrl,
      cloudinaryId,
      thumbnailUrl,
      durationSeconds,
    } = req.body as {
      title?: string;
      description?: string;
      tags?: string[] | string;
      accessLevel?: "free" | "develop" | "master";
      status?: "draft" | "pending" | "approved" | "published";
      visibility?: "clinicians" | "users" | "all";
      cloudinaryUrl?: string;
      cloudinaryId?: string;
      thumbnailUrl?: string;
      durationSeconds?: number;
    };

    const updates: any = {};

    if (typeof title === "string") updates.title = title;
    if (typeof description === "string") updates.description = description;
    if (typeof cloudinaryUrl === "string") updates.cloudinaryUrl = cloudinaryUrl;
    if (typeof cloudinaryId === "string") updates.cloudinaryId = cloudinaryId;
    if (typeof durationSeconds === "number") updates.durationSeconds = durationSeconds;

    let verified: any | null = null;
    if (typeof cloudinaryId === "string" && cloudinaryId.trim().length > 0) {
      try {
        verified = await (cloudinary as any).api.resource(cloudinaryId, { resource_type: "video" });
      } catch {
        return sendError(res, 400, "Cloudinary video not found");
      }
      if (typeof durationSeconds !== "number") {
        updates.durationSeconds = Number(verified?.duration) || video.durationSeconds || 0;
      }

      // When cloudinaryId changes, reset subtitle pipeline so the worker
      // picks up the new video for transcription — but defer 2 min so
      // Cloudinary has time to finish processing the upload.
      if (cloudinaryId !== video.cloudinaryId) {
        updates.subtitle_status = "pending";
        updates.subtitle_failure_reason = null;
        updates.subtitle_retry_count = 0;
        updates.retryable = false;
        updates.subtitles = [];
        updates.not_before = new Date(Date.now() + 2 * 60 * 1000);
      }
    }

    // Accept tags as a comma-separated string or an array
    if (typeof tags === "string" || Array.isArray(tags)) {
      const rawTags =
        typeof tags === "string"
          ? tags
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t.length > 0)
          : tags;
      const normalized = Array.from(new Set(rawTags.map(normalizeTag)));
      const existing = await Tag.find({
        slug: { $in: normalized },
        active: true,
      })
        .select("slug")
        .lean();
      const existingSlugs = new Set(existing.map((c: any) => c.slug));
      const validNormalized = normalized.filter((t) => existingSlugs.has(t));
      if (normalized.length > 0 && validNormalized.length === 0) {
        return sendError(res, 400, "Invalid tags: provide existing tag slugs");
      }
      if (normalized.length > 0) {
        updates.tags = validNormalized;
      }
    }

    if (accessLevel) {
      const allowedAccess = ["free", "develop", "master"] as const;
      if (!allowedAccess.includes(accessLevel as any)) {
        return sendError(res, 400, "Invalid accessLevel");
      }
      updates.accessLevel = accessLevel;
    }

    if (status) {
      const allowedStatuses = [
        "draft",
        "pending",
        "approved",
        "published",
      ] as const;
      if (!allowedStatuses.includes(status as any)) {
        return sendError(res, 400, "Invalid status");
      }
      if (!isAdmin && (status === "approved" || status === "published")) {
        return sendError(
          res,
          403,
          "Forbidden: only admins can set status to 'approved' or 'published'"
        );
      }
      updates.status = status;
    }

    if (visibility) {
      const allowedVisibility = ["clinicians", "users", "all"] as const;
      if (!allowedVisibility.includes(visibility as any)) {
        return sendError(res, 400, "Invalid visibility");
      }
      updates.visibility = visibility;
    }

    if (thumbnailUrl) {
      updates.thumbnailUrl = thumbnailUrl;
    } else if (cloudinaryId) {
      const duration =
        typeof durationSeconds === "number"
          ? durationSeconds
          : Number(verified?.duration) || video.durationSeconds || 0;
      const thumbOffset = duration >= 1 ? 1 : 0;
      updates.thumbnailUrl = cloudinary.url(cloudinaryId, {
        resource_type: "video",
        format: "jpg",
        transformation: [{ start_offset: thumbOffset }],
      });
    } else if (!video.thumbnailUrl && video.cloudinaryId) {
      const duration = video.durationSeconds || 0;
      const thumbOffset = duration >= 1 ? 1 : 0;
      updates.thumbnailUrl = cloudinary.url(video.cloudinaryId, {
        resource_type: "video",
        format: "jpg",
        transformation: [{ start_offset: thumbOffset }],
      });
    }

    // Delete old video from Cloudinary if cloudinaryId is updated
    if (
      updates.cloudinaryId &&
      video.cloudinaryId &&
      updates.cloudinaryId !== video.cloudinaryId
    ) {
      try {
        await cloudinary.uploader.destroy(video.cloudinaryId, {
          resource_type: "video",
        });
      } catch (error) {
        console.error("Cloudinary deletion failed for previous video:", error);
      }
    }

    const updated = await ShortVideo.findByIdAndUpdate(id, updates, {
      new: true,
    });
    return sendSuccess(res, 200, "Short video updated", updated);
  } catch (error) {
    next(error);
  }
};

// Update progress for a single short video (watch time and completion)
export const updateShortVideoProgress = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };
    const { watchedSeconds } = req.body as { watchedSeconds: number };

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    if (typeof watchedSeconds !== "number" || watchedSeconds < 0) {
      return sendError(res, 400, "Invalid watchedSeconds");
    }

    const video = await ShortVideo.findById(id);
    if (!video) {
      return sendError(res, 404, "Short video not found");
    }

    const duration = video.durationSeconds || 0;
    const cappedWatched =
      duration > 0 ? Math.min(watchedSeconds, duration) : watchedSeconds;

    const progress = await ShortVideoProgress.findOneAndUpdate(
      { userId: user.id, shortVideoId: id },
      { $max: { watchedSeconds: cappedWatched } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const finalWatched = progress.watchedSeconds;
    const percentWatched =
      duration > 0 ? Math.min((finalWatched / duration) * 100, 100) : 0;
    const completed =
      percentWatched >= 90 || (duration > 0 && finalWatched >= duration);

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
    next(error);
  }
};

// Get progress for a single short video
export const getShortVideoProgress = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    const video = await ShortVideo.findById(id).select(
      "durationSeconds createdBy"
    );
    if (!video) {
      return sendError(res, 404, "Short video not found");
    }

    const duration = video.durationSeconds || 0;
    const progress = await ShortVideoProgress.findOne({
      userId: user.id,
      shortVideoId: id,
    });

    const watched = progress?.watchedSeconds || 0;
    const completed = progress?.completed || false;
    const percentWatched =
      duration > 0 ? Math.min((watched / duration) * 100, 100) : 0;

    return sendSuccess(res, 200, "Short video progress fetched", {
      watchedSeconds: watched,
      completed,
      percentWatched: Number(percentWatched.toFixed(2)),
      durationSeconds: duration,
      createdBy: (video as any).createdBy ?? null,
    });
  } catch (error) {
    next(error);
  }
};

// Create tag (admin)
export const createTag = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }
    const canCreateTag = await auth.api.userHasPermission({
      body: { permission: { tag: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canCreateTag?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const { name } = req.body as { name: string };

    if (!name || typeof name !== "string") {
      return sendError(res, 400, "Tag name is required");
    }

    const slug = normalizeTag(name);
    if (!slug) {
      return sendError(res, 400, "Invalid tag name");
    }

    const exists = await Tag.findOne({ slug });
    if (exists) {
      return sendError(res, 409, "Tag already exists");
    }

    const category = await Tag.create({
      name,
      slug,
      createdBy: new mongoose.Types.ObjectId(user.id),
    });

    return sendSuccess(res, 201, "Tag created", category);
  } catch (error) {
    next(error);
  }
};

//Get tag
export const getTag = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    const tags = await Tag.find({})
      .select("name slug active createdBy createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .lean();

    return sendSuccess(res, 200, "Tags fetched", tags);
  } catch (error) {
    next(error);
  }
};

//Deactivate tag
export const deactivateTag = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }
    const canDeleteTag = await auth.api.userHasPermission({
      body: { permission: { tag: ["delete"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canDeleteTag?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const { id } = req.params as { id?: string };
    if (!id) {
      return sendError(res, 400, "Tag id is required");
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid tag id");
    }

    const tag = await Tag.findById(id);
    if (!tag) {
      return sendError(res, 404, "Tag not found");
    }

    // Soft deactivate: mark as inactive and set deletedAt for TTL
    const updated = await Tag.findByIdAndUpdate(
      id,
      { active: false, deletedAt: new Date() },
      { new: true }
    ).lean();

    return sendSuccess(res, 200, "Tag deactivated", updated);
  } catch (error) {
    next(error);
  }
};

//Activate tag
export const activateTag = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }
    const canUpdateTag = await auth.api.userHasPermission({
      body: { permission: { tag: ["update"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canUpdateTag?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const { id } = req.params as { id?: string };
    if (!id) {
      return sendError(res, 400, "Tag id is required");
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid tag id");
    }

    const tag = await Tag.findById(id);
    if (!tag) {
      return sendError(res, 404, "Tag not found");
    }

    const reactivated = await Tag.findByIdAndUpdate(
      id,
      { $set: { active: true }, $unset: { deletedAt: 1 } },
      { new: true }
    ).lean();

    return sendSuccess(res, 200, "Tag activated", reactivated);
  } catch (error) {
    next(error);
  }
};

// Hard delete tag
export const deleteTag = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }
    const canDeleteTag = await auth.api.userHasPermission({
      body: { permission: { tag: ["delete"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canDeleteTag?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const { id } = req.params as { id?: string };
    if (!id) {
      return sendError(res, 400, "Tag id is required");
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid tag id");
    }

    const deleted = await Tag.findByIdAndDelete(id).lean();
    if (!deleted) {
      return sendError(res, 404, "Tag not found");
    }
    return sendSuccess(res, 200, "Tag hard deleted", deleted);
  } catch (error) {
    next(error);
  }
};

// Get all shorts by user
export const getAllShortVideoByUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    const canView = await auth.api.userHasPermission({
      body: { permission: { shortVideo: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 10;
    const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
    const offset = (page - 1) * limit;

    const tagsQuery =
      (req.query.tags as string | string[]) ||
      (req.query.tag as string) ||
      undefined;
    const q = (req.query.q as string) || undefined;

    const filter: any = { status: "published" };

    // Sorting controls
    const sortByParam =
      (req.query.sortBy as string) || (req.query.by as string) || "createdAt";
    const orderParam =
      (req.query.order as string) || (req.query.sort as string) || "desc";
    const orderNormalized = (orderParam || "").toLowerCase();
    const sortOrder = orderNormalized === "asc" ? 1 : -1;
    const finalSortOrder = orderNormalized === "dsc" ? -1 : sortOrder;

    const sort: Record<string, 1 | -1> = {};
    switch ((sortByParam || "").toLowerCase()) {
      case "tags":
        sort["tags"] = finalSortOrder;
        break;
      case "title":
        sort["title"] = finalSortOrder;
        break;
      case "createdat":
      default:
        sort["createdAt"] = finalSortOrder;
        break;
    }

    if (tagsQuery) {
      const rawTags = Array.isArray(tagsQuery)
        ? tagsQuery
        : (tagsQuery as string).split(",");
      const normalized = Array.from(new Set(rawTags.map(normalizeTag)));
      const existing = await Tag.find({
        slug: { $in: normalized },
        active: true,
      })
        .select("slug")
        .lean();
      const slugs = existing.map((c: any) => c.slug);
      if (slugs.length === 0) {
        return sendError(res, 400, "Invalid tag filter: unknown tags");
      }
      filter.tags = { $in: slugs };
    }

    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
      ];
    }

    Object.assign(filter, buildVisibilityFilterForRole((user as any).role));

    const total = await ShortVideo.countDocuments(filter);
    const data = await ShortVideo.find(filter)
      .select(
        "title description tags status cloudinaryUrl thumbnailUrl accessLevel visibility durationSeconds createdAt updatedAt user createdBy subtitles"
      )
      .sort(sort)
      .skip(offset)
      .limit(limit);

    const hasNext = offset + data.length < total;

    return sendSuccess(res, 200, "Published short videos fetched", data, {
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

//Change status of the short video (only Admin can change)
export const changeShortVideoStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };
    if (!id) {
      return sendError(res, 400, "Video id is required");
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    if (!isAdmin) {
      return sendError(res, 403, "Forbidden: only admin can change status");
    }

    const video = await ShortVideo.findById(id);
    if (!video) {
      return sendError(res, 404, "Short video not found");
    }

    const { status, rejectReason } = req.body as {
      status?: "draft" | "pending" | "published" | "rejected";
      rejectReason?: string;
    };
    const allowedStatuses = [
      "draft",
      "pending",
      "published",
      "rejected",
    ] as const;
    if (!status || typeof status !== "string") {
      return sendError(res, 400, "Status is required");
    }
    if (!allowedStatuses.includes(status as any)) {
      return sendError(res, 400, "Invalid status value");
    }
    // If rejecting, require a non-empty rejectReason
    if (status === "rejected") {
      const reason =
        typeof rejectReason === "string" ? rejectReason.trim() : "";
      if (!reason) {
        return sendError(
          res,
          400,
          "rejectReason is required when status is 'rejected'"
        );
      }
      video.rejectReason = reason;
    } else if (status === "published") {
      // When publishing, clear any existing rejectReason before marking as published
      if (video.rejectReason) {
        video.rejectReason = "";
      }
    }

    if (video.status === status && status !== "rejected") {
      return sendError(res, 400, "Video is already in requested status");
    }

    video.status = status;
    await video.save();

    try {
      const ownerId = String((video as any).user || "");
      if (ownerId && (status === "published" || status === "rejected")) {
        const tokenDoc = await DeviceToken.findOne({ userId: ownerId }).lean();
        const titleMsg = status === "published" ? "Short video published" : "Short video rejected";
        const vTitle = String((video as any).title || "your short video");
        const rejectText = String((video as any).rejectReason || "");
        const bodyMsg = status === "published"
          ? `Your ${vTitle} has been approved.`
          : (rejectText
              ? `Your ${vTitle} was declined. Please review the feedback: ${rejectText}`
              : `Your ${vTitle} was declined. Please review the feedback.`);

        if (tokenDoc?.deviceToken) {
          const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
          if (isExpo) {
            const expoMessage = { to: tokenDoc.deviceToken, sound: "default", title: titleMsg, body: bodyMsg };
            await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: { Accept: "application/json", "Content-Type": "application/json" },
              body: JSON.stringify(expoMessage),
            });
          } else {
            const fcmMessage = {
              token: tokenDoc.deviceToken,
              notification: { title: titleMsg, body: bodyMsg },
              data: {
                _id: String((video as any)._id),
                status,
                event: status === "published" ? "short-video-published" : "short-video-rejected",
              },
            } as any;
            await admin.messaging().send(fcmMessage);
          }
        }

        try {
          await Notification.create({
            userId: ownerId,
            title: titleMsg,
            body: bodyMsg,
            data: {
              _id: String((video as any)._id),
              status,
              event: status === "published" ? "short-video-published" : "short-video-rejected",
            },
            read: false,
          });
        } catch {}
      }
    } catch {}

    return sendSuccess(res, 200, "Short video status updated", {
      id: video._id,
      title: video.title,
      description: video.description,
      status: video.status,
      rejectReason: (video as any).rejectReason,
      tags: video.tags,
      cloudinaryUrl: (video as any).cloudinaryUrl,
      accessLevel: (video as any).accessLevel,
      durationSeconds: (video as any).durationSeconds,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt,
      user: video.user,
    });
  } catch (error) {
    next(error);
  }
};

