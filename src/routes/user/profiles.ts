import express from "express";
import {
  ListMyProfiles,
  CreateMyProfile,
  UpdateMyProfile,
  DeleteMyProfile,
  SwitchProfile,
} from "@/controllers/user/profiles";

const profilesRouter = express.Router();

profilesRouter.post("/profiles/switch", SwitchProfile);
profilesRouter.get("/profiles", ListMyProfiles);
profilesRouter.post("/profiles", CreateMyProfile);
profilesRouter.patch("/profiles/:profileId", UpdateMyProfile);
profilesRouter.delete("/profiles/:profileId", DeleteMyProfile);

export default profilesRouter;
