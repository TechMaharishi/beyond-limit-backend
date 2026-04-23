import { Router } from "express";
import { listNotifications, markNotificationRead, clearAllNotifications, deleteNotification } from "@/controllers/notifications/notifications";

const router = Router();

router.get("/notifications", listNotifications);
router.post("/notifications/:id/read", markNotificationRead);
router.delete("/notifications", clearAllNotifications);
router.delete("/notifications/:id", deleteNotification);

export default router;
