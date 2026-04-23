import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * CourseSubtitleJob — Queue collection for course video subtitle generation.
 *
 * Each document represents a single video (identified by its cloudinaryId)
 * nested inside a Course that needs subtitle transcription.
 *
 * The worker polls this collection for "pending" jobs, and the webhook
 * updates both the job and the embedded video's subtitles[] array.
 */
export interface ICourseSubtitleJob extends Document {
  courseId: Types.ObjectId;
  cloudinaryId: string;
  subtitle_status: "pending" | "processing" | "completed" | "failed";
  subtitle_failure_reason?: string | null;
  subtitle_retry_count: number;
  last_subtitle_attempt?: Date | null;
  retryable: boolean;
  /** Earliest time this job may be picked up by the worker.
   *  On first upload: set to now + 2 min so Cloudinary has time to process.
   *  On manual retry: set to now (immediate). */
  not_before: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CourseSubtitleJobSchema = new Schema<ICourseSubtitleJob>(
  {
    courseId: {
      type: Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    cloudinaryId: {
      type: String,
      required: true,
      index: true,
    },
    subtitle_status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    subtitle_failure_reason: { type: String, default: null },
    subtitle_retry_count: { type: Number, default: 0 },
    last_subtitle_attempt: { type: Date, default: null },
    retryable: { type: Boolean, default: false },
    not_before: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true }
);

// Compound index to prevent duplicate jobs for the same video
CourseSubtitleJobSchema.index(
  { courseId: 1, cloudinaryId: 1 },
  { unique: true }
);

export const CourseSubtitleJob = mongoose.model<ICourseSubtitleJob>(
  "CourseSubtitleJob",
  CourseSubtitleJobSchema,
  "course-subtitle-jobs"
);
