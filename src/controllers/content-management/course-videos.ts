import { Request, Response, NextFunction } from "express";
import { Readable } from "stream";
import mongoose from "mongoose";
import cloudinary from "@/config/cloudinary";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendSuccess, sendError } from "@/utils/api-response";
import { Tag } from "@/models/tags";
import { Course } from "@/models/course-videos";
import { LessonVideoProgress } from "@/models/lesson-video-progress";
import { QuizResponse } from "@/models/quiz-responses";
import { SavedCourse } from "@/models/saved-course";
import admin from "@/config/firebase";
import { DeviceToken } from "@/models/device-token";
import { Notification } from "@/models/notification";
import { buildVisibilityFilterForRole, canViewVideo } from "@/services/visibility";
import { CourseSubtitleJob } from "@/models/course-subtitle-job";
import logger from "@/utils/logger";

const normalizeTag = (s: string) => s.toLowerCase().trim().replace(/\s+/g, "-");

const sumCourseDurationSeconds = (course: any) => {
  try {
    const chapters = Array.isArray(course.chapters) ? course.chapters : [];
    return chapters.reduce((acc: number, ch: any) => {
      const lessons = Array.isArray(ch.lessons) ? ch.lessons : [];
      const lessonsSum = lessons.reduce((la: number, ls: any) => {
        const videos = Array.isArray(ls.videos) ? ls.videos : [];
        const vidsSum = videos.reduce(
          (va: number, v: any) => va + (Number(v?.durationSeconds) || 0),
          0
        );
        return la + vidsSum;
      }, 0);
      return acc + lessonsSum;
    }, 0);
  } catch {
    return 0;
  }
};

// Sum total duration for a single lesson
const sumLessonDurationSeconds = (lesson: any) => {
  try {
    const videos = Array.isArray(lesson?.videos) ? lesson.videos : [];
    return videos.reduce(
      (acc: number, v: any) => acc + (Number(v?.durationSeconds) || 0),
      0
    );
  } catch {
    return 0;
  }
};

// Compute and assign aggregate stats to the course document
const recomputeCourseStats = (course: any) => {
  const chapters = Array.isArray(course.chapters) ? course.chapters : [];
  const totalChapters = chapters.length;
  let totalQuizzes = 0;
  for (const ch of chapters) {
    const quizzes = Array.isArray(ch?.quizzes) ? ch.quizzes : [];
    totalQuizzes += quizzes.length;
  }
  const videoDuration = sumCourseDurationSeconds(course);
  const totalDurationSeconds = videoDuration + totalQuizzes * 30;
  course.totalChapters = totalChapters;
  course.totalQuizzes = totalQuizzes;
  course.totalDurationSeconds = totalDurationSeconds;
};

/**
 * Enqueue subtitle jobs for all videos in a course that don't yet have subtitles.
 * Uses upsert to avoid duplicates (compound unique index on courseId + cloudinaryId).
 * This is fire-and-forget — errors are logged but never block the response.
 */
const enqueueCourseSubtitleJobs = async (courseId: any, chapters: any[]): Promise<void> => {
  try {
    const chaps = Array.isArray(chapters) ? chapters : [];
    const cloudinaryIds: string[] = [];

    for (const ch of chaps) {
      const lessons = Array.isArray(ch?.lessons) ? ch.lessons : [];
      for (const ls of lessons) {
        const videos = Array.isArray(ls?.videos) ? ls.videos : [];
        for (const v of videos) {
          const cid = String(v?.cloudinaryId || "").trim();
          // Only enqueue if the video has a cloudinaryId and NO existing subtitles
          const hasSubtitles = Array.isArray(v?.subtitles) && v.subtitles.length > 0;
          if (cid && !hasSubtitles) {
            cloudinaryIds.push(cid);
          }
        }
      }
    }

    if (cloudinaryIds.length === 0) return;

    // Deduplicate
    const unique = [...new Set(cloudinaryIds)];

    const NOT_BEFORE_DELAY_MS = 2 * 60 * 1000; // 2 minutes — Cloudinary needs time to process
    const ops = unique.map((cid) => ({
      updateOne: {
        filter: { courseId, cloudinaryId: cid },
        update: {
          $set: {
            // Always reset to pending so the worker picks it up
            subtitle_status: "pending" as const,
            subtitle_failure_reason: null,
          },
          $setOnInsert: {
            courseId,
            cloudinaryId: cid,
            subtitle_retry_count: 0,
            last_subtitle_attempt: null,
            retryable: false,
            // Defer first-attempt by 2 min so Cloudinary finishes processing the upload
            not_before: new Date(Date.now() + NOT_BEFORE_DELAY_MS),
          },
        },
        upsert: true,
      },
    }));

    await CourseSubtitleJob.bulkWrite(ops, { ordered: false });
    logger.info(
      `[CourseSubtitles] Enqueued ${unique.length} subtitle job(s) for course ${courseId}`
    );
  } catch (error) {
    // Never let subtitle enqueuing break the course save flow
    logger.error(`[CourseSubtitles] Failed to enqueue jobs for course ${courseId}:`, error);
  }
};

// Upload lesson video (metadata only)
export const uploadLessonVideo = async (
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

    const canUpload = await auth.api.userHasPermission({
      body: { permissions: { course: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canUpload?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const { cloudinaryUrl, cloudinaryId, thumbnailUrl, durationSeconds } =
      req.body as {
        cloudinaryUrl: string;
        cloudinaryId: string;
        thumbnailUrl: string;
        durationSeconds: number;
      };

    if (
      !cloudinaryUrl ||
      !cloudinaryId ||
      !thumbnailUrl ||
      durationSeconds === undefined ||
      durationSeconds === null
    ) {
      return sendError(res, 400, "Missing required fields");
    }

    if (typeof durationSeconds !== "number" || durationSeconds < 0) {
      return sendError(res, 400, "durationSeconds must be a non-negative number");
    }

    return sendSuccess(res, 200, "Video metadata received", {
      cloudinaryUrl,
      cloudinaryId,
      durationSeconds,
      thumbnailUrl,
    });
  } catch (error) {
    console.error("Error in uploadLessonVideo controller:", error);
    next(error);
  }
};

// Create Course
export const createCourseBasic = async (
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

    const canCreate = await auth.api.userHasPermission({
      body: { permissions: { course: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canCreate?.success)
      return sendError(res, 403, "Forbidden: insufficient permissions");

    const { title, description, tags, status, accessLevel, thumbnailUrl, visibility } = req.body as {
      title?: string;
      description?: string;
      tags?: string[] | string;
      status?: "draft" | "pending" | "published";
      accessLevel?: "free" | "develop" | "master";
      thumbnailUrl?: string;
      visibility?: "clinicians" | "users" | "all";
    };

    if (!title || !description) {
      return sendError(res, 400, "Title and description are required.");
    }

    let normalizedTags: string[] = [];
    if (tags) {
      let tagsArray: string[] = [];
      if (typeof tags === "string") {
        tagsArray = tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      } else if (Array.isArray(tags)) {
        tagsArray = tags;
      }
      if (tagsArray.length > 0) {
        const uniqueTags = Array.from(new Set(tagsArray.map(normalizeTag)));
        const existing = await Tag.find({
          slug: { $in: uniqueTags },
          active: true,
        })
          .select("slug")
          .lean();
        const existingSlugs = new Set(existing.map((c: any) => c.slug));
        normalizedTags = uniqueTags.filter((t) => existingSlugs.has(t));
      }
    }

    // Handle optional thumbnail upload (image) or URL
    let finalThumbnailUrl = typeof thumbnailUrl === "string" ? thumbnailUrl.trim() : "";
    let finalThumbnailCloudinaryId: string = "";
    if (req.file?.buffer) {
      const img = req.file;
      if (!img.mimetype.startsWith("image/")) {
        return sendError(res, 400, "Invalid thumbnail file type");
      }
      const maxThumbSize = 100 * 1024 * 1024; // 100MB
      if (img.buffer.length > maxThumbSize) {
        return sendError(res, 400, "Thumbnail size exceeds 100 MB");
      }
      try {
        const result: any = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              resource_type: "image",
              folder: "course_thumbnails",
            },
            (error, uploadResult) => {
              if (error) reject(error);
              else resolve(uploadResult);
            }
          );
          Readable.from(img.buffer).pipe(stream);
        });
        if (result?.secure_url) {
          finalThumbnailUrl = result.secure_url;
        }
        if (result?.public_id) {
          finalThumbnailCloudinaryId = result.public_id;
        }
      } catch (err) {
        return sendError(res, 500, "Failed to upload thumbnail to Cloudinary");
      }
    }

    const requestedVisibility = visibility || "users";
    const allowedVisibility = ["clinicians", "users", "all"] as const;
    if (!allowedVisibility.includes(requestedVisibility as any)) {
      return sendError(res, 400, "Invalid visibility");
    }

    const course = await Course.create({
      title,
      description,
      tags: normalizedTags,
      status: status || "draft",
      accessLevel: accessLevel || "free",
      visibility: requestedVisibility,
      user: new mongoose.Types.ObjectId(user.id),
      createdBy: {
        _id: new mongoose.Types.ObjectId(user.id),
        name: String((user as any).name || ""),
        email: String((user as any).email || ""),
      },
      thumbnailUrl: finalThumbnailUrl || "",
      thumbnailCloudinaryId: finalThumbnailCloudinaryId || "",
      chapters: [],
      resources: [],
      totalDurationSeconds: 0,
      totalQuizzes: 0,
      totalChapters: 0,
    });

    try {
      const isPending = String((course as any).status) === "pending";
      if (isPending) {
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
        const titleMsg = "New course submission";
        const bodyMsg = `New course submitted by: ${String((user as any).name || "Unknown")}`;
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
                  data: { _id: String((course as any)._id), status: "pending", event: "course-submitted" },
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
              data: { _id: String((course as any)._id), status: "pending", event: "course-submitted" },
              read: false,
            });
          } catch {}
        }
      }
    } catch {}

    return sendSuccess(res, 201, "Course created", course);
  } catch (error) {
    next(error);
  }
};

