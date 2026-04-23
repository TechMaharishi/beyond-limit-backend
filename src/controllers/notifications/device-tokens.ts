import { Request, Response, NextFunction } from "express";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendSuccess, sendError } from "@/utils/api-response";
import { DeviceToken } from "@/models/device-token";
// import admin from "@/config/firebase";

export const registerDeviceToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const { deviceToken, deviceType } = req.body as {
      deviceToken?: string;
      deviceType?: "ios" | "android" | "web";
    };
    if (!deviceToken || !deviceType) {
      return sendError(res, 400, "deviceToken and deviceType are required");
    }

    // if (/^ExponentPushToken\[.+\]$/.test(deviceToken)) {
    //   return sendError(res, 400, "Invalid token: Expo push token is not a FCM token");
    // }

    const existing = await DeviceToken.findOne({ userId: (user as any).id });
    if (existing) {
      existing.deviceToken = deviceToken;
      existing.deviceType = deviceType as any;
      await existing.save();
      return sendSuccess(res, 200, "Device token updated", existing);
    }

    const created = await DeviceToken.create({
      userId: (user as any).id,
      deviceToken,
      deviceType,
    });
    return sendSuccess(res, 201, "Device token registered", created);
  } catch (error) {
    next(error);
  }
};

export const deregisterDeviceToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const { deviceToken } = req.body as { deviceToken?: string };
    if (!deviceToken) return sendError(res, 400, "deviceToken is required");

    const doc = await DeviceToken.findOne({ userId: (user as any).id });
    if (!doc) return sendSuccess(res, 200, "No device token to delete");

    if (doc.deviceToken !== deviceToken) {
      // If token does not match, still remove record for safety
      await DeviceToken.deleteOne({ userId: (user as any).id });
      return sendSuccess(res, 200, "Device token removed");
    }

    await DeviceToken.deleteOne({ userId: (user as any).id });
    return sendSuccess(res, 200, "Device token removed");
  } catch (error) {
    next(error);
  }
};

export const sendTestNotification = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    
  const message = {
    to: "ExponentPushToken[0w5puaEhxQlHO7DVXiAfab]",
    sound: "default",
    title: "Hello!",
    body: "This is a test notification",
  };
  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(message)
  });
  } catch (error) {
    next(error);
  }
};