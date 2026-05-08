import { Router } from "express";
import {
  createSupportTicket,
  listSupportTickets,
  getSupportTicket,
  resolveSupportTicket,
  createTicketTypes,
  deleteTicketTypes,
  getAllTicketTypes,
  listAppTechnicalSupportTickets,
  slackSupportInteract,
} from "@/controllers/support/support";
import express from "express";
import { upload } from "@/config/cloudinary";
import { writeLimiter } from "@/utils/rate-limiter";

const router = Router();

router.post("/support/tickets", writeLimiter, upload.fields([
  { name: "images", maxCount: 10 },
  { name: "videos", maxCount: 3 },
]),
  createSupportTicket);
router.post("/support/slack-interact", express.urlencoded({ extended: true }), slackSupportInteract);
router.get("/support/tickets", listSupportTickets);
router.get("/support/tickets/app-technical-support", listAppTechnicalSupportTickets);
router.get("/support/ticket-types", getAllTicketTypes);
router.post("/support/create-ticket-type", writeLimiter, createTicketTypes);
router.delete("/support/delete-ticket-type/:id", writeLimiter, deleteTicketTypes);

router.get("/support/tickets/:id", getSupportTicket);
router.post("/support/tickets/:id/resolve", writeLimiter, resolveSupportTicket);

export default router;
