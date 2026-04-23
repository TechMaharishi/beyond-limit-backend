import { Schema, model, Document, Types } from "mongoose";

export interface ILessonVideoProgress extends Document {
  userId: Types.ObjectId;
  courseId: Types.ObjectId;
  chapterId: Types.ObjectId;
  lessonIndex: number;
  watchedSeconds: number;
  videoWatchedSeconds: number[];
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const LessonVideoProgressSchema = new Schema<ILessonVideoProgress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    chapterId: { type: Schema.Types.ObjectId, required: true },
    lessonIndex: { type: Number, required: true, min: 0 },
    watchedSeconds: { type: Number, required: true, default: 0, min: 0 },
    videoWatchedSeconds: { type: [Number], default: [] },
    completed: { type: Boolean, required: true, default: false },
  },
  { timestamps: true }
);

LessonVideoProgressSchema.index(
  { userId: 1, courseId: 1, chapterId: 1, lessonIndex: 1 },
  { unique: true }
);

export const LessonVideoProgress = model<ILessonVideoProgress>(
  "LessonVideoProgress",
  LessonVideoProgressSchema,
  "lesson-video-progress"
);