import { Schema, model, Document } from "mongoose";

export type DeviceType = "ios" | "android" | "web";

export interface IDeviceToken extends Document {
  userId: string;
  deviceToken: string;
  deviceType: DeviceType;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceTokenSchema = new Schema<IDeviceToken>(
  {
    userId: { type: String, required: true, index: true, unique: true },
    deviceToken: { type: String, required: true, index: true },
    deviceType: { type: String, enum: ["ios", "android", "web"], required: true },
  },
  { timestamps: true }
);


export const DeviceToken = model<IDeviceToken>(
  "DeviceToken",
  DeviceTokenSchema,
  "device-tokens"
);