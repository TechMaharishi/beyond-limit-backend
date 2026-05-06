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

const profilesRouter = express.Router();

profilesRouter.post("/profiles/switch", SwitchProfile);
profilesRouter.get("/profiles", ListMyProfiles);
profilesRouter.post("/profiles", CreateMyProfile);
profilesRouter.patch("/profiles/:profileId", UpdateMyProfile);
profilesRouter.delete("/profiles/:profileId", DeleteMyProfile);
profilesRouter.post("/profiles/:profileId/avatar", upload.single("image"), UploadProfileAvatar);
profilesRouter.delete("/profiles/:profileId/avatar", RemoveProfileAvatar);

export default profilesRouter;