// Update course tags (admin or owner)
export const updateCourse = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };
    const {
      title,
      description,
      tags,
      accessLevel,
      visibility,
      status,
      chapters,
      thumbnailUrl,
      thumbnailCloudinaryId,
    } = req.body as {
      title?: string;
      description?: string;
      tags?: string[] | string;
      accessLevel?: "free" | "develop" | "master" | string;
      visibility?: "clinicians" | "users" | "all" | string;
      status?: "draft" | "pending" | "published" | string;
      chapters?: any[];
      thumbnailUrl?: string;
      thumbnailCloudinaryId?: string;
    };

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canEdit = await auth.api.userHasPermission({
      body: { permissions: { course: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canEdit?.success)
      return sendError(res, 403, "Forbidden: insufficient permissions");

    const course = await Course.findById(id);
    if (!course) return sendError(res, 404, "Course not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = course.user.toString() === user.id;
    if (!isAdmin && !isOwner)
      return sendError(res, 403, "Forbidden: only admin or owner can edit");

    // Apply title
    if (title !== undefined) {
      if (typeof title !== "string") return sendError(res, 400, "title must be a string");
      course.title = title.trim();
    }

    // Apply description
    if (description !== undefined) {
      if (typeof description !== "string")
        return sendError(res, 400, "description must be a string");
      course.description = description;
    }

    // Apply accessLevel
    if (accessLevel !== undefined) {
      const allowedAccess = ["free", "develop", "master"] as const;
      const normalized = String(accessLevel).toLowerCase();
      if (!allowedAccess.includes(normalized as any)) {
        return sendError(res, 400, "Invalid accessLevel");
      }
      course.accessLevel = normalized as any;
    }

    // Apply visibility
    if (visibility !== undefined) {
      const allowedVisibility = ["clinicians", "users", "all"] as const;
      const v = String(visibility).toLowerCase();
      if (!allowedVisibility.includes(v as any)) {
        return sendError(res, 400, "Invalid visibility");
      }
      course.visibility = v as any;
    }

    // Apply tags (optional)
    if (tags !== undefined) {
      if (!(typeof tags === "string" || Array.isArray(tags))) {
        return sendError(res, 400, "tags must be a string or string[]");
      }
      const rawTags = typeof tags === "string"
        ? tags
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0)
        : tags;
      const normalizedTags = Array.from(new Set(rawTags.map(normalizeTag)));
      if (normalizedTags.length > 0) {
        const existing = await Tag.find({ slug: { $in: normalizedTags }, active: true })
          .select("slug")
          .lean();
        const existingSlugs = new Set(existing.map((c: any) => c.slug));
        const validNormalized = normalizedTags.filter((t) => existingSlugs.has(t));

        if (normalizedTags.length > 0 && validNormalized.length === 0) {
          return sendError(res, 400, "Invalid tags: provide existing tag slugs");
        }

        if (validNormalized.length > 0) {
          course.tags = validNormalized;
        }
      } else {
        // If tags provided but empty after parsing, leave unchanged
      }
    }

    // Apply thumbnail
    if (req.file?.buffer) {
      const img = req.file;
      if (!img.mimetype.startsWith("image/")) {
        return sendError(res, 400, "Invalid thumbnail file type");
      }
      const maxThumbSize = 100 * 1024 * 1024; // 100MB
      if (img.buffer.length > maxThumbSize) {
        return sendError(res, 400, "Thumbnail size exceeds 100 MB");
      }
      try {
        const result: any = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              resource_type: "image",
              folder: "course_thumbnails",
            },
            (error, uploadResult) => {
              if (error) reject(error);
              else resolve(uploadResult);
            }
          );
          Readable.from(img.buffer).pipe(stream);
        });
        if (result?.secure_url) {
          // If replacing an existing cloudinary image, delete the old one
          if (course.thumbnailCloudinaryId) {
            await cloudinary.uploader.destroy(course.thumbnailCloudinaryId).catch(() => {});
          }
          course.thumbnailUrl = result.secure_url;
          course.thumbnailCloudinaryId = result.public_id;
        }
      } catch (err) {
        return sendError(res, 500, "Failed to upload thumbnail to Cloudinary");
      }
    } else if (thumbnailUrl !== undefined) {
      if (typeof thumbnailUrl === "string") {
        course.thumbnailUrl = thumbnailUrl.trim();
        // If explicitly clearing the URL, also clear the ID
        if (course.thumbnailUrl === "") {
          if (course.thumbnailCloudinaryId) {
            await cloudinary.uploader.destroy(course.thumbnailCloudinaryId).catch(() => {});
          }
          course.thumbnailCloudinaryId = "";
        }
      }
    }

    // Apply status (restricted)
    if (status !== undefined) {
      const allowedStatuses = ["draft", "pending", "published"] as const;
      const s = String(status).toLowerCase();
      if (!allowedStatuses.includes(s as any)) {
        return sendError(res, 400, "Invalid status");
      }
      const role = (user as any).role;
      const isAdmin = Array.isArray(role)
        ? role.includes("admin")
        : role === "admin";
      const isOwner = course.user.toString() === user.id;
      if (s === "published" && !isAdmin) {
        return sendError(res, 403, "Forbidden: only admin can set published");
      }
      if (!isAdmin && !isOwner) {
        return sendError(res, 403, "Forbidden: only admin or owner can edit");
      }
      course.status = s as any;
    }

    // Apply chapters (full structure update)
    if (chapters !== undefined) {
      if (!Array.isArray(chapters)) {
        return sendError(res, 400, "chapters must be an array");
      }
      course.chapters = chapters;
      course.markModified("chapters");
      recomputeCourseStats(course);
    }

    await course.save();

    // If chapters were replaced, enqueue subtitle jobs for any new videos
    if (chapters !== undefined) {
      enqueueCourseSubtitleJobs(course._id, course.chapters as any[]);
    }

    return sendSuccess(res, 200, "Course updated", course);
  } catch (error) {
    next(error);
  }
};

