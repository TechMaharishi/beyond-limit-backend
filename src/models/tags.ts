import mongoose, { Schema, Document, Types } from "mongoose";

export interface ITag extends Document {
  name: string;
  slug: string;
  active: boolean;
  deletedAt?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TagSchema = new Schema<ITag>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date, default: undefined },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// TTL index: documents with deletedAt set will be removed ~6 months after deletion
// 6 months approximated as 180 days -> 15552000 seconds
TagSchema.index({ deletedAt: 1 }, { expireAfterSeconds: 15552000 });

export const Tag = mongoose.model<ITag>("Tag", TagSchema, "tags");
