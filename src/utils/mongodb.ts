import mongoose from "mongoose";

/** Returns true if `id` is a valid MongoDB ObjectId string. */
export function isValidObjectId(id: string): boolean {
  return mongoose.Types.ObjectId.isValid(id);
}
