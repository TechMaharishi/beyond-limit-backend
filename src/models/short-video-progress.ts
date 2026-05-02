import { Schema, model, Document, Types } from "mongoose";

export interface IShortVideoProgress extends Document {
  // For Admin / Trainer / Trainee: stores the user account ID.
  // For User role: stores the active profile ID (each profile tracks independently).
  trackingId: string;
  shortVideoId: Types.ObjectId;
  watchedSeconds: number;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ShortVideoProgressSchema = new Schema<IShortVideoProgress>(
  {
    trackingId: { type: String, required: true },
    shortVideoId: { type: Schema.Types.ObjectId, ref: "ShortVideo", required: true },
    watchedSeconds: { type: Number, required: true, default: 0, min: 0 },
    completed: { type: Boolean, required: true, default: false },
  },
  { timestamps: true }
);

ShortVideoProgressSchema.index({ trackingId: 1, shortVideoId: 1 }, { unique: true });

export const ShortVideoProgress = model<IShortVideoProgress>(
  "ShortVideoProgress",
  ShortVideoProgressSchema,
  "short-video-progress"
);
