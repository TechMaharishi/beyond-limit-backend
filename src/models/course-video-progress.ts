import { Schema, model, Document, Types } from "mongoose";

export interface ICourseVideoProgress extends Document {
  userId: Types.ObjectId;
  courseId: Types.ObjectId;
  watchedSeconds: number;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CourseVideoProgressSchema = new Schema<ICourseVideoProgress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    watchedSeconds: { type: Number, required: true, default: 0, min: 0 },
    completed: { type: Boolean, required: true, default: false },
  },
  { timestamps: true }
);

CourseVideoProgressSchema.index({ userId: 1, courseId: 1 }, { unique: true });

export const CourseVideoProgress = model<ICourseVideoProgress>(
  "CourseVideoProgress",
  CourseVideoProgressSchema,
  "course-video-progress"
);