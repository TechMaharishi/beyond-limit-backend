import { Schema, model, Document } from "mongoose";

export interface IProfile extends Document {
  userId: string;
  name: string;
  avatar: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProfileSchema = new Schema<IProfile>(
  {
    userId:    { type: String, required: true, index: true },
    name:      { type: String, required: true, trim: true, maxlength: 50 },
    avatar:    { type: String, default: "" },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ProfileSchema.index(
  { userId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

export const Profile = model<IProfile>("Profile", ProfileSchema, "profiles");
