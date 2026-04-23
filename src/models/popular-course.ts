import { Schema, model, Document, Types } from "mongoose";

export type PopularWindow = "all";

export interface ICoursePopularity extends Document {
  courseId: Types.ObjectId;
  window: PopularWindow;
  score: number;
  savedCount: number;
  uniqueWatchers: number;
  totalWatchedSeconds: number;
  completionCount: number;
  computedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CoursePopularitySchema = new Schema<ICoursePopularity>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    window: { type: String, enum: ["all"], required: true, index: true },
    score: { type: Number, required: true, default: 0 },
    savedCount: { type: Number, required: true, default: 0 },
    uniqueWatchers: { type: Number, required: true, default: 0 },
    totalWatchedSeconds: { type: Number, required: true, default: 0 },
    completionCount: { type: Number, required: true, default: 0 },
    computedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true }
);

// Ensure one doc per course+window
CoursePopularitySchema.index({ courseId: 1, window: 1 }, { unique: true });
// Fast sorting by score
CoursePopularitySchema.index({ window: 1, score: -1, computedAt: -1 });

export const CoursePopularity = model<ICoursePopularity>(
  "CoursePopularity",
  CoursePopularitySchema,
  "course-popularity"
);