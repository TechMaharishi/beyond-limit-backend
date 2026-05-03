import express from "express";
import { writeLimiter } from "@/utils/rate-limiter";
import {
  assignTraineeToUser,
  unassignTraineeFromUser,
  getAssignedTraineeForUser,
  getUsersAssignedToTrainee,
} from "@/controllers/assign-clinical/assign-clinical";

const router = express.Router();

router.post("/assign-clinical/assign", writeLimiter, assignTraineeToUser);
router.delete("/assign-clinical/assign", writeLimiter, unassignTraineeFromUser);
// Specific route must come before the :userId wildcard
router.get("/assign-clinical/trainee/:traineeId", getUsersAssignedToTrainee);
router.get("/assign-clinical/:userId", getAssignedTraineeForUser);

export default router;
