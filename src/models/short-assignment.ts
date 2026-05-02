import { Schema, model, Document, Types } from "mongoose";

export type ShortAssignerRole = "trainer" | "trainee" | "admin";

export interface IShortAssignment extends Document {
  shortVideoId: Types.ObjectId;
  // For non-user roles (trainee/trainer): stores the user account ID.
  // For user role: stores the user account ID; profileId stores the active profile.
  assignedToId: string;
  // Set when assigning to a role="user" account — identifies which profile the assignment belongs to.
  profileId: string;
  assignedById: string;
  assignedByRole: ShortAssignerRole;
  assignedByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ShortAssignmentSchema = new Schema<IShortAssignment>(
  {
    shortVideoId: {
      type: Schema.Types.ObjectId,
      ref: "ShortVideo",
      required: true,
      index: true,
    },
    assignedToId: { type: String, required: true, index: true },
    profileId: { type: String, default: "" },
    assignedById: { type: String, required: true, index: true },
    assignedByRole: {
      type: String,
      enum: ["trainer", "trainee", "admin"],
      required: true,
    },
    assignedByName: { type: String, default: "" },
  },
  { timestamps: true }
);

// profileId="" for non-user-role targets; included in uniqueness so each profile gets its own assignment set
ShortAssignmentSchema.index(
  { assignedToId: 1, shortVideoId: 1, assignedByRole: 1, profileId: 1 },
  { unique: true }
);
// Listing assignments for a user account, optionally scoped to a profile
ShortAssignmentSchema.index({ assignedToId: 1, profileId: 1, createdAt: -1 });
// Listing assignments made by a specific assigner
ShortAssignmentSchema.index({ assignedById: 1, assignedByRole: 1, createdAt: -1 });

export const ShortAssignment = model<IShortAssignment>(
  "ShortAssignment",
  ShortAssignmentSchema,
  "short-assignments"
);

