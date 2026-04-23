import { Request, Response, NextFunction } from "express";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendSuccess, sendError } from "@/utils/api-response";
import { Notification } from "@/models/notification";

export const listNotifications = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const readParam = (req.query.read as string | undefined)?.toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const query: any = { userId: (user as any).id };
    if (readParam === "true") query.read = true;
    if (readParam === "false") query.read = false;

    const docs = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return sendSuccess(res, 200, "Notifications fetched", docs);
  } catch (error) {
    next(error);
  }
};

export const markNotificationRead = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const { id } = req.params as { id: string };
    if (!id) return sendError(res, 400, "Notification id is required");

    const updated = await Notification.findOneAndUpdate(
      { _id: id, userId: (user as any).id },
      { $set: { read: true } },
      { returnDocument: 'after' }
    );
    if (!updated) return sendError(res, 404, "Notification not found");

    return sendSuccess(res, 200, "Notification marked as read", updated);
  } catch (error) {
    next(error);
  }
};

export const clearAllNotifications = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const result = await Notification.deleteMany({ userId: (user as any).id });
    const deleted = result.deletedCount || 0;
    return sendSuccess(res, 200, "Notifications cleared", { deleted });
  } catch (error) {
    next(error);
  }
};

export const deleteNotification = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const { id } = req.params as { id: string };
    if (!id) return sendError(res, 400, "Notification id is required");

    const deleted = await Notification.findOneAndDelete({ _id: id, userId: (user as any).id });
    if (!deleted) return sendError(res, 404, "Notification not found");

    return sendSuccess(res, 200, "Notification deleted", deleted);
  } catch (error) {
    next(error);
  }
};
