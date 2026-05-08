import express from "express";
import {
  ListMyProfiles,
  CreateMyProfile,
  UpdateMyProfile,
  DeleteMyProfile,
  SwitchProfile,
  UploadProfileAvatar,
  RemoveProfileAvatar,
} from "@/controllers/user/profiles";
import { upload } from "@/config/cloudinary";
import { writeLimiter, strictLimiter } from "@/utils/rate-limiter";

const profilesRouter = express.Router();

profilesRouter.post("/profiles/switch", writeLimiter, SwitchProfile);
profilesRouter.get("/profiles", ListMyProfiles);
profilesRouter.post("/profiles", writeLimiter, upload.single("image"), CreateMyProfile);
profilesRouter.patch("/profiles/:profileId", writeLimiter, upload.single("image"), UpdateMyProfile);
profilesRouter.delete("/profiles/:profileId", writeLimiter, DeleteMyProfile);
profilesRouter.post("/profiles/:profileId/avatar", strictLimiter, upload.single("image"), UploadProfileAvatar);
profilesRouter.delete("/profiles/:profileId/avatar", writeLimiter, RemoveProfileAvatar);

export default profilesRouter;
