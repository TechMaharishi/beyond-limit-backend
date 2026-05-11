import express from "express";
import { handleCloudinaryUploadCompleteV1 } from "@/controllers/webhooks/cloudinaryUploadV1";

const cloudinaryUploadV1Router = express.Router();

cloudinaryUploadV1Router.post(
  "/v1/webhooks/cloudinary/upload-complete",
  handleCloudinaryUploadCompleteV1
);

export default cloudinaryUploadV1Router;
