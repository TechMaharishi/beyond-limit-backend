import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { auth } from "@/lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { sendSuccess, sendError } from "@/utils/api-response";
import cloudinary from "@/config/cloudinary";
import { SupportTicket } from "@/models/support";
import type { ISupportTicket } from "@/models/support";
import { TicketType } from "@/models/ticket-type";
import admin from "@/config/firebase";
import { DeviceToken } from "@/models/device-token";
import { Notification } from "@/models/notification";
import { sendSupportTicketAlertEmail } from "@/utils/mailer";

/**
 * Standardizes the support ticket response by formatting the user field
 * and ensuring all file fields are included as plain arrays.
 */
const formatTicket = (ticket: any) => {
  const raw = ticket.toObject ? ticket.toObject() : ticket;
  const userField: any = raw.user;
  let userOut = userField;

  // Ensure user subdocument has consistent structure
  if (userField && typeof userField === "object" && userField._id) {
    userOut = {
      _id: String(userField._id),
      email: String(userField.email || ""),
      name: String(userField.name || ""),
    };
  } else if (raw.userId) {
     userOut = {
       _id: String(raw.userId),
       email: "",
       name: "User",
     };
  }

  // Improved file array handling: merge plural and singular fields to ensure visibility
  const combinedImageUrls = [
    ...(Array.isArray(raw.imageUrls) ? raw.imageUrls : []),
    ...(raw.imageUrl ? [raw.imageUrl] : [])
  ];
  const uniqueImageUrls = Array.from(new Set(combinedImageUrls)).filter(Boolean);

  const combinedVideoUrls = [
    ...(Array.isArray(raw.videoUrls) ? raw.videoUrls : []),
    ...(raw.videoUrl ? [raw.videoUrl] : []) // Just in case there was a legacy singular videoUrl
  ];
  const uniqueVideoUrls = Array.from(new Set(combinedVideoUrls)).filter(Boolean);

  const formatted = { 
    ...raw, 
    user: userOut,
    imageUrls: uniqueImageUrls,
    videoUrls: uniqueVideoUrls,
    // Provide singular fallback for very old frontend versions if needed
    imageUrl: uniqueImageUrls[0] || "",
  };
  
  delete (formatted as any).userInfo;
  delete (formatted as any).userId;
  delete (formatted as any).__v;
  
  return formatted;
};

