import { Schema, model, Document } from "mongoose";

export interface ITicketType extends Document {
  name: string;
  slug: string;
  description?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TicketTypeSchema = new Schema<ITicketType>(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]+$/,
    },
    description: { type: String, default: "", trim: true },
    active: { type: Boolean, default: true },
    
  },
  { timestamps: true }
);

export const TicketType = model<ITicketType>("TicketType", TicketTypeSchema, "ticket-types");

export const DEFAULT_TICKET_TYPE = {
  name: "App Technical Support",
  slug: "app-technical-support",
  description:
    "Assistance with app performance, crashes, bugs, or other technical issues affecting app functionality.",
} as const;

export async function ensureDefaultTicketType() {
  try {
    const existing = await TicketType.findOne({ slug: DEFAULT_TICKET_TYPE.slug }).lean();
    if (existing) return existing as any;
    const doc = await TicketType.create({
      name: DEFAULT_TICKET_TYPE.name,
      slug: DEFAULT_TICKET_TYPE.slug,
      description: DEFAULT_TICKET_TYPE.description,
      active: true,
    });
    return doc as any;
  } catch (e) {
    return null;
  }
}
