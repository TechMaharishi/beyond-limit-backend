import express from "express";
import { handleCloudinaryShortVideoWebhook } from "@/controllers/webhooks/cloudinaryWebhook";

const router = express.Router();

router.post("/webhooks/cloudinary/blpt-videos", handleCloudinaryShortVideoWebhook);

export default router;
