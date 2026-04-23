import { Schema, model, Document, Types } from "mongoose";

export type ShortAssignerRole = "trainer" | "trainee" | "admin";

export interface IShortAssignment extends Document {
  shortVideoId: Types.ObjectId;
  assignedToId: string;
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

ShortAssignmentSchema.index(
  { assignedToId: 1, shortVideoId: 1, assignedByRole: 1 },
  { unique: true }
);
ShortAssignmentSchema.index({ assignedById: 1, assignedByRole: 1 });

export const ShortAssignment = model<IShortAssignment>(
  "ShortAssignment",
  ShortAssignmentSchema,
  "short-assignments"
);

