import { Schema, model, Document, Types } from "mongoose";

export interface IShortVideoProgress extends Document {
  userId: Types.ObjectId;
  shortVideoId: Types.ObjectId;
  watchedSeconds: number;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ShortVideoProgressSchema = new Schema<IShortVideoProgress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    shortVideoId: { type: Schema.Types.ObjectId, ref: "ShortVideo", required: true },
    watchedSeconds: { type: Number, required: true, default: 0, min: 0 },
    completed: { type: Boolean, required: true, default: false },
  },
  { timestamps: true }
);

ShortVideoProgressSchema.index({ userId: 1, shortVideoId: 1 }, { unique: true });

export const ShortVideoProgress = model<IShortVideoProgress>(
  "ShortVideoProgress",
  ShortVideoProgressSchema,
  "short-video-progress"
);