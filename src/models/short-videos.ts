import mongoose, { Schema, Document } from "mongoose";

interface ISubtitleTrack {
  lang: string;
  label: string;
  url: string;
  format: "vtt" | "srt";
  default?: boolean;
}

interface IShortVideo extends Document {
  title: string;
  description: string;
  tags: string[];
  status: "draft" | "pending" | "published" | "rejected";
  rejectReason?: string;
  user: mongoose.Types.ObjectId;
  createdBy?: {
    _id: mongoose.Types.ObjectId;
    name: string;
    email: string;
  };
  cloudinaryUrl: string;
  cloudinaryId: string;
  thumbnailUrl: string;
  accessLevel: "free" | "develop" | "master";
  visibility: "clinicians" | "users" | "all";
  durationSeconds: number;
  subtitles?: ISubtitleTrack[];
  /* ── subtitle-pipeline fields ── */
  subtitle_status: "pending" | "processing" | "completed" | "failed";
  subtitle_failure_reason?: string | null;
  subtitle_retry_count: number;
  last_subtitle_attempt?: Date | null;
  retryable: boolean;
  /** Earliest time the worker may pick this job up.
   *  Set to now+2min on upload, now on manual retry. */
  not_before: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CreatedBySchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, default: "" },
    email: { type: String, default: "" },
  },
  { _id: false }
);

const SubtitleTrackSchema = new Schema(
  {
    lang: { type: String, default: "en" },
    label: { type: String, default: "" },
    url: { type: String, default: "" },
    format: { type: String, enum: ["vtt", "srt"], default: "vtt" },
    default: { type: Boolean, default: false },
  },
  { _id: false }
);

const ShortVideoSchema = new Schema<IShortVideo>(
  {
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    tags: [{ type: String, default: [] }],
    status: {
      type: String,
      enum: ["draft", "pending", "published", "rejected"],
      default: "draft",
    },
    rejectReason: { type: String, default: "" },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdBy: { type: CreatedBySchema, required: false },
    cloudinaryUrl: { type: String, default: "" },
    cloudinaryId: { type: String, default: "" },
    thumbnailUrl: { type: String, default: "" },
    accessLevel: {
      type: String,
      enum: ["free", "develop", "master"],
      default: "free",
    },
    visibility: {
      type: String,
      enum: ["clinicians", "users", "all"],
      default: "users",
    },
    durationSeconds: { type: Number, default: 0 },
    subtitles: { type: [SubtitleTrackSchema], default: [] },

    /* ── subtitle-pipeline fields ── */
    subtitle_status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
    },
    subtitle_failure_reason: { type: String, default: null },
    subtitle_retry_count: { type: Number, default: 0 },
    last_subtitle_attempt: { type: Date, default: null },
    retryable: { type: Boolean, default: false },
    // Default to now so existing records without this field are immediately eligible
    not_before: { type: Date, default: () => new Date(), index: true },
  },
  {
    timestamps: true,
  }
);

export const ShortVideo = mongoose.model<IShortVideo>(
  "ShortVideo",
  ShortVideoSchema,
  "short-videos"
);
