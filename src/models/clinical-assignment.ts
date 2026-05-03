import { Schema, model, Document } from "mongoose";

export interface IClinicalAssignment extends Document {
  userId: string;
  clinicians: Array<{
    clinicianId: string;
    clinicianRole: "trainee" | "trainer";
    clinicianEmail?: string;
    clinicianName?: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const ClinicianSubSchema = new Schema(
  {
    clinicianId: { type: String, required: true },
    clinicianRole: { type: String, enum: ["trainee", "trainer"], required: true },
    clinicianEmail: { type: String, default: "" },
    clinicianName: { type: String, default: "" },
  },
  { _id: false }
);

const ClinicalAssignmentSchema = new Schema<IClinicalAssignment>(
  {
    userId: { type: String, required: true, index: true, unique: true },
    clinicians: {
      type: [ClinicianSubSchema],
      default: [],
      validate: {
        validator: function (arr: any[]) {
          return Array.isArray(arr) && arr.length <= 5;
        },
        message: "Maximum clinicians reached",
      },
    },
  },
  { timestamps: true }
);

// Supports $elemMatch queries on the clinicians array (getUsersAssignedToTrainee)
ClinicalAssignmentSchema.index({ "clinicians.clinicianId": 1 });
ClinicalAssignmentSchema.index({ "clinicians.clinicianRole": 1 });

export const ClinicalAssignment = model<IClinicalAssignment>(
  "ClinicalAssignment",
  ClinicalAssignmentSchema,
  "clinical-assignments"
);
