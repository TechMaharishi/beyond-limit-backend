import express from "express";
import { CreateRolebaseUser, ListUser, ListUserBadPagination, SetUserRole, ResetUserPassword, BanUser, UnbanUser, DeleteUser, DeleteUsersBulk, UpdateUser } from "@/controllers/onboarding/admin";


const superAdminRouter = express.Router();

superAdminRouter.post("/admin/create-user", CreateRolebaseUser);
superAdminRouter.get("/admin/list-user/all", ListUser);
superAdminRouter.get("/admin/list-user", ListUserBadPagination);
superAdminRouter.post("/admin/set-user-role", SetUserRole);
superAdminRouter.post("/admin/reset-user-password", ResetUserPassword);
superAdminRouter.post("/admin/ban-user", BanUser);
superAdminRouter.post("/admin/unban-user", UnbanUser);
superAdminRouter.post("/admin/delete-user", DeleteUser);
superAdminRouter.post("/admin/delete-users", DeleteUsersBulk);
superAdminRouter.post("/admin/update-user", UpdateUser);

export default superAdminRouter;
