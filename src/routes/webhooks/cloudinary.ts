/**
 * Cloudinary Webhook Routes
 *
 * Exposes POST /webhooks/cloudinary/short-video
 * (mounted under /api in app.ts → final path: /api/webhooks/cloudinary/short-video)
 */

import express from "express";
import { handleCloudinaryShortVideoWebhook } from "@/controllers/webhooks/cloudinaryWebhook";

const router = express.Router();

// Cloudinary sends transcription completion/failure notifications here
router.post("/webhooks/cloudinary/blpt-videos", handleCloudinaryShortVideoWebhook);

export default router;
