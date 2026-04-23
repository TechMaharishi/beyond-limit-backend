import { Schema, model, Document } from "mongoose";

export interface ISavedCourse extends Document {
  userId: string;
  courseId: string;
  createdAt: Date;
  updatedAt: Date;
}

const SavedCourseSchema = new Schema<ISavedCourse>(
  {
    userId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
  },
  { timestamps: true }
);

SavedCourseSchema.index({ userId: 1, courseId: 1 }, { unique: true });

export const SavedCourse = model<ISavedCourse>(
  "SavedCourse",
  SavedCourseSchema,
  "saved-courses"
);