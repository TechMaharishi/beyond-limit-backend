import express from "express";
import { registerDeviceToken, deregisterDeviceToken, sendTestNotification } from "@/controllers/notifications/device-tokens";

const router = express.Router();

router.post("/notifications/tokens-register", registerDeviceToken);
router.post("/notifications/tokens-deregister", deregisterDeviceToken);
router.post("/notifications/device-tokens/test", sendTestNotification);

export default router;