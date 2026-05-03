import { Schema, model, Document, Types } from "mongoose";

export type CourseAssignerRole = "trainer" | "admin";

export interface ICourseAssignment extends Document {
  courseId: Types.ObjectId;
  assignedToId: string;
  profileId: string;
  assignedById: string;
  assignedByRole: CourseAssignerRole;
  assignedByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CourseAssignmentSchema = new Schema<ICourseAssignment>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    assignedToId: { type: String, required: true, index: true },
    profileId: { type: String, default: "" },
    assignedById: { type: String, required: true, index: true },
    assignedByRole: { type: String, enum: ["trainer", "admin"], required: true },
    assignedByName: { type: String, default: "" },
  },
  { timestamps: true }
);

// profileId="" for trainee targets; real profileId for user-role targets
CourseAssignmentSchema.index(
  { assignedToId: 1, courseId: 1, assignedByRole: 1, profileId: 1 },
  { unique: true }
);
// Listing assignments for a user account, optionally scoped to profile
CourseAssignmentSchema.index({ assignedToId: 1, profileId: 1, createdAt: -1 });
// Listing assignments made by a specific assigner
CourseAssignmentSchema.index({ assignedById: 1, assignedByRole: 1, createdAt: -1 });

export const CourseAssignment = model<ICourseAssignment>(
  "CourseAssignment",
  CourseAssignmentSchema,
  "course-assignments"
);
