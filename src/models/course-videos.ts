import mongoose, { Schema, Document, Types } from "mongoose";

// Resources associated with a course (files, docs, etc.)
export interface ICourseResource {
  name: string;
  url: string;
  cloudinaryId?: string;
  mimeType?: string;
  sizeBytes?: number;
}

const CourseResourceSchema = new Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    cloudinaryId: { type: String },
    mimeType: { type: String },
    sizeBytes: { type: Number, min: 0 },
  },
  { _id: false }
);

// Lesson video item (embedded)
export interface ILessonVideo {
  cloudinaryUrl: string;
  cloudinaryId: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
  subtitles?: {
    lang: string;
    label: string;
    url: string;
    format: "vtt" | "srt";
    default?: boolean;
  }[];
  /* ── subtitle-pipeline fields ── */
  subtitle_status?: "pending" | "processing" | "completed" | "failed";
  subtitle_failure_reason?: string | null;
  subtitle_retry_count?: number;
  last_subtitle_attempt?: Date | null;
  retryable?: boolean;
}

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

const LessonVideoSchema = new Schema(
  {
    cloudinaryUrl: { type: String, required: true },
    cloudinaryId: { type: String, required: true },
    durationSeconds: { type: Number, default: 0, min: 0 },
    thumbnailUrl: { type: String },
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
  },
  { _id: false }
);

// Quiz structures
export interface IQuizOption {
  text: string;
}

const QuizOptionSchema = new Schema(
  {
    text: { type: String, required: true },
  },
  { _id: false }
);

export interface IQuizQuestion {
  type: "single" | "multiple";
  prompt: string;
  options: IQuizOption[];
  correctOptionIndexes: number[];
}

const QuizQuestionSchema: Schema = new Schema(
  {
    type: { type: String, enum: ["single", "multiple"], required: true },
    prompt: { type: String, required: true },
    options: { type: [QuizOptionSchema], required: true, default: [] },
    correctOptionIndexes: {
      type: [Number],
      required: true,
      default: [],
      validate: {
        validator(this: any, v: number[]) {
          if (!Array.isArray(v)) return false;
          const unique = new Set(v);
          if (unique.size !== v.length) return false;
          const optionsLen = Array.isArray(this.options)
            ? this.options.length
            : 0;
          if (optionsLen === 0) return false;
          if (
            !v.every((i) => Number.isInteger(i) && i >= 0 && i < optionsLen)
          ) {
            return false;
          }
          if (this.type === "single") return v.length === 1;
          if (this.type === "multiple") return v.length >= 1;
          return false;
        },
        message:
          "correctOptionIndexes must be valid indexes, unique, and match question type",
      },
    },
  },
  { _id: false } as const
);

export interface IQuiz {
  title: string;
  questions: IQuizQuestion[];
}

const QuizSchema: Schema = new Schema(
  {
    title: { type: String, required: true },
    questions: { type: [QuizQuestionSchema], required: true, default: [] },
  },
  { _id: false }
);

// Lesson
export interface ILesson {
  title: string;
  description?: string;
  videos: ILessonVideo[];
}

const LessonSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    videos: { type: [LessonVideoSchema], default: [] },
  },
  { _id: false }
);

// Chapter
export interface IChapter {
  _id?: Types.ObjectId;
  title: string;
  lessons: ILesson[];
  quizzes: IQuiz[];
}

const ChapterSchema = new Schema(
  {
    title: { type: String, required: true },
    lessons: { type: [LessonSchema], default: [] },
    quizzes: { type: [QuizSchema], default: [] },
  },
  { _id: true }
);

// Course model
export interface ICourse extends Document {
  title: string;
  description: string;
  tags: string[];
  status: "draft" | "pending" | "published" | "rejected";
  rejectReason: string;
  accessLevel: "free" | "develop" | "master";
  visibility: "clinicians" | "users" | "all";
  user: Types.ObjectId;
  thumbnailUrl?: string;
  thumbnailCloudinaryId?: string;
  chapters: IChapter[];
  resources: ICourseResource[];
  totalDurationSeconds: number;
  totalQuizzes: number;
  totalChapters: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: {
    _id: Types.ObjectId;
    name: string;
    email: string;
  };
}

const CreatedBySchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, default: "" },
    email: { type: String, default: "" },
  },
  { _id: false }
);

const CourseSchema = new Schema<ICourse>(
  {
    title: { type: String, default: "" },
    description: { type: String, default: "" },
    tags: [{ type: String }],
    status: {
      type: String,
      enum: ["draft", "pending", "published", "rejected"],
      default: "draft",
    },
    rejectReason: { type: String, default: "" },
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
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdBy: { type: CreatedBySchema, required: false },
    thumbnailUrl: { type: String, default: "" },
    thumbnailCloudinaryId: { type: String, default: "" },
    chapters: { type: [ChapterSchema], default: [] },
    resources: { type: [CourseResourceSchema], default: [] },
    totalDurationSeconds: { type: Number, default: 0, min: 0 },
    totalQuizzes: { type: Number, default: 0, min: 0 },
    totalChapters: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

export const Course = mongoose.model<ICourse>(
  "Course",
  CourseSchema,
  "courses"
);