// Add Chapter to Course
export const addChapterToCourse = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { courseId } = req.params as { courseId: string };
    const { title } = req.body as {
      title?: string;
    };

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canEdit = await auth.api.userHasPermission({
      body: { permissions: { course: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canEdit?.success)
      return sendError(res, 403, "Forbidden: insufficient permissions");

    if (!title) return sendError(res, 400, "Chapter title is required");

    const course = await Course.findById(courseId);
    if (!course) return sendError(res, 404, "Course not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    const isOwner = course.user.toString() === user.id;
    if (!isAdmin && !isOwner)
      return sendError(res, 403, "Forbidden: only admin or owner can edit");

    const chapter = {
      title,
      lessons: [],
      quizzes: [],
    } as any;
    course.chapters = Array.isArray(course.chapters) ? course.chapters : [];
    course.chapters.push(chapter);
    const createdChapter = course.chapters[course.chapters.length - 1];
    course.markModified("chapters");
    recomputeCourseStats(course);
    await course.save();

    return sendSuccess(res, 201, "Chapter added", createdChapter);
  } catch (error) {
    next(error);
  }
};

//Delete Chapter
export const deleteChapter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { courseId, chapterIndex } = req.params as {
      courseId: string;
      chapterIndex: string;
    };
    const cIdx = Number(chapterIndex);
    if (!Number.isInteger(cIdx) || cIdx < 0)
      return sendError(res, 400, "Invalid chapterIndex");

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canEdit = await auth.api.userHasPermission({
      body: { permissions: { course: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canEdit?.success)
      return sendError(res, 403, "Forbidden: insufficient permissions");

    const course = await Course.findById(courseId);
    if (!course) return sendError(res, 404, "Course not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    const isOwner = course.user.toString() === user.id;
    if (!isAdmin && !isOwner)
      return sendError(res, 403, "Forbidden: only admin or owner can edit");

    const chapter = course.chapters[cIdx];
    if (!chapter) return sendError(res, 404, "Chapter not found");

    // Cleanup Cloudinary lesson videos in this chapter
    const lessons = Array.isArray(chapter.lessons) ? chapter.lessons : [];
    for (const ls of lessons) {
      const videos = Array.isArray(ls.videos) ? ls.videos : [];
      for (const v of videos) {
        const vidId = (v as any)?.cloudinaryId;
        if (!vidId) continue;
        try {
          await cloudinary.uploader.destroy(vidId, { resource_type: "video" });
        } catch (cloudErr) {
          console.error("Cloudinary deletion failed:", cloudErr);
        }
      }
    }

    const deletedChapter = chapter;
    course.chapters.splice(cIdx, 1);
    course.markModified("chapters");
    recomputeCourseStats(course);
    await course.save();

    return sendSuccess(res, 200, "Chapter deleted", {
      chapterIndex: cIdx,
      chapterId: (deletedChapter as any)?._id || undefined,
    });
  } catch (error) {
    next(error);
  }
};

//Add Lesson to Chapter
export const addLessonToChapter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { courseId, chapterIndex } = req.params as {
      courseId: string;
      chapterIndex: string;
    };
    const cIdx = Number(chapterIndex);
    if (!Number.isInteger(cIdx) || cIdx < 0)
      return sendError(res, 400, "Invalid chapterIndex");

    const { title, description, videos } = req.body as {
      title?: string;
      description?: string;
      videos?: Array<{
        cloudinaryUrl: string;
        cloudinaryId: string;
        durationSeconds?: number;
        thumbnailUrl?: string;
      }>;
    };
    if (!title) return sendError(res, 400, "Lesson title is required");

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canEdit = await auth.api.userHasPermission({
      body: { permissions: { course: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canEdit?.success)
      return sendError(res, 403, "Forbidden: insufficient permissions");

    const course = await Course.findById(courseId);
    if (!course) return sendError(res, 404, "Course not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    const isOwner = course.user.toString() === user.id;
    if (!isAdmin && !isOwner)
      return sendError(res, 403, "Forbidden: only admin or owner can edit");

    const chapter = course.chapters[cIdx];
    if (!chapter) return sendError(res, 404, "Chapter not found");

    const buildVideos = () => {
      const out: any[] = [];
      if (Array.isArray(videos)) {
        for (const v of videos) {
          if (!v?.cloudinaryUrl || !v?.cloudinaryId) {
            return sendError(
              res,
              400,
              "Each video must have cloudinaryUrl and cloudinaryId"
            );
          }
          const d = Number(v.durationSeconds) || 0;
          const off = d >= 1 ? 1 : 0;
          const finalThumb =
            typeof v.thumbnailUrl === "string" && v.thumbnailUrl.trim().length > 0
              ? v.thumbnailUrl
              : cloudinary.url(v.cloudinaryId, {
                  resource_type: "video",
                  format: "jpg",
                  transformation: [{ start_offset: off }],
                });
          out.push({
            cloudinaryUrl: v.cloudinaryUrl,
            cloudinaryId: v.cloudinaryId,
            durationSeconds: d,
            thumbnailUrl: finalThumb,
          });
        }
      }
      return out;
    };

    chapter.lessons = Array.isArray(chapter.lessons) ? chapter.lessons : [];
    if (chapter.lessons.length === 0) {
      const lesson: any = {
        title,
        description: description || "",
        videos: buildVideos(),
      };
      chapter.lessons.push(lesson);
      course.markModified("chapters");
      recomputeCourseStats(course);
      await course.save();

      // Enqueue subtitle jobs for the newly added videos
      enqueueCourseSubtitleJobs(course._id, course.chapters as any[]);

      return sendSuccess(res, 201, "Lesson added", lesson);
    } else {
      const existing = chapter.lessons[0];
      existing.title = title;
      existing.description = description || existing.description || "";
      const newVideos = buildVideos();
      if (Array.isArray(videos)) {
        existing.videos = newVideos as any[];
      }
      chapter.lessons[0] = existing;
      course.markModified("chapters");
      recomputeCourseStats(course);
      await course.save();

      // Enqueue subtitle jobs for the updated videos
      enqueueCourseSubtitleJobs(course._id, course.chapters as any[]);

      return sendSuccess(res, 200, "Lesson updated", existing);
    }
  } catch (error) {
    next(error);
  }
};

//Add Quiz to Chapter
export const addQuizToChapter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { courseId, chapterIndex } = req.params as {
      courseId: string;
      chapterIndex: string;
    };
    const cIdx = Number(chapterIndex);
    if (!Number.isInteger(cIdx) || cIdx < 0)
      return sendError(res, 400, "Invalid chapterIndex");

    const { title, questions } = req.body as {
      title?: string;
      questions?: Array<{
        type: "single" | "multiple";
        prompt: string;
        options: Array<{ text: string }>;
        correctOptionIndexes: number[];
      }>;
    };

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canEdit = await auth.api.userHasPermission({
      body: { permissions: { course: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canEdit?.success)
      return sendError(res, 403, "Forbidden: insufficient permissions");

    const course = await Course.findById(courseId);
    if (!course) return sendError(res, 404, "Course not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    const isOwner = course.user.toString() === user.id;
    if (!isAdmin && !isOwner)
      return sendError(res, 403, "Forbidden: only admin or owner can edit");

    const chapter = course.chapters[cIdx];
    if (!chapter) return sendError(res, 404, "Chapter not found");

    const buildQuestions = () => {
      if (!Array.isArray(questions)) return undefined;
      const out: any[] = [];
      for (const q of questions) {
        if (
          !q?.prompt ||
          !q?.type ||
          !Array.isArray(q.options) ||
          !Array.isArray(q.correctOptionIndexes)
        ) {
          return sendError(res, 400, "Invalid quiz question payload");
        }
        const typeLower = String(q.type).toLowerCase();
        if (!["single", "multiple"].includes(typeLower)) {
          return sendError(
            res,
            400,
            "Question type must be 'single' or 'multiple'"
          );
        }
        const opts = q.options
          .map((o) => ({ text: String(o.text || "") }))
          .filter((o) => o.text);
        if (opts.length === 0)
          return sendError(res, 400, "Question must have at least one option");
        const idxs = Array.from(
          new Set((q.correctOptionIndexes || []).map((i) => Number(i)))
        );
        if (idxs.length === 0)
          return sendError(
            res,
            400,
            "correctOptionIndexes must include at least one index"
          );
        if (
          !idxs.every((i) => Number.isInteger(i) && i >= 0 && i < opts.length)
        ) {
          return sendError(
            res,
            400,
            "correctOptionIndexes contain invalid indexes"
          );
        }
        if (typeLower === "single" && idxs.length !== 1) {
          return sendError(
            res,
            400,
            "Single-answer questions must have exactly one correct index"
          );
        }
        out.push({
          type: typeLower as any,
          prompt: q.prompt,
          options: opts,
          correctOptionIndexes: idxs,
        });
      }
      return out;
    };

    chapter.quizzes = Array.isArray(chapter.quizzes) ? chapter.quizzes : [];
    const builtQuestions = buildQuestions();
    if (chapter.quizzes.length === 0) {
      if (!title) return sendError(res, 400, "Quiz title is required");
      const quiz: any = { title, questions: builtQuestions || [] };
      chapter.quizzes.push(quiz);
      course.markModified("chapters");
      recomputeCourseStats(course);
      await course.save();
      return sendSuccess(res, 201, "Quiz added", quiz);
    } else {
      const existing = chapter.quizzes[0];
      if (title !== undefined) existing.title = title;
      if (builtQuestions !== undefined && !Array.isArray(builtQuestions) && (builtQuestions as any)?.constructor?.name === 'Response') {
        // builtQuestions is actually a response object, return it
        return builtQuestions;
      }
      if (builtQuestions !== undefined && Array.isArray(builtQuestions)) {
        existing.questions = builtQuestions;
      }
      chapter.quizzes[0] = existing;
      course.markModified("chapters");
      recomputeCourseStats(course);
      await course.save();
      return sendSuccess(res, 200, "Quiz updated", existing);
    }
  } catch (error) {
    next(error);
  }
};

export const deleteQuizFromChapter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { courseId, chapterIndex, quizIndex } = req.params as any;
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return sendError(res, 400, "Invalid course ID format.");
    }
    const cIdx = Number(chapterIndex);
    const qIdx = Number(quizIndex);
    if (!Number.isInteger(cIdx) || cIdx < 0) {
      return sendError(res, 400, "Invalid chapterIndex");
    }
    if (!Number.isInteger(qIdx) || qIdx < 0) {
      return sendError(res, 400, "Invalid quizIndex");
    }
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }
    const canEdit = await auth.api.userHasPermission({
      body: { permissions: { course: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canEdit?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }
    const course = await Course.findById(courseId);
    if (!course) {
      return sendError(res, 404, "Course not found");
    }
    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = course.user?.toString() === (user as any).id;
    if (!isAdmin && !isOwner) {
      return sendError(res, 403, "Forbidden: only admin or owner can edit");
    }
    const chapter = course.chapters[cIdx];
    if (!chapter) {
      return sendError(res, 404, "Chapter not found");
    }
    chapter.quizzes = Array.isArray(chapter.quizzes) ? chapter.quizzes : [];
    const quiz = chapter.quizzes[qIdx];
    if (!quiz) {
      return sendError(res, 404, "Quiz not found");
    }
    chapter.quizzes.splice(qIdx, 1);
    course.markModified("chapters");
    recomputeCourseStats(course);
    await course.save();
    return sendSuccess(res, 200, "Quiz deleted", {
      chapterIndex: cIdx,
      quizIndex: qIdx,
    });
  } catch (error) {
    next(error);
  }
};

// Submit quiz responses for a chapter (current user)
export const submitQuizResponses = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { courseId, chapterId } = req.params as {
      courseId: string;
      chapterId: string;
    };
    const { answers } = req.body as {
      answers: Array<{ questionIndex: number; selectedOptionIndexes: number[] }>; // required
    };

    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { course: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) return sendError(res, 403, "Forbidden: insufficient permissions");

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return sendError(res, 400, "Invalid course ID format.");
    }
    if (!mongoose.Types.ObjectId.isValid(chapterId)) {
      return sendError(res, 400, "Invalid chapter ID format.");
    }
    if (!Array.isArray(answers) || answers.length === 0) {
      return sendError(res, 400, "answers must be a non-empty array");
    }

    // Load course and chapter quiz
    const course = await Course.findById(courseId).select("chapters status user");
    if (!course) return sendError(res, 404, "Course not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = course.user?.toString() === (user as any).id;
    if (!isAdmin && !isOwner && course.status !== "published") {
      return sendError(res, 403, "Forbidden: course not accessible");
    }

    const chapter = (Array.isArray(course.chapters) ? course.chapters : []).find(
      (ch: any) => String(ch?._id) === String(chapterId)
    );
    if (!chapter) return sendError(res, 404, "Chapter not found");
    chapter.quizzes = Array.isArray(chapter.quizzes) ? chapter.quizzes : [];
    if (chapter.quizzes.length === 0) return sendError(res, 404, "Quiz not found for this chapter");
    const quiz = chapter.quizzes[0];
    const questions = Array.isArray((quiz as any).questions) ? (quiz as any).questions : [];
    const totalQuestions = questions.length;
    if (totalQuestions === 0) return sendError(res, 400, "Quiz has no questions");

    // Validate and score answers
    const validatedAnswers: Array<{ questionIndex: number; selectedOptionIndexes: number[]; isCorrect: boolean }> = [];
    for (const ans of answers) {
      const qIdx = Number(ans?.questionIndex);
      const sel = Array.isArray(ans?.selectedOptionIndexes) ? ans!.selectedOptionIndexes! : [];
      if (!Number.isInteger(qIdx) || qIdx < 0 || qIdx >= totalQuestions) {
        return sendError(res, 400, `Invalid questionIndex: ${ans?.questionIndex}`);
      }
      const q = questions[qIdx] as any;
      const optsLen = Array.isArray(q?.options) ? q.options.length : 0;
      if (optsLen === 0) return sendError(res, 400, `Question ${qIdx} has no options`);
      const selected = Array.from(new Set(sel.map((i) => Number(i)))).filter(
        (i) => Number.isInteger(i) && i >= 0 && i < optsLen
      );
      if (q.type === "single" && selected.length !== 1) {
        return sendError(res, 400, `Question ${qIdx} requires exactly one option`);
      }
      if (q.type === "multiple" && selected.length < 1) {
        return sendError(res, 400, `Question ${qIdx} requires at least one option`);
      }
      const correctIdxs = Array.from(new Set((q?.correctOptionIndexes || []).map((i: number) => Number(i)))).sort();
      const selectedSorted = selected.slice().sort();
      const isCorrect = correctIdxs.length === selectedSorted.length && correctIdxs.every((v, i) => v === selectedSorted[i]);
      validatedAnswers.push({ questionIndex: qIdx, selectedOptionIndexes: selectedSorted, isCorrect });
    }

    const responseDoc = await QuizResponse.create({
      userId: (user as any).id,
      courseId,
      chapterId,
      quizIndex: 0,
      answers: validatedAnswers,
    });

    return sendSuccess(res, 201, "Quiz responses saved", responseDoc);
  } catch (error) {
    next(error);
  }
};


//Upload Resources.
export const uploadCourseResources = async (
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
    if (!user) return sendError(res, 401, "Unauthorized");

    const canEdit = await auth.api.userHasPermission({
      body: { permissions: { course: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canEdit?.success)
      return sendError(res, 403, "Forbidden: insufficient permissions");

    const course = await Course.findById(id);
    if (!course) return sendError(res, 404, "Course not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = course.user.toString() === user.id;
    if (!isAdmin && !isOwner)
      return sendError(res, 403, "Forbidden: only admin or owner can upload resources");

    const files = (req.files as Express.Multer.File[]) || [];
    if (!Array.isArray(files) || files.length === 0)
      return sendError(res, 400, "No files provided");

    const MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
    const skippedTooLarge: { name: string; sizeBytes: number }[] = [];
    const failedUploads: { name: string; error: string }[] = [];
    const addedResources: any[] = [];

    // Helper: upload buffer to Cloudinary via stream
    const uploadBuffer = (buffer: Buffer, filename: string) =>
      new Promise<any>((resolve, reject) => {
        const folder = `courses/${id}/resources`;
        const stream = cloudinary.uploader.upload_stream(
          { resource_type: "auto", folder, filename_override: filename },
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          }
        );
        const readable = new Readable();
        readable.push(buffer);
        readable.push(null);
        readable.pipe(stream);
      });

    for (const file of files) {
      try {
        if (file.size > MAX_SIZE_BYTES) {
          skippedTooLarge.push({ name: file.originalname, sizeBytes: file.size });
          continue;
        }

        const result = await uploadBuffer(file.buffer, file.originalname);
        const resource = {
          name: file.originalname,
          url: result.secure_url,
          cloudinaryId: result.public_id,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        };
        course.resources = Array.isArray(course.resources) ? course.resources : [];
        course.resources.push(resource as any);
        addedResources.push(resource);
      } catch (err: any) {
        failedUploads.push({ name: file.originalname, error: String(err?.message || err) });
      }
    }

    course.markModified("resources");
    await course.save();

    return sendSuccess(res, 200, "Resources uploaded", {
      added: addedResources,
      skippedTooLarge,
      failed: failedUploads,
    });
  } catch (error) {
    next(error);
  }
};

// Delete a single course resource by index
export const deleteCourseResource = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id, resourceIndex } = req.params as { id: string; resourceIndex: string };

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid course ID format.");
    }

    const idx = Number(resourceIndex);
    if (!Number.isInteger(idx) || idx < 0) {
      return sendError(res, 400, "Invalid resourceIndex");
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    const canEdit = await auth.api.userHasPermission({
      body: { permissions: { course: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canEdit?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const course = await Course.findById(id);
    if (!course) {
      return sendError(res, 404, "Course not found");
    }

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = course.user.toString() === user.id;
    if (!isAdmin && !isOwner) {
      return sendError(res, 403, "Forbidden: only admin or owner can delete resources");
    }

    const resources = Array.isArray(course.resources) ? course.resources : [];
    const resource = resources[idx] as any;
    if (!resource) {
      return sendError(res, 404, "Resource not found");
    }

    // Attempt to cleanup from Cloudinary if we have an ID
    const publicId = resource.cloudinaryId as string | undefined;
    const mime = resource.mimeType as string | undefined;
    if (publicId) {
      let resourceType: "image" | "video" | "raw" = "raw";
      if (typeof mime === "string") {
        if (mime.startsWith("image/")) resourceType = "image";
        else if (mime.startsWith("video/")) resourceType = "video";
        else resourceType = "raw";
      }
      try {
        await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
      } catch (cloudErr) {
        console.error("Cloudinary deletion failed:", cloudErr);
        // Continue even if Cloudinary cleanup fails
      }
    }

    // Remove the resource from the course
    course.resources.splice(idx, 1);
    course.markModified("resources");
    await course.save();

    return sendSuccess(res, 200, "Resource deleted", {
      resourceIndex: idx,
      deleted: { name: resource.name, cloudinaryId: resource.cloudinaryId },
      remainingCount: course.resources.length,
    });
  } catch (error) {
    next(error);
  }
};

// Delete a course (admin or owner)
export const deleteCourse = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid course ID format.");
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    const course = await Course.findById(id);
    if (!course) {
      return sendError(res, 404, "Course not found");
    }

    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    const isOwner = course.user.toString() === user.id;
    if (!isAdmin && !isOwner) {
      return sendError(res, 403, "Forbidden: only admin or owner can delete");
    }

    // Cleanup Cloudinary lesson videos
    const chapters = Array.isArray(course.chapters) ? course.chapters : [];
    for (const ch of chapters) {
      const lessons = Array.isArray(ch.lessons) ? ch.lessons : [];
      for (const ls of lessons) {
        const videos = Array.isArray(ls.videos) ? ls.videos : [];
        for (const v of videos) {
          const vidId = v?.cloudinaryId;
          if (!vidId) continue;
          try {
            await cloudinary.uploader.destroy(vidId, {
              resource_type: "video",
            });
          } catch (cloudErr) {
            console.error("Cloudinary deletion failed:", cloudErr);
          }
        }
      }
    }

    // Cleanup course-level thumbnail if stored in Cloudinary
    let thumbId = (course as any).thumbnailCloudinaryId as string | undefined;
    if (!thumbId && typeof (course as any).thumbnailUrl === "string") {
      const url: string = (course as any).thumbnailUrl;
      // Try to infer public_id from Cloudinary URL structure
      // e.g., https://res.cloudinary.com/<cloud>/image/upload/v123/course_thumbnails/abc123.jpg
      try {
        const uploadIdx = url.indexOf("/upload/");
        if (uploadIdx !== -1) {
          const pathAfterUpload = url.substring(uploadIdx + "/upload/".length);
          // strip leading version segment like v123/
          const parts = pathAfterUpload.split("/");
          const first = parts[0];
          let startIdx = 0;
          if (first && /^v\d+$/.test(first)) {
            startIdx = 1;
          }
          const withoutVersion = parts.slice(startIdx).join("/");
          // remove file extension
          const lastDot = withoutVersion.lastIndexOf(".");
          thumbId = (lastDot !== -1 ? withoutVersion.substring(0, lastDot) : withoutVersion) || undefined;
        }
      } catch {}
    }
    if (thumbId) {
      try {
        await cloudinary.uploader.destroy(thumbId, { resource_type: "image" });
      } catch (cloudErr) {
        console.error("Cloudinary deletion failed for thumbnail:", cloudErr);
      }
    }

    // Cleanup uploaded resources
    const resources = Array.isArray(course.resources) ? course.resources : [];
    for (const r of resources as any[]) {
      const resId: string | undefined = r?.cloudinaryId;
      const mime: string | undefined = r?.mimeType;
      if (!resId) continue;
      let resourceType: "image" | "video" | "raw" = "raw";
      if (typeof mime === "string") {
        if (mime.startsWith("image/")) resourceType = "image";
        else if (mime.startsWith("video/")) resourceType = "video";
        else resourceType = "raw";
      }
      try {
        await cloudinary.uploader.destroy(resId, { resource_type: resourceType });
      } catch (cloudErr) {
        console.error("Cloudinary deletion failed for resource:", cloudErr);
      }
    }

    // Best-effort: delete any residual resources under the course-specific folder
    const resourcesPrefix = `courses/${id}/resources`;
    try {
      // @ts-ignore - admin API available at runtime
      await (cloudinary as any).api.delete_resources_by_prefix(resourcesPrefix);
      // @ts-ignore - attempt to delete folder
      await (cloudinary as any).api.delete_folder(resourcesPrefix);
    } catch (cloudErr) {
      console.warn("Cloudinary admin cleanup warning:", (cloudErr as any)?.message || cloudErr);
    }

    const deleteResult = await Course.findByIdAndDelete(id);
    if (!deleteResult) {
      return sendError(res, 500, "Failed to delete course from database.");
    }

    return sendSuccess(res, 200, "Course deleted", { id });
  } catch (error) {
    next(error);
  }
};

// Get all courses
export const getAllCourses = async (
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
      body: { permissions: { courseVideoStatus: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    // Robust pagination parsing to avoid NaN
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

    // Validate status filter
    const allowedStatuses = ["draft", "pending", "published", "rejected"] as const;
    if (statusQuery) {
      if (!allowedStatuses.includes(statusQuery as any)) {
        return sendError(res, 400, "Invalid status filter");
      }
    }

    // Build base filters (tags + text search)
    const baseAndFilters: any[] = [];

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
      baseAndFilters.push({ tags: { $in: slugs } });
    }

    if (q) {
      baseAndFilters.push({
        $or: [
          { title: { $regex: q, $options: "i" } },
          { description: { $regex: q, $options: "i" } },
        ],
      });
    }

    // Role-aware visibility
    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isTrainer = Array.isArray(role) ? role.includes("trainer") : role === "trainer";
    

    let visibilityFilter: any;
    if (isAdmin) {
      if (statusQuery === "draft") {
        visibilityFilter = { status: "draft", user: new mongoose.Types.ObjectId((user as any).id) };
      } else if (statusQuery === "pending") {
        visibilityFilter = { status: "pending" };
      } else if (statusQuery === "published") {
        visibilityFilter = { status: "published" };
      } else if (statusQuery === "rejected") {
        visibilityFilter = { status: "rejected" };
      } else {
        // No status filter: own drafts + all pending/published (rejected excluded unless explicitly requested)
        visibilityFilter = {
          $or: [
            { status: "pending" },
            { status: "published" },
            { status: "draft", user: new mongoose.Types.ObjectId((user as any).id) },
          ],
        };
      }
    } else if (isTrainer) {
      if (statusQuery === "published") {
        visibilityFilter = { status: "published" };
      } else if (statusQuery) {
        visibilityFilter = {
          status: statusQuery,
          user: new mongoose.Types.ObjectId((user as any).id),
        };
      } else {
        visibilityFilter = {
          user: new mongoose.Types.ObjectId((user as any).id),
          status: { $in: ["draft", "pending", "published"] },
        };
      }
    } else {
      visibilityFilter = { _id: { $exists: false } };
    }

    const mongoFilter =
      baseAndFilters.length > 0
        ? { $and: [...baseAndFilters, visibilityFilter] }
        : visibilityFilter;

    // Sorting controls
    const sortByParam =
      (req.query.sortBy as string) || (req.query.by as string) || "createdAt";
    const orderParam =
      (req.query.order as string) || (req.query.sort as string) || "desc";
    const orderNormalized = (orderParam || "").toLowerCase();
    const sortOrder = orderNormalized === "asc" ? 1 : -1; // default desc
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

    const total = await Course.countDocuments(mongoFilter);
    const data = await Course.find(mongoFilter)
      .select(
        "title description tags status accessLevel createdAt updatedAt user createdBy chapters thumbnailUrl totalDurationSeconds totalQuizzes totalChapters"
      )
      .sort(sort)
      .skip(offset)
      .limit(limit)
      .lean();

    const dataWithThumbnails = (data as any[]).map((c: any) => {
      let thumbnailUrl = c?.thumbnailUrl || "";
      const chapters = Array.isArray(c?.chapters) ? c.chapters : [];
      outer: for (const ch of chapters) {
        const lessons = Array.isArray(ch?.lessons) ? ch.lessons : [];
        for (const ls of lessons) {
          const videos = Array.isArray(ls?.videos) ? ls.videos : [];
          for (const v of videos) {
            if (!thumbnailUrl && v?.thumbnailUrl) {
              thumbnailUrl = v.thumbnailUrl;
              break outer;
            }
          }
        }
      }
      const { chapters: _omit, ...rest } = c;
      return { ...rest, thumbnailUrl };
    });

    const hasNext = offset + data.length < total;

    return sendSuccess(res, 200, "Courses fetched", dataWithThumbnails, {
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

// Get single course
export const getCourse = async (
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
      body: { permissions: { course: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const course = await Course.findById(id);
    if (!course) {
      return sendError(res, 404, "Course not found");
    }

    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    const isOwner = course.user.toString() === user.id;
    if (!isAdmin && !isOwner) {
      if (course.status !== "published") {
        return sendError(res, 403, "Forbidden: course not accessible");
      }
      const visible = canViewVideo(role as any, (course as any).visibility);
      if (!visible) {
        return sendError(res, 403, "Forbidden: visibility not allowed");
      }
    }

    const base = course.toObject();
    const chapters = Array.isArray((base as any).chapters) ? (base as any).chapters : [];
    const chaptersOut = chapters.map((ch: any) => {
      const lessons = Array.isArray(ch?.lessons) ? ch.lessons : [];
      const lessonsOut = lessons.map((ls: any) => {
        const videos = Array.isArray(ls?.videos) ? ls.videos : [];
        const videosOut = videos.map((v: any) => {
          const publicId = String(v?.cloudinaryId || "");
          const hlsUrl = publicId
            ? cloudinary.url(publicId, {
                resource_type: "video",
                format: "m3u8",
                transformation: [{ streaming_profile: "auto" }],
              })
            : v?.cloudinaryUrl || "";
        return { ...v, cloudinaryUrl: hlsUrl };
        });
        return { ...ls, videos: videosOut };
      });
      return { ...ch, lessons: lessonsOut };
    });
    const courseOut = { ...(base as any), chapters: chaptersOut };
    return sendSuccess(res, 200, "Course fetched", courseOut);
  } catch (error) {
    next(error);
  }
};

// Update course (admin or owner)
export const updateCourseVideo = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { courseId, chapterIndex, lessonIndex } = req.params;
    const {
      cloudinaryUrl,
      cloudinaryId,
      durationSeconds,
      thumbnailUrl,
      title,
      description,
    } = req.body as any;

    const cIdx = Number(chapterIndex);
    const lIdx = Number(lessonIndex);
    if (!Number.isInteger(cIdx) || cIdx < 0) {
      return sendError(res, 400, "Invalid chapterIndex");
    }
    if (!Number.isInteger(lIdx) || lIdx < 0) {
      return sendError(res, 400, "Invalid lessonIndex");
    }

    if (typeof cloudinaryUrl !== "string" || typeof cloudinaryId !== "string") {
      return sendError(res, 400, "cloudinaryUrl and cloudinaryId are required");
    }
    const duration =
      durationSeconds !== undefined ? Number(durationSeconds) : undefined;
    if (
      duration !== undefined &&
      (!Number.isFinite(duration) || duration < 0)
    ) {
      return sendError(res, 400, "Invalid durationSeconds");
    }

    // Find the course by its ID
    const course = await Course.findById(courseId);
    if (!course) {
      return sendError(res, 404, "Course not found");
    }

    // Ensure the chapter exists
    const chapter = course.chapters[cIdx];
    if (!chapter) {
      return sendError(res, 404, "Chapter not found");
    }

    // Ensure the lesson exists
    const lesson = chapter.lessons[lIdx];
    if (!lesson) {
      return sendError(res, 404, "Lesson not found");
    }

    // Optionally update lesson metadata
    if (typeof title === "string") {
      lesson.title = title;
    }
    if (typeof description === "string") {
      lesson.description = description;
    }

    // Ensure videos array exists
    lesson.videos = Array.isArray(lesson.videos) ? lesson.videos : [];

    // Upsert the first video for the lesson (or add new if none exists)
    const effectiveDuration =
      duration !== undefined
        ? duration
        : Number(lesson.videos?.[0]?.durationSeconds) || 0;
    const offset = effectiveDuration >= 1 ? 1 : 0;
    const finalThumbnail =
      typeof thumbnailUrl === "string" && thumbnailUrl.trim().length > 0
        ? thumbnailUrl
        : cloudinary.url(cloudinaryId, {
            resource_type: "video",
            format: "jpg",
            transformation: [{ start_offset: offset }],
          });

    // Subtitles are populated asynchronously by the subtitle worker + webhook.
    // Preserve existing subtitle track if the same video is being re-saved,
    // but reset subtitle fields when a new cloudinaryId is being set.
    const existingVideo = lesson.videos[0] as any;
    const isSameVideo = existingVideo?.cloudinaryId === cloudinaryId;
    const existingSubtitles = isSameVideo && Array.isArray(existingVideo?.subtitles)
      ? existingVideo.subtitles
      : [];
    const existingSubtitleStatus = isSameVideo ? existingVideo?.subtitle_status : undefined;

    const videoPayload = {
      title: lesson.title || "Lesson Video",
      cloudinaryUrl,
      cloudinaryId,
      durationSeconds: effectiveDuration,
      thumbnailUrl: finalThumbnail,
      subtitles: existingSubtitles,
      // Always stamp a subtitle_status so the card renders immediately after upload
      subtitle_status: existingSubtitleStatus || "pending",
      subtitle_failure_reason: isSameVideo ? (existingVideo?.subtitle_failure_reason ?? null) : null,
      subtitle_retry_count: isSameVideo ? (existingVideo?.subtitle_retry_count ?? 0) : 0,
      last_subtitle_attempt: isSameVideo ? (existingVideo?.last_subtitle_attempt ?? null) : null,
      retryable: isSameVideo ? (existingVideo?.retryable ?? false) : false,
    };
    let videoResult;
    if (lesson.videos.length > 0) {
      lesson.videos[0] = { ...lesson.videos[0], ...videoPayload } as any;
      videoResult = lesson.videos[0];
    } else {
      lesson.videos.push(videoPayload as any);
      videoResult = videoPayload;
    }

    // Save the course with the updated lesson
    course.markModified("chapters");
    recomputeCourseStats(course);
    await course.save();

    // Enqueue subtitle generation for this video (fire-and-forget)
    enqueueCourseSubtitleJobs(course._id, course.chapters as any[]);

    return sendSuccess(res, 200, "Video added to lesson", { video: videoResult });
  } catch (error) {
    next(error);
  }
};

// Delete a lesson video by index (admin or owner)
export const deleteLessonVideo = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { courseId, chapterIndex, lessonIndex, videoIndex } = req.params as any;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return sendError(res, 400, "Invalid course ID format.");
    }

    const cIdx = Number(chapterIndex);
    const lIdx = Number(lessonIndex);
    const vIdx = Number(videoIndex);
    if (!Number.isInteger(cIdx) || cIdx < 0) {
      return sendError(res, 400, "Invalid chapterIndex");
    }
    if (!Number.isInteger(lIdx) || lIdx < 0) {
      return sendError(res, 400, "Invalid lessonIndex");
    }
    if (!Number.isInteger(vIdx) || vIdx < 0) {
      return sendError(res, 400, "Invalid videoIndex");
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    const canEdit = await auth.api.userHasPermission({
      body: { permissions: { course: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canEdit?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return sendError(res, 404, "Course not found");
    }

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = course.user.toString() === user.id;
    if (!isAdmin && !isOwner) {
      return sendError(res, 403, "Forbidden: only admin or owner can delete");
    }

    const chapter = course.chapters[cIdx];
    if (!chapter) {
      return sendError(res, 404, "Chapter not found");
    }
    const lesson = chapter.lessons[lIdx];
    if (!lesson) {
      return sendError(res, 404, "Lesson not found");
    }
    const videos = Array.isArray(lesson.videos) ? lesson.videos : [];
    const video = videos[vIdx] as any;
    if (!video) {
      return sendError(res, 404, "Video not found");
    }

    const cloudinaryId = video.cloudinaryId as string | undefined;
    if (cloudinaryId) {
      try {
        await cloudinary.uploader.destroy(cloudinaryId, { resource_type: "video" });
      } catch (cloudErr) {
        console.error("Cloudinary deletion failed:", cloudErr);
        // Proceed even if Cloudinary deletion fails
      }
    }

    // Remove the video from the lesson
    lesson.videos.splice(vIdx, 1);
    course.markModified("chapters");
    recomputeCourseStats(course);
    await course.save();

    return sendSuccess(res, 200, "Lesson video deleted", {
      chapterIndex: cIdx,
      lessonIndex: lIdx,
      videoIndex: vIdx,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteLessonFromChapter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { courseId, chapterIndex, lessonIndex } = req.params as any;
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return sendError(res, 400, "Invalid course ID format.");
    }
    const cIdx = Number(chapterIndex);
    const lIdx = Number(lessonIndex);
    if (!Number.isInteger(cIdx) || cIdx < 0) {
      return sendError(res, 400, "Invalid chapterIndex");
    }
    if (!Number.isInteger(lIdx) || lIdx < 0) {
      return sendError(res, 400, "Invalid lessonIndex");
    }
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }
    const canEdit = await auth.api.userHasPermission({
      body: { permissions: { course: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canEdit?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }
    const course = await Course.findById(courseId);
    if (!course) {
      return sendError(res, 404, "Course not found");
    }
    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = course.user.toString() === user.id;
    if (!isAdmin && !isOwner) {
      return sendError(res, 403, "Forbidden: only admin or owner can delete");
    }
    const chapter = course.chapters[cIdx];
    if (!chapter) {
      return sendError(res, 404, "Chapter not found");
    }
    const lesson = chapter.lessons[lIdx];
    if (!lesson) {
      return sendError(res, 404, "Lesson not found");
    }
    const videos = Array.isArray(lesson.videos) ? lesson.videos : [];
    for (const v of videos as any[]) {
      const cloudinaryId = v?.cloudinaryId as string | undefined;
      if (cloudinaryId) {
        try {
          await cloudinary.uploader.destroy(cloudinaryId, { resource_type: "video" });
        } catch {}
      }
    }
    chapter.lessons.splice(lIdx, 1);
    course.markModified("chapters");
    recomputeCourseStats(course);
    await course.save();
    return sendSuccess(res, 200, "Lesson deleted", {
      chapterIndex: cIdx,
      lessonIndex: lIdx,
    });
  } catch (error) {
    next(error);
  }
};


// Update progress for a single lesson video (watch time and completion)
export const updateLessonProgress = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { courseId, chapterId } = req.params as {
      courseId: string;
      chapterId: string;
    };
    const { watchedSeconds } = req.body as { watchedSeconds: number };

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return sendError(res, 400, "Invalid course ID format.");
    }
    if (!mongoose.Types.ObjectId.isValid(chapterId)) {
      return sendError(res, 400, "Invalid chapter ID format.");
    }
    const lIdx = Number(0);
    if (!Number.isInteger(lIdx) || lIdx < 0) {
      return sendError(res, 400, "Invalid lessonIndex");
    }
    if (watchedSeconds !== undefined && (typeof watchedSeconds !== "number" || watchedSeconds < 0)) {
      return sendError(res, 400, "Invalid watchedSeconds");
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return sendError(res, 404, "Course not found");
    }
    const chapter = (Array.isArray(course.chapters) ? course.chapters : []).find(
      (ch: any) => String(ch?._id) === String(chapterId)
    );
    if (!chapter) {
      return sendError(res, 404, "Chapter not found");
    }
    const lesson = chapter.lessons?.[lIdx];
    if (!lesson) {
      return sendError(res, 404, "Lesson not found");
    }

    const duration = sumLessonDurationSeconds(lesson);
    let progress = await LessonVideoProgress.findOne({
      userId: user.id,
      courseId,
      chapterId,
      lessonIndex: lIdx,
    });

    if (!progress) {
      progress = new LessonVideoProgress({
        userId: user.id,
        courseId,
        chapterId,
        lessonIndex: lIdx,
        watchedSeconds: 0,
        completed: false,
      });
    }

    if (watchedSeconds !== undefined) {
      const cappedLessonWatched = duration > 0 ? Math.min(watchedSeconds, duration) : watchedSeconds;
      progress.watchedSeconds = Math.max(Number(progress.watchedSeconds) || 0, cappedLessonWatched);
    }

    await progress.save();

    const finalWatched = Number(progress.watchedSeconds) || 0;
    const percentWatched = duration > 0 ? Math.min((finalWatched / duration) * 100, 100) : 0;
    const completed = percentWatched >= 90 || (duration > 0 && finalWatched >= duration);

    if (progress.completed !== completed) {
      progress.completed = completed;
      await progress.save();
    }

    return sendSuccess(res, 200, "Lesson progress updated", {
      watchedSeconds: finalWatched,
      completed,
      percentWatched: Number(percentWatched.toFixed(2)),
      durationSeconds: duration,
    });
  } catch (error) {
    next(error);
  }
};


// Get a course with lesson and per-video progress for the current user
export const getCourseWithProgress = async (
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
      body: { permissions: { course: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const course = await Course.findById(id).select("chapters status user title createdBy").lean();
    if (!course) {
      return sendError(res, 404, "Course not found");
    }

    const role = (user as any).role;
    const isAdmin = Array.isArray(role)
      ? role.includes("admin")
      : role === "admin";
    const isOwner = String((course as any).user) === String((user as any).id);
    if (!isAdmin && !isOwner && (course as any).status !== "published") {
      return sendError(res, 403, "Forbidden: course not accessible");
    }

    const progressDocs = await LessonVideoProgress.find({
      userId: (user as any).id,
      courseId: id,
    }).lean();

    const progressMap = new Map<string, { watchedSeconds: number; completed: boolean; videoWatchedSeconds?: number[] }>();
    for (const p of progressDocs) {
      const key = `${String((p as any).chapterId)}:${Number((p as any).lessonIndex)}`;
      progressMap.set(key, {
        watchedSeconds: Number((p as any).watchedSeconds) || 0,
        completed: !!(p as any).completed,
        videoWatchedSeconds: Array.isArray((p as any).videoWatchedSeconds) ? (p as any).videoWatchedSeconds : [],
      });
    }

    // Fetch all quiz responses for this course/user and merge latest per questionIndex per chapter
    const quizResponseDocs = await QuizResponse.find({
      userId: (user as any).id,
      courseId: id,
    })
      .sort({ createdAt: -1 })
      .lean();

    // Map of chapterId -> Map<questionIndex, { selectedOptionIndexes, isCorrect }>
    const quizAnswersByChapter = new Map<string, Map<number, { selectedOptionIndexes: number[]; isCorrect?: boolean }>>();
    for (const resp of quizResponseDocs) {
      const chapId = String((resp as any).chapterId);
      let qMap = quizAnswersByChapter.get(chapId);
      if (!qMap) {
        qMap = new Map();
        quizAnswersByChapter.set(chapId, qMap);
      }
      const ansArr = Array.isArray((resp as any)?.answers) ? (resp as any).answers : [];
      for (const a of ansArr) {
        const qIdx = Number((a as any).questionIndex);
        if (!qMap.has(qIdx)) {
          qMap.set(qIdx, {
            selectedOptionIndexes: Array.isArray((a as any).selectedOptionIndexes)
              ? (a as any).selectedOptionIndexes
              : [],
            isCorrect: !!(a as any).isCorrect,
          });
        }
      }
    }

    const chapters = Array.isArray((course as any).chapters)
      ? (course as any).chapters
      : [];

    const chaptersOut = chapters.map((ch: any, cIdx: number) => {
      const lessons = Array.isArray(ch?.lessons) ? ch.lessons : [];
      const lessonsOut = lessons.map((ls: any, lIdx: number) => {
        const durationSeconds = sumLessonDurationSeconds(ls);
        const key = `${String(ch?._id)}:${lIdx}`;
        const p = progressMap.get(key);
        const watchedRaw = p?.watchedSeconds || 0;
        const watchedSeconds = durationSeconds > 0 ? Math.min(watchedRaw, durationSeconds) : watchedRaw;
        const percentWatched = durationSeconds > 0 ? Math.min((watchedSeconds / durationSeconds) * 100, 100) : 0;
        const completedDoc = p?.completed || false;
        const completed = completedDoc || percentWatched >= 90 || (durationSeconds > 0 && watchedSeconds >= durationSeconds);

        const videos = Array.isArray(ls?.videos) ? ls.videos : [];

        return {
          lessonIndex: lIdx,
          title: ls?.title,
          videos,
          durationSeconds,
          watchedSeconds,
          percentWatched: Number(percentWatched.toFixed(2)),
          completed,
        };
      });

      // Build quiz attempt details for the chapter (no score calculation)
      const quizObj = Array.isArray(ch?.quizzes) && ch.quizzes.length > 0 ? ch.quizzes[0] : null;
      let quizOut: any = null;
      if (quizObj) {
        const answersByQIdx = quizAnswersByChapter.get(String(ch?._id)) || new Map<number, { selectedOptionIndexes: number[]; isCorrect?: boolean }>();
        const attempted = answersByQIdx.size > 0;

        const questions = Array.isArray(quizObj?.questions) ? quizObj.questions : [];
        const totalQuestions = questions.length;
        const questionsOut = questions.map((q: any, qIdx: number) => {
          const userAns = answersByQIdx.get(qIdx);
          const isCorrect = !!userAns?.isCorrect;
          const base: any = {
            questionIndex: qIdx,
            type: q?.type,
            prompt: q?.prompt,
            options: Array.isArray(q?.options)
              ? q.options.map((o: any) => ({ text: o?.text }))
              : [],
            attempted: !!userAns,
            userSelectedOptionIndexes: userAns?.selectedOptionIndexes || [],
            isCorrect,
          };
          if (!isCorrect && userAns) {
            base.correctOptionIndexes = Array.isArray(q?.correctOptionIndexes)
              ? q.correctOptionIndexes
              : [];
          }
          return base;
        });

        const attemptedCount = answersByQIdx.size;
        const attemptedPercent = totalQuestions > 0
          ? Number(((attemptedCount / totalQuestions) * 100).toFixed(2))
          : 0;

        quizOut = {
          title: quizObj?.title,
          attempted,
          questions: questionsOut,
          attemptedCount,
          totalQuestions,
          attemptedPercent,
        };
      }
      // Aggregate lesson progress for the chapter
      const chapterDurationSeconds = lessonsOut.reduce(
        (sum: number, l: any) => sum + (Number(l?.durationSeconds) || 0),
        0
      );
      const chapterWatchedSeconds = lessonsOut.reduce(
        (sum: number, l: any) => sum + (Number(l?.watchedSeconds) || 0),
        0
      );
      const lessonsPercentWatchedRaw = chapterDurationSeconds > 0
        ? Math.min((chapterWatchedSeconds / chapterDurationSeconds) * 100, 100)
        : 0;
      const lessonsPercentWatched = Number(lessonsPercentWatchedRaw.toFixed(2));

      const quizAttemptedPercent = quizOut && typeof quizOut.attemptedPercent === "number"
        ? Number(quizOut.attemptedPercent)
        : 0;

      // Weight only present components:
      const hasLessons = chapterDurationSeconds > 0;
      const hasQuiz = !!quizOut && quizOut.totalQuestions > 0;

      let percentCompletedRaw: number;
      if (hasLessons && hasQuiz) {
        percentCompletedRaw = (lessonsPercentWatchedRaw + quizAttemptedPercent) / 2;
      } else if (hasLessons) {
        percentCompletedRaw = lessonsPercentWatchedRaw;
      } else if (hasQuiz) {
        percentCompletedRaw = quizAttemptedPercent;
      } else {
        percentCompletedRaw = 0;
      }

      const percentCompleted = Number(Math.min(percentCompletedRaw, 100).toFixed(2));

      return {
        chapterId: String(ch?._id),
        chapterIndex: cIdx,
        title: ch?.title,
        lessons: lessonsOut,
        quiz: quizOut,
        durationSeconds: chapterDurationSeconds,
        watchedSeconds: chapterWatchedSeconds,
        lessonsPercentWatched,
        quizAttemptedPercent,
        percentCompleted,
      };
    });

    return sendSuccess(res, 200, "Course with progress", {
      courseId: id,
      title: (course as any).title,
      createdBy: (course as any).createdBy || null,
      chapters: chaptersOut,
    });
  } catch (error) {
    next(error);
  }
};


// Get all courses created by current user (published)
export const getAllCoursesByUser = async (
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
      body: { permissions: { course: ["view"] } },
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

    const total = await Course.countDocuments(filter);
    const data = await Course.find(filter)
      .select(
        "title description thumbnailUrl tags status accessLevel visibility createdAt updatedAt user createdBy totalDurationSeconds totalQuizzes chapters"
      )
      .sort(sort)
      .skip(offset)
      .limit(limit)
      .lean();

    // Build per-course progress summary for the current user
    const courseIds = (data as any[]).map((c: any) => String((c as any)._id));
    const progressDocs = await LessonVideoProgress.find({
      userId: (user as any).id,
      courseId: { $in: courseIds },
    })
      .select("courseId watchedSeconds")
      .lean();

    const watchedByCourse = new Map<string, number>();
    for (const p of progressDocs) {
      const key = String((p as any).courseId);
      const cur = watchedByCourse.get(key) || 0;
      watchedByCourse.set(key, cur + (Number((p as any).watchedSeconds) || 0));
    }

    const savedDocs = await SavedCourse.find({
      userId: (user as any).id,
      courseId: { $in: courseIds },
    })
      .select("courseId")
      .lean();
    const savedSet = new Set<string>(savedDocs.map((d: any) => String((d as any).courseId)));

    const quizResponseDocs = await QuizResponse.find({
      userId: (user as any).id,
      courseId: { $in: courseIds },
    })
      .sort({ createdAt: -1 })
      .lean();

    const latestAnswersByCourseChapter = new Map<string, Map<string, Map<number, true>>>();
    for (const resp of quizResponseDocs) {
      const cId = String((resp as any).courseId);
      const chId = String((resp as any).chapterId);
      let chMapByCourse = latestAnswersByCourseChapter.get(cId);
      if (!chMapByCourse) {
        chMapByCourse = new Map();
        latestAnswersByCourseChapter.set(cId, chMapByCourse);
      }
      let qSet = chMapByCourse.get(chId);
      if (!qSet) {
        qSet = new Map<number, true>();
        chMapByCourse.set(chId, qSet);
      }
      const ansArr = Array.isArray((resp as any)?.answers) ? (resp as any).answers : [];
      for (const a of ansArr) {
        const qIdx = Number((a as any).questionIndex);
        if (!qSet.has(qIdx)) {
          qSet.set(qIdx, true);
        }
      }
    }

    const dataWithProgress = (data as any[]).map((c: any) => {
      const idStr = String((c as any)._id);
      const chapters = Array.isArray((c as any).chapters) ? (c as any).chapters : [];
      const lessonDurationSeconds = chapters.reduce((sum: number, ch: any) => {
        const lessons = Array.isArray(ch?.lessons) ? ch.lessons : [];
        return sum + lessons.reduce((lsSum: number, ls: any) => lsSum + sumLessonDurationSeconds(ls), 0);
      }, 0);
      const watchedRaw = watchedByCourse.get(idStr) || 0;
      const watchedSeconds = lessonDurationSeconds > 0 ? Math.min(watchedRaw, lessonDurationSeconds) : watchedRaw;
      const lessonsPercentWatchedRaw = lessonDurationSeconds > 0
        ? Math.min((watchedSeconds / lessonDurationSeconds) * 100, 100)
        : 0;

      let totalQuestions = 0;
      let attemptedQuestions = 0;
      for (const ch of chapters) {
        const quizObj = Array.isArray(ch?.quizzes) && ch.quizzes.length > 0 ? ch.quizzes[0] : null;
        const questions = Array.isArray(quizObj?.questions) ? quizObj.questions : [];
        totalQuestions += questions.length;
        const chMapByCourse = latestAnswersByCourseChapter.get(idStr);
        const qSet = chMapByCourse ? chMapByCourse.get(String(ch?._id)) : undefined;
        attemptedQuestions += qSet ? qSet.size : 0;
      }
      const quizAttemptedPercent = totalQuestions > 0
        ? Number(((attemptedQuestions / totalQuestions) * 100).toFixed(2))
        : 0;

      const hasLessons = lessonDurationSeconds > 0;
      const hasQuiz = totalQuestions > 0;
      let percentCompletedRaw: number;
      if (hasLessons && hasQuiz) {
        percentCompletedRaw = (lessonsPercentWatchedRaw + quizAttemptedPercent) / 2;
      } else if (hasLessons) {
        percentCompletedRaw = lessonsPercentWatchedRaw;
      } else if (hasQuiz) {
        percentCompletedRaw = quizAttemptedPercent;
      } else {
        percentCompletedRaw = 0;
      }
      const percentRaw = Math.min(percentCompletedRaw, 100);
      const completed = percentRaw >= 90;
      const percentCompleted = completed ? 100 : Number(percentRaw.toFixed(2));
      return {
        _id: idStr,
        title: (c as any).title,
        description: (c as any).description || "",
        tags: Array.isArray((c as any).tags) ? (c as any).tags : [],
        status: (c as any).status,
        accessLevel: (c as any).accessLevel || null,
        user: String((c as any).user || ""),
        createdBy: (c as any).createdBy || null,
        thumbnailUrl: (c as any).thumbnailUrl || "",
        totalDurationSeconds: Number((c as any).totalDurationSeconds) || 0,
        createdAt: (c as any).createdAt || null,
        updatedAt: (c as any).updatedAt || null,
        saved: savedSet.has(idStr),
        progressSummary: {
          percentCompleted,
          completed,
        },
      };
    });

    const hasNext = offset + data.length < total;

    return sendSuccess(res, 200, "Published courses fetched", dataWithProgress, {
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

// Get all published courses that the current user has completed
export const getCompletedCoursesByUser = async (
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
      body: { permissions: { course: ["view"] } },
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

    const tagsQuery =
      (req.query.tags as string | string[]) ||
      (req.query.tag as string) ||
      undefined;
    const q = (req.query.q as string) || undefined;

    const filter: any = { status: "published" };

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

    // Fetch all matching published courses, then paginate completed ones
    const allData = await Course.find(filter)
      .select(
        "title description thumbnailUrl tags status accessLevel createdAt updatedAt user createdBy totalDurationSeconds totalQuizzes"
      )
      .sort(sort)
      .lean();

    const courseIds = (allData as any[]).map((c: any) => String((c as any)._id));
    const progressDocs = await LessonVideoProgress.find({
      userId: (user as any).id,
      courseId: { $in: courseIds },
    })
      .select("courseId watchedSeconds")
      .lean();

    const watchedByCourse = new Map<string, number>();
    for (const p of progressDocs) {
      const key = String((p as any).courseId);
      const cur = watchedByCourse.get(key) || 0;
      watchedByCourse.set(key, cur + (Number((p as any).watchedSeconds) || 0));
    }

    const withProgress = (allData as any[]).map((c: any) => {
      const idStr = String((c as any)._id);
      const totalDurationSeconds = Number((c as any).totalDurationSeconds) || 0;
      const totalQuizzes = Number((c as any).totalQuizzes) || 0;
      const videoDurationSeconds = Math.max(totalDurationSeconds - totalQuizzes * 30, 0);
      const watchedRaw = watchedByCourse.get(idStr) || 0;
      const watchedSeconds = videoDurationSeconds > 0 ? Math.min(watchedRaw, videoDurationSeconds) : watchedRaw;
      const percentRaw = videoDurationSeconds > 0
        ? Math.min((watchedSeconds / videoDurationSeconds) * 100, 100)
        : 0;
      const completed = percentRaw >= 90 || (videoDurationSeconds > 0 && watchedSeconds >= videoDurationSeconds);
      const percentWatched = completed ? 100 : Number(percentRaw.toFixed(2));
      return {
        ...c,
        progressSummary: {
          watchedSeconds,
          percentWatched,
          completed,
          durationSeconds: videoDurationSeconds,
        },
      };
    });

    const completedOnly = withProgress.filter((c: any) => c?.progressSummary?.completed);
    const totalCompleted = completedOnly.length;
    const paged = completedOnly.slice(offset, offset + limit);
    const hasNext = offset + paged.length < totalCompleted;

    return sendSuccess(res, 200, "Completed courses fetched", paged, {
      page,
      offset,
      limit,
      total: totalCompleted,
      hasNext,
    });
  } catch (error) {
    next(error);
  }
};

// Save/Bookmark a course for the current user
export const saveCourseForUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid course ID format.");
    }

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canView = await auth.api.userHasPermission({
      body: { permissions: { course: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const course = await Course.findById(id).select("status user");
    if (!course) return sendError(res, 404, "Course not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = String((course as any).user) === String((user as any).id);
    if (!isAdmin && !isOwner && (course as any).status !== "published") {
      return sendError(res, 403, "Forbidden: course not accessible");
    }

    const saveParam = (req.body as any)?.save;
    if (typeof saveParam !== "boolean") {
      return sendError(res, 400, "Invalid request: 'save' boolean is required");
    }

    const existing = await SavedCourse.findOne({ userId: (user as any).id, courseId: String(id) }).lean();

    if (saveParam === true) {
      if (existing) {
        return sendSuccess(res, 200, "Course already saved", { courseId: String(id), saved: true, _id: (existing as any)?._id });
      }
      const created = await SavedCourse.create({ userId: (user as any).id, courseId: String(id) });
      return sendSuccess(res, 200, "Course saved", { courseId: String(id), saved: true, _id: (created as any)._id });
    } else {
      if (!existing) {
        return sendSuccess(res, 200, "Course already unsaved", { courseId: String(id), saved: false });
      }
      await SavedCourse.deleteOne({ userId: (user as any).id, courseId: String(id) });
      return sendSuccess(res, 200, "Course unsaved", { courseId: String(id), saved: false });
    }
  } catch (error) {
    next(error);
  }
};

// Get all saved/bookmarked courses for the current user
export const getSavedCoursesByUser = async (
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
      body: { permissions: { course: ["view"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canView?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 10;
    const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
    const offset = (page - 1) * limit;

    const savedDocs = await SavedCourse.find({ userId: (user as any).id })
      .sort({ createdAt: -1 })
      .lean();

    const courseIds = savedDocs.map((d: any) => String(d.courseId));
    if (courseIds.length === 0) {
      return sendSuccess(res, 200, "Saved courses fetched", [], {
        page,
        offset,
        limit,
        total: 0,
        hasNext: false,
      });
    }

    const allCourses = await Course.find({ _id: { $in: courseIds } })
      .select(
        "title description thumbnailUrl tags status accessLevel createdAt updatedAt user createdBy totalDurationSeconds totalQuizzes"
      )
      .lean();

    // Preserve the saved order (latest first)
    const orderMap = new Map(courseIds.map((id, idx) => [id, idx]));
    const ordered = allCourses
      .slice()
      .sort((a: any, b: any) => (orderMap.get(String(a._id)) || 0) - (orderMap.get(String(b._id)) || 0));

    // Add progressSummary for consistency with other course listing endpoints
    const progressDocs = await LessonVideoProgress.find({
      userId: (user as any).id,
      courseId: { $in: courseIds },
    })
      .select("courseId watchedSeconds")
      .lean();

    const watchedByCourse = new Map<string, number>();
    for (const p of progressDocs) {
      const key = String((p as any).courseId);
      const cur = watchedByCourse.get(key) || 0;
      watchedByCourse.set(key, cur + (Number((p as any).watchedSeconds) || 0));
    }

    const orderedWithProgress = (ordered as any[]).map((c: any) => {
      const idStr = String((c as any)._id);
      const totalDurationSeconds = Number((c as any).totalDurationSeconds) || 0;
      const totalQuizzes = Number((c as any).totalQuizzes) || 0;
      const videoDurationSeconds = Math.max(totalDurationSeconds - totalQuizzes * 30, 0);
      const watchedRaw = watchedByCourse.get(idStr) || 0;
      const watchedSeconds = videoDurationSeconds > 0 ? Math.min(watchedRaw, videoDurationSeconds) : watchedRaw;
      const percentWatched = videoDurationSeconds > 0
        ? Math.min((watchedSeconds / videoDurationSeconds) * 100, 100)
        : 0;
      const completed = percentWatched >= 90 || (videoDurationSeconds > 0 && watchedSeconds >= videoDurationSeconds);
      return {
        ...c,
        progressSummary: {
          watchedSeconds,
          percentWatched: Number(percentWatched.toFixed(2)),
          completed,
          durationSeconds: videoDurationSeconds,
        },
      };
    });

    const total = orderedWithProgress.length;
    const data = orderedWithProgress.slice(offset, offset + limit);
    const hasNext = offset + data.length < total;

    return sendSuccess(res, 200, "Saved courses fetched", data, {
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

 //Change status of the course video (only Admin can change)
export const changeCourseStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params as { id: string };
    const { status, rejectReason } = req.body as {
      status: "draft" | "pending" | "published" | "rejected";
      rejectReason?: string;
    };

    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) {
      return sendError(res, 401, "Unauthorized");
    }
    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isTrainer = Array.isArray(role) ? role.includes("trainer") : role === "trainer";
    const isTrainee = Array.isArray(role) ? role.includes("trainee") : role === "trainee";
    const isUserRole = Array.isArray(role) ? role.includes("user") : role === "user";

    const allowedStatuses = [
      "draft",
      "pending",
      "published",
      "rejected",
    ] as const;
    if (!allowedStatuses.includes(status as any)) {
      return sendError(res, 400, "Invalid status");
    }

    const allowedForRole = isAdmin
      ? new Set(["draft", "pending", "published", "rejected"])
      : (isTrainer || isTrainee)
      ? new Set(["draft", "pending"])
      : new Set<string>();
    if (!allowedForRole.has(status)) {
      return sendError(res, 403, "Forbidden: your role cannot set the requested status");
    }
    if (status === "rejected") {
      const reason = (rejectReason ?? "").trim();
      if (!reason) {
        return sendError(res, 400, "rejectReason is required when status is 'rejected'");
      }
    }

    const update: any = { status };
    if (status === "rejected") {
      update.rejectReason = (rejectReason ?? "").trim();
    } else {
      update.rejectReason = "";
    }

    const updated = await Course.findByIdAndUpdate(id, update, { returnDocument: 'after' });
    if (!updated) {
      return sendError(res, 404, "Course not found");
    }
    try {
      const ownerId = String((updated as any).user || "");
      if (ownerId && ownerId !== String((user as any).id)) {
        const tokenDoc = await DeviceToken.findOne({ userId: ownerId }).lean();
        if (tokenDoc?.deviceToken) {
          const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
          const title = "Course status updated";
          const courseTitle = String((updated as any).title || "Untitled");
          const body =
            update.status === "rejected"
              ? (update.rejectReason && update.rejectReason.trim().length > 0
                  ? `Your "${courseTitle}" was declined. Please review the feedback: ${update.rejectReason}`
                  : `Your "${courseTitle}" was declined. Please review the feedback.`)
              : (update.status === "published"
                  ? `Your "${courseTitle}" has been approved.`
                  : `Your "${courseTitle}" is now ${update.status}.`);
          if (isExpo) {
            const expoMessage = {
              to: tokenDoc.deviceToken,
              sound: "default",
              title,
              body,
            };
            await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify(expoMessage),
            });
          } else {
            const fcmMessage = {
              token: tokenDoc.deviceToken,
              notification: { title, body },
              data: {
                _id: String((updated as any)._id),
                status: String(update.status),
                event:
                  update.status === "published"
                    ? "course-published"
                    : update.status === "rejected"
                    ? "course-rejected"
                    : "course-status-updated",
              },
            } as any;
            await admin.messaging().send(fcmMessage);
          }
          try {
            await Notification.create({
              userId: ownerId,
              title,
              body,
              data: {
                _id: String((updated as any)._id),
                status: String(update.status),
                event:
                  update.status === "published"
                    ? "course-published"
                    : update.status === "rejected"
                    ? "course-rejected"
                    : "course-status-updated",
              },
              read: false,
            });
          } catch {}
        }
      }
    } catch (e) {
      console.error("Error sending notification:", e);
    }
    return sendSuccess(res, 200, "Course status updated", updated);
  } catch (error) {
    next(error);
  }
};

// Delete cloudinary video
export const deleteCloudinaryVideo = async (
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

    // Only admins or trainers can delete videos
    const role = (user as any).role;
    const isAllowed =
      Array.isArray(role)
        ? role.includes("admin") || role.includes("trainer")
        : role === "admin" || role === "trainer";

    if (!isAllowed) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const { publicId, resourceType } = req.body;
    if (!publicId) {
      return sendError(res, 400, "publicId is required");
    }

    // Default to 'video' if not specified
    const type = resourceType || "video";

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: type,
    });

    if (result.result !== "ok") {
      return sendError(res, 500, "Failed to delete from Cloudinary", result);
    }

    return sendSuccess(res, 200, "Video deleted successfully", result);
  } catch (error) {
    next(error);
  }
};

// Delete course thumbnail
export const deleteCourseThumbnail = async (
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
    if (!user) return sendError(res, 401, "Unauthorized");

    const course = await Course.findById(id);
    if (!course) return sendError(res, 404, "Course not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = course.user.toString() === user.id;

    if (!isAdmin && !isOwner) {
      return sendError(res, 403, "Forbidden: only admin or owner can delete thumbnail");
    }

    if (course.thumbnailCloudinaryId) {
      await cloudinary.uploader.destroy(course.thumbnailCloudinaryId).catch(() => {});
    }

    course.thumbnailUrl = "";
    course.thumbnailCloudinaryId = "";
    await course.save();

    return sendSuccess(res, 200, "Thumbnail deleted", course);
  } catch (error) {
    next(error);
  }
};

