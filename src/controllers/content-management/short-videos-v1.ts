import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import cloudinary from "@/config/cloudinary";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { ShortVideo } from "@/models/short-videos";
import { Tag } from "@/models/tags";
import { sendSuccess, sendError } from "@/utils/api-response";
import { buildAutoThumbnailUrl } from "@/utils/cloudinary-helpers";
import logger from "@/utils/logger";
import { sendShortVideoStatusNotification } from "@/controllers/content-management/short-videos";

const normalizeTag = (s: string) => s.toLowerCase().trim().replace(/\s+/g, "-");

function buildHlsUrl(publicId: string): string {
  return publicId
    ? cloudinary.url(publicId, {
        resource_type: "video",
        format: "m3u8",
        transformation: [{ streaming_profile: "auto" }],
      })
    : "";
}

function buildThumbnailUrl(publicId: string, durationSeconds: number): string {
  const offset = durationSeconds >= 1 ? 1 : 0;
  return cloudinary.url(publicId, {
    resource_type: "video",
    format: "jpg",
    transformation: [{ start_offset: offset }],
  });
}

async function validateAndNormalizeTags(
  tags: string[] | string | undefined,
  requireAtLeastOne: boolean
): Promise<{ normalized: string[]; error?: string }> {
  let raw: string[] = [];
  if (typeof tags === "string") {
    raw = tags.split(",").map((t) => t.trim()).filter(Boolean);
  } else if (Array.isArray(tags)) {
    raw = tags;
  }

  if (requireAtLeastOne && raw.length === 0) {
    return { normalized: [], error: "At least one tag is required" };
  }
  if (raw.length === 0) return { normalized: [] };

  const normalized = Array.from(new Set(raw.map(normalizeTag)));
  const existing = await Tag.find({ slug: { $in: normalized }, active: true })
    .select("slug")
    .lean();
  const valid = normalized.filter((t) => existing.some((e: any) => e.slug === t));

  if (valid.length === 0) {
    return { normalized: [], error: "Invalid tags: provide existing tag slugs" };
  }
  return { normalized: valid };
}

export const createShortVideoShell = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
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

    const { title, description, tags, accessLevel, visibility } = req.body as {
      title?: string;
      description?: string;
      tags?: string[] | string;
      accessLevel?: "free" | "develop" | "master";
      visibility?: "clinicians" | "users" | "all";
    };

    if (!title || !description) {
      return sendError(res, 400, "title and description are required");
    }

    const { normalized: normalizedTags, error: tagError } =
      await validateAndNormalizeTags(tags, false);
    if (tagError) return sendError(res, 400, tagError);

    const allowedAccess = ["free", "develop", "master"] as const;
    const finalAccessLevel =
      accessLevel && allowedAccess.includes(accessLevel as any) ? accessLevel : "free";

    const allowedVisibility = ["clinicians", "users", "all"] as const;
    const finalVisibility =
      visibility && allowedVisibility.includes(visibility as any) ? visibility : "users";

    const video = await ShortVideo.create({
      title: title.trim(),
      description: description.trim(),
      tags: normalizedTags,
      status: "draft",
      user: new mongoose.Types.ObjectId((user as any).id),
      createdBy: {
        _id: new mongoose.Types.ObjectId((user as any).id),
        name: String((user as any).name || ""),
        email: String((user as any).email || ""),
      },
      cloudinaryUrl: "",
      cloudinaryId: "",
      thumbnailUrl: "",
      accessLevel: finalAccessLevel,
      visibility: finalVisibility,
      durationSeconds: 0,
    });

    logger.info(`[ShortVideosV1] Shell created: ${video._id} by user ${(user as any).id}`);

    return sendSuccess(res, 201, "Short video shell created", {
      _id: video._id,
      title: video.title,
      description: video.description,
      tags: video.tags,
      status: video.status,
      accessLevel: video.accessLevel,
      visibility: video.visibility,
      videoReady: false,
      createdAt: video.createdAt,
    });
  } catch (error) {
    return next(error);
  }
};

export const getSignedUploadUrl = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid video ID");
    }

    const video = await ShortVideo.findById(id);
    if (!video) return sendError(res, 404, "Short video not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = video.user.toString() === String((user as any).id);
    if (!isAdmin && !isOwner) {
      return sendError(res, 403, "Forbidden");
    }

    if (video.status === "published") {
      return sendError(res, 400, "Cannot replace video on a published short");
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const appBaseUrl = process.env.BETTER_AUTH_URL;

    if (!cloudName || !apiKey || !apiSecret || !appBaseUrl) {
      logger.error("[ShortVideosV1] Missing Cloudinary or app env vars");
      return sendError(res, 500, "Server configuration error");
    }

    const timestamp = Math.round(Date.now() / 1000);
    const publicId = `short-videos/${String(video._id)}/${timestamp}`;
    const notificationUrl = `${appBaseUrl}/api/v1/webhooks/cloudinary/upload-complete`;

    const paramsToSign: Record<string, string | number> = {
      notification_url: notificationUrl,
      public_id: publicId,
      timestamp,
    };

    const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

    return sendSuccess(res, 200, "Signed upload URL generated", {
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`,
      fields: {
        api_key: apiKey,
        timestamp,
        signature,
        public_id: publicId,
        notification_url: notificationUrl,
        resource_type: "video",
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const publishShortVideo = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid video ID");
    }

    const video = await ShortVideo.findById(id);
    if (!video) return sendError(res, 404, "Short video not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = video.user.toString() === String((user as any).id);
    if (!isAdmin && !isOwner) {
      return sendError(res, 403, "Forbidden");
    }

    if (video.status === "published") {
      return sendError(res, 400, "Short video is already published");
    }

    if (!video.cloudinaryId) {
      return sendError(
        res,
        400,
        "Video file not yet uploaded. Upload the video before publishing."
      );
    }

    if (!video.title?.trim() || !video.description?.trim()) {
      return sendError(res, 400, "title and description are required before publishing");
    }
    if (!video.tags || video.tags.length === 0) {
      return sendError(res, 400, "At least one tag is required before publishing");
    }

    if (!video.thumbnailUrl && video.cloudinaryId) {
      video.thumbnailUrl = buildAutoThumbnailUrl(video.cloudinaryId, video.durationSeconds || 0);
    }

    video.status = "published";
    await video.save();

    logger.info(`[ShortVideosV1] Published: ${video._id} by user ${(user as any).id}`);

    return sendSuccess(res, 200, "Short video published", {
      _id: video._id,
      title: video.title,
      status: video.status,
      cloudinaryUrl: buildHlsUrl(video.cloudinaryId),
      thumbnailUrl: video.thumbnailUrl,
      durationSeconds: video.durationSeconds,
      updatedAt: video.updatedAt,
    });
  } catch (error) {
    return next(error);
  }
};

export const getShortVideoUploadStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const apiHeaders = fromNodeHeaders(req.headers);
    const session = await auth.api.getSession({ headers: apiHeaders });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid video ID");
    }

    const video = await ShortVideo.findById(id)
      .select("status cloudinaryId durationSeconds subtitle_status user")
      .lean();
    if (!video) return sendError(res, 404, "Short video not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = String((video as any).user) === String((user as any).id);
    if (!isAdmin && !isOwner) return sendError(res, 403, "Forbidden");

    return sendSuccess(res, 200, "Status fetched", {
      _id: (video as any)._id,
      status: (video as any).status,
      videoReady: !!((video as any).cloudinaryId),
      durationSeconds: (video as any).durationSeconds,
      subtitleStatus: (video as any).subtitle_status,
    });
  } catch (error) {
    return next(error);
  }
};
