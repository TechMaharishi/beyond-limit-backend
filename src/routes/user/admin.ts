import express from "express";
import { CreateRolebaseUser, ListUser, ListUserBadPagination, SetUserRole, ResetUserPassword, BanUser, UnbanUser, DeleteUser, DeleteUsersBulk, UpdateUser, AdminListProfiles, AdminCreateProfile, AdminUpdateProfile, AdminDeleteProfile, ListUserProfiles } from "@/controllers/user/admin";


const superAdminRouter = express.Router();

superAdminRouter.post("/admin/create-user", CreateRolebaseUser);
superAdminRouter.get("/admin/list-user/all", ListUser);
// We need to remove this API from mobile app.
superAdminRouter.get("/admin/list-user", ListUserBadPagination);
superAdminRouter.post("/admin/set-user-role", SetUserRole);
superAdminRouter.post("/admin/reset-user-password", ResetUserPassword);
superAdminRouter.post("/admin/ban-user", BanUser);
superAdminRouter.post("/admin/unban-user", UnbanUser);
superAdminRouter.post("/admin/delete-user", DeleteUser);
superAdminRouter.post("/admin/delete-users", DeleteUsersBulk);
superAdminRouter.post("/admin/update-user", UpdateUser);
//We can remove AdminListProfiles API if we are not using it.
superAdminRouter.get("/admin/profiles", AdminListProfiles);
superAdminRouter.post("/admin/profiles", AdminCreateProfile);
superAdminRouter.patch("/admin/profiles/:profileId", AdminUpdateProfile);
superAdminRouter.delete("/admin/profiles/:profileId", AdminDeleteProfile);
superAdminRouter.get("/admin/user-profiles", ListUserProfiles);

export default superAdminRouter;
