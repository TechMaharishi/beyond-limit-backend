/**
 * Cloudinary Upload Webhook Route — V1
 *
 * Mounted at /api in app.ts → final path: /api/v1/webhooks/cloudinary/upload-complete
 *
 * Configure this URL in Cloudinary as the notification_url when generating
 * signed upload params (done automatically by getSignedUploadUrl).
 *
 * Separate from the existing subtitle webhook (/api/webhooks/cloudinary/blpt-videos)
 * so the two pipelines don't interfere.
 */

import express from "express";
import { handleCloudinaryUploadCompleteV1 } from "@/controllers/webhooks/cloudinaryUploadV1";

const cloudinaryUploadV1Router = express.Router();

cloudinaryUploadV1Router.post(
  "/v1/webhooks/cloudinary/upload-complete",
  handleCloudinaryUploadCompleteV1
);

export default cloudinaryUploadV1Router;
