import { Schema, model, Types, Document } from "mongoose";

export type TicketStatus = "pending" | "resolved";

export const SUPPORT_TYPE_SLUGS = [
   "app-technical-support",
   "other",
] as const;

export type SupportType = string;


export interface ISupportTicket {
  _id?: Types.ObjectId;
  subject: string;
  type: SupportType;
  description: string;
  currentStatus: TicketStatus;
  user: {
    email: string;
    name: string;
    _id: string;
  };
  userId: string;
  imageUrl?: string;
  imageCloudinaryId?: string;
  imageUrls?: string[];
  imageCloudinaryIds?: string[];
  videoUrls?: string[];
  videoCloudinaryIds?: string[];
  resolvedBy?: string | null;
  resolvedAt?: Date | null;
  expireAt?: Date | null;
  resolutionMsg?: string;
  slackChannelId?: string;
  slackMessageTs?: string;
  createdAt?: Date;
  updatedAt?: Date;
}



const SupportTicketSchema = new Schema(
  {
    subject: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9-]+$/,
    },
    description: { type: String, required: true, trim: true },
    currentStatus: {
      type: String,
      required: true,
      enum: ["pending", "resolved"],
      default: "pending",
    },
    user: {
      email: { type: String, required: true, trim: true },
      name: { type: String, required: true, trim: true },
      _id: { type: String, required: true },
    },
    userId: { type: String, required: true, index: true },
    imageUrl: { type: String, default: "" },
    imageCloudinaryId: { type: String, default: "" },
    imageUrls: { type: [String], default: [] },
    imageCloudinaryIds: { type: [String], default: [] },
    videoUrls: { type: [String], default: [] },
    videoCloudinaryIds: { type: [String], default: [] },
    resolvedBy: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    // TTL target date: only set when ticket is resolved
    expireAt: { type: Date, default: null },
    resolutionMsg: { type: String, default: "" },
    slackChannelId: { type: String, default: "" },
    slackMessageTs: { type: String, default: "" },
  },
  { timestamps: true }
);

SupportTicketSchema.index({ currentStatus: 1, userId: 1, createdAt: -1 });

// TTL index: documents expire at the time specified by expireAt.
// Unresolved tickets keep expireAt as null and will not be purged.
SupportTicketSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const SupportTicket = model<ISupportTicket>(
  "SupportTicket",
  SupportTicketSchema
);