// Create ticket
export const createSupportTicket = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canCreate = await auth.api.userHasPermission({
      body: { permission: { ticket: ["create"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canCreate?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const { subject, type, description } = req.body as {
      subject: string;
      type: string;
      description: string;
    };

    if (!subject || !type || !description) {
      return sendError(res, 400, "subject, type, and description are required");
    }

    const normalizeSlug = (s: string) =>
      s.toLowerCase().trim().replace(/\s+/g, "-");
    const typeSlug = normalizeSlug(type);
    let typeValid = false;
    try {
      const exists = await TicketType.findOne({
        slug: typeSlug,
        active: true,
      }).lean();
      typeValid = !!exists;
    } catch (_) {}
    if (!typeValid) {
      const { SUPPORT_TYPE_SLUGS } = await import("@/models/support");
      typeValid =
        Array.isArray(SUPPORT_TYPE_SLUGS) &&
        SUPPORT_TYPE_SLUGS.includes(typeSlug as any);
    }
    if (!typeValid) {
      return sendError(res, 400, "Unsupported ticket type");
    }

    let imageUrl = "";
    let imageCloudinaryId = "";
    const imageUrls: string[] = [];
    const imageCloudinaryIds: string[] = [];
    const videoUrls: string[] = [];
    const videoCloudinaryIds: string[] = [];

    const filesField: any = req.files || {};
    const images: any[] = Array.isArray(filesField?.images) ? filesField.images : [];
    const videos: any[] = Array.isArray(filesField?.videos) ? filesField.videos : [];

    // Debug logging for file uploads
    console.log(`[SupportTicket] Uploading ${images.length} images and ${videos.length} videos`);

    for (const f of images) {
      if (!f?.buffer) continue;
      const maxImageSize = 50 * 1024 * 1024; // Standardized to 50MB
      if (f.buffer.length > maxImageSize) {
        return sendError(res, 400, "Image size exceeds 50 MB.");
      }
      try {
        const result: any = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { resource_type: "image", folder: "support-tickets" },
            (error, uploaded) => {
              if (error) return reject(error);
              resolve(uploaded);
            }
          );
          stream.end(f.buffer);
        });
        const url = String(result?.secure_url || "");
        const pid = String(result?.public_id || "");
        imageUrls.push(url);
        imageCloudinaryIds.push(pid);
      } catch (err) {
        console.error("[SupportTicket] Image upload error:", err);
        return sendError(res, 500, "Image upload failed.");
      }
    }
    if (imageUrls.length > 0) {
      imageUrl = imageUrls[0];
      imageCloudinaryId = imageCloudinaryIds[0];
    }

    for (const f of videos) {
      if (!f?.buffer) continue;
      const maxVideoSize = 50 * 1024 * 1024;
      if (f.buffer.length > maxVideoSize) {
        return sendError(res, 400, "Video size exceeds 50 MB.");
      }
      try {
        const result: any = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { resource_type: "video", folder: "support-tickets" },
            (error, uploaded) => {
              if (error) return reject(error);
              resolve(uploaded);
            }
          );
          stream.end(f.buffer);
        });
        const url = String(result?.secure_url || "");
        const pid = String(result?.public_id || "");
        videoUrls.push(url);
        videoCloudinaryIds.push(pid);
      } catch (err) {
        console.error("[SupportTicket] Video upload error:", err);
        return sendError(res, 500, "Video upload failed.");
      }
    }

    const ticket = await SupportTicket.create({
      subject,
      type: typeSlug,
      description,
      currentStatus: "pending",
      user: {
        email: (user as any).email,
        name: (user as any).name,
        _id: (user as any).id,
      },
      userId: (user as any).id,
      imageUrl,
      imageCloudinaryId,
      imageUrls,
      imageCloudinaryIds,
      videoUrls,
      videoCloudinaryIds,
      resolutionMsg: "",
      slackChannelId: "",
      slackMessageTs: "",
    });

    // Send Slack notification if it's app technical support
    if (typeSlug === "app-technical-support") {
      try {
        const botToken = process.env.SLACK_BOT_TOKEN || "";
        const channelId = process.env.SLACK_SUPPORT_CHANNEL_ID || "";
        const webhook = process.env.SLACK_SUPPORT_WEBHOOK_URL || "";

        const summary = `New Support Ticket: ${subject}`;
        const blocks: any[] = [
          { type: "header", text: { type: "plain_text", text: "New Support Ticket" } },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Subject:*\n${subject}` },
              { type: "mrkdwn", text: `*Type:*\n${typeSlug}` },
              { type: "mrkdwn", text: `*User:*\n${(user as any).name} (${(user as any).email})` },
              { type: "mrkdwn", text: `*Ticket ID:*\n${ticket._id}` },
            ],
          },
          { type: "section", text: { type: "mrkdwn", text: `*Description:*\n${description}` } },
        ];

        // Add all images to Slack
        for (const url of imageUrls) {
          blocks.push({ type: "image", image_url: url, alt_text: "support_image" });
        }

        if (botToken && channelId) {
          blocks.push({
            type: "actions",
            elements: [
              { type: "button", text: { type: "plain_text", text: "Resolve" }, style: "primary", action_id: "resolve_ticket", value: String(ticket._id) },
            ],
          });
          const resp = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ channel: channelId, text: summary, blocks }),
          });
          const json = await resp.json();
          if (json.ok) {
            await SupportTicket.findByIdAndUpdate(ticket._id, { slackChannelId: json.channel, slackMessageTs: json.ts }).exec();
          }
        } else if (webhook) {
          await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: summary, blocks }) });
        }
      } catch (err) {
        console.error("[SupportTicket] Slack notification failed:", err);
      }

      // Send Email notification
      try {
        const to = process.env.EMAIL_SUPPORT || "";
        if (to) {
          await sendSupportTicketAlertEmail({
            to,
            payload: {
              subject,
              type: typeSlug,
              currentStatus: "pending",
              id: String(ticket._id),
              userName: (user as any).name,
              userEmail: (user as any).email,
              userId: (user as any).id,
              description,
              imageUrl: imageUrls[0] || "",
            },
          });
        }
      } catch (e) {
        console.error("[SupportTicket] Email notification failed:", e);
      }
    }

    // Push notifications to admins
    try {
      const adminList = await auth.api.listUsers({
        query: { filterField: "role", filterValue: "admin", limit: 100, offset: 0, sortBy: "createdAt", sortDirection: "desc" },
        headers: fromNodeHeaders(req.headers),
      });
      const admins: any[] = ((adminList as any)?.users || []) as any[];
      const adminIds: string[] = admins.map((u: any) => String(u.id)).filter((id: string) => !!id && id !== String((user as any).id));
      
      const notifTitle = "New support ticket";
      const notifBody = `Subject: ${subject}`;
      
      for (const adminId of adminIds) {
        try {
          const tokenDoc = await DeviceToken.findOne({ userId: adminId }).lean();
          if (tokenDoc?.deviceToken) {
            const isExpo = /^ExponentPushToken\[.+\]$/.test(tokenDoc.deviceToken);
            if (isExpo) {
              await fetch("https://exp.host/--/api/v2/push/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ to: tokenDoc.deviceToken, sound: "default", title: notifTitle, body: notifBody }),
              });
            } else {
              await admin.messaging().send({
                token: tokenDoc.deviceToken,
                notification: { title: notifTitle, body: notifBody },
                data: { _id: String(ticket._id), type: typeSlug, event: "support-ticket-created" },
              });
            }
          }
        } catch {}
        try {
          await Notification.create({
            userId: adminId,
            title: notifTitle,
            body: notifBody,
            data: { _id: String(ticket._id), type: typeSlug, event: "support-ticket-created" },
            read: false,
          });
        } catch {}
      }
    } catch {}

    return sendSuccess(res, 201, "Ticket created", formatTicket(ticket));
  } catch (error) {
    next(error);
  }
};

// List tickets
export const listSupportTickets = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";

    if (isAdmin) {
      const canView = await auth.api.userHasPermission({
        body: { permission: { ticket: ["view"] } },
        headers: fromNodeHeaders(req.headers),
      });
      if (!canView?.success) {
        return sendError(res, 403, "Forbidden: insufficient permissions");
      }
    }

    const filter: any = {};
    if (!isAdmin) {
      filter.userId = (user as any).id;
    }

    const typeSlug = req.params.typeSlug || req.query.typeSlug;
    if (typeSlug) {
      filter.type = typeSlug;
    }

    const { search } = req.query;
    if (search && typeof search === "string" && search.trim()) {
      const searchRegex = new RegExp(search.trim(), "i");
      const searchConditions: any[] = [
        { subject: searchRegex },
        { description: searchRegex },
        { type: searchRegex },
        { "user.name": searchRegex },
        { "user.email": searchRegex },
      ];
      if (Types.ObjectId.isValid(search.trim())) {
        searchConditions.push({ _id: search.trim() });
      }
      filter.$or = searchConditions;
    }

    const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 10;
    const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
    const offset = (page - 1) * limit;

    const total = await SupportTicket.countDocuments(filter);
    const data = await SupportTicket.find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit);

    const hasNext = offset + data.length < total;
    return sendSuccess(res, 200, "Tickets fetched", data.map(formatTicket), {
      page,
      offset,
      limit,
      total,
      hasNext,
    });
  } catch (error) {
    next(error);
  }
};

// Compatibility wrapper for technical support list
export const listAppTechnicalSupportTickets = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  req.params.typeSlug = "app-technical-support";
  return listSupportTickets(req, res, next);
};

// Get single ticket
export const getSupportTicket = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const ticketId = req.params.id;
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) return sendError(res, 404, "Ticket not found");

    const role = (user as any).role;
    const isAdmin = Array.isArray(role) ? role.includes("admin") : role === "admin";
    const isOwner = String((ticket as any).userId) === String((user as any).id);

    if (!isOwner && !isAdmin) {
      const canView = await auth.api.userHasPermission({
        body: { permission: { ticket: ["view"] } },
        headers: fromNodeHeaders(req.headers),
      });
      if (!canView?.success) {
        return sendError(res, 403, "Forbidden: insufficient permissions");
      }
    }

    return sendSuccess(res, 200, "Ticket fetched", formatTicket(ticket));
  } catch (error) {
    next(error);
  }
};

// Resolve ticket
export const resolveSupportTicket = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const user = session?.user;
    if (!user) return sendError(res, 401, "Unauthorized");

    const canUpdate = await auth.api.userHasPermission({
      body: { permission: { ticket: ["resolve"] } },
      headers: fromNodeHeaders(req.headers),
    });
    if (!canUpdate?.success) {
      return sendError(res, 403, "Forbidden: insufficient permissions");
    }

    const { id } = req.params;
    const { message } = req.body;
    if (!message) return sendError(res, 400, "Resolution message is required");

    const ticket = await SupportTicket.findByIdAndUpdate(
      id,
      {
        currentStatus: "resolved",
        resolutionMsg: message,
        resolvedBy: (user as any).id,
        resolvedAt: new Date(),
        expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Expire in 30 days
      },
      { new: true }
    );

    if (!ticket) return sendError(res, 404, "Ticket not found");

    return sendSuccess(res, 200, "Ticket resolved", formatTicket(ticket));
  } catch (error) {
    next(error);
  }
};

// Ticket Types handlers
export const getAllTicketTypes = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const types = await TicketType.find({ active: true }).sort({ name: 1 });
    return sendSuccess(res, 200, "Ticket types fetched", types);
  } catch (error) {
    next(error);
  }
};

export const createTicketTypes = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { name, slug, description } = req.body;
    const type = await TicketType.create({ name, slug, description });
    return sendSuccess(res, 201, "Ticket type created", type);
  } catch (error) {
    next(error);
  }
};

export const deleteTicketTypes = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    await TicketType.findByIdAndUpdate(id, { active: false });
    return sendSuccess(res, 200, "Ticket type deleted");
  } catch (error) {
    next(error);
  }
};

// Slack interaction handler
export const slackSupportInteract = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const payloadStr = (req.body as any)?.payload || "";
    if (!payloadStr) return res.status(400).send("invalid_payload");
    const payload = JSON.parse(payloadStr);

    if (payload.type === "block_actions") {
      const action = payload.actions?.[0];
      if (action?.action_id === "resolve_ticket") {
        const ticketId = action.value;
        const triggerId = payload.trigger_id;
        const botToken = process.env.SLACK_BOT_TOKEN;

        if (triggerId && botToken) {
          await fetch("https://slack.com/api/views.open", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${botToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              trigger_id: triggerId,
              view: {
                type: "modal",
                callback_id: "resolve_ticket_modal",
                private_metadata: JSON.stringify({
                  ticketId,
                  channelId: payload.container?.channel_id,
                  messageTs: payload.container?.message_ts || payload.message?.ts,
                }),
                title: { type: "plain_text", text: "Resolve Ticket" },
                submit: { type: "plain_text", text: "Resolve" },
                close: { type: "plain_text", text: "Cancel" },
                blocks: [
                  {
                    type: "input",
                    block_id: "resolution_block",
                    label: { type: "plain_text", text: "Resolution message" },
                    element: { type: "plain_text_input", action_id: "resolution_msg", multiline: true },
                  },
                ],
              },
            }),
          });
        }
      }
      return res.status(200).send("");
    }
    return res.status(200).send("");
  } catch (error) {
    next(error);
  }
};
