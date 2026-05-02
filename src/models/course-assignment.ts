import { Schema, model, Document, Types } from "mongoose";

export type AssignerRole = "trainer" | "trainee" | "admin";

export interface ICourseAssignment extends Document {
  courseId: Types.ObjectId;
  assignedToId: string;
  assignedById: string;
  assignedByRole: AssignerRole;
  assignedByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CourseAssignmentSchema = new Schema<ICourseAssignment>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    assignedToId: { type: String, required: true, index: true },
    assignedById: { type: String, required: true, index: true },
    assignedByRole: { type: String, enum: ["trainer", "trainee", "admin"], required: true },
    assignedByName: { type: String, default: "" },
  },
  { timestamps: true }
);


CourseAssignmentSchema.index({ assignedToId: 1, courseId: 1, assignedByRole: 1 }, { unique: true });
CourseAssignmentSchema.index({ assignedById: 1, assignedByRole: 1 });

export const CourseAssignment = model<ICourseAssignment>(
  "CourseAssignment",
  CourseAssignmentSchema,
  "course-assignments"
);