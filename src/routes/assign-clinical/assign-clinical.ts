import express from "express";
import { assignTraineeToUser, unassignTraineeFromUser, getAssignedTraineeForUser, getUsersAssignedToTrainee } from "@/controllers/assign-clinical/assign-clinical";

const router = express.Router();


router.post("/assign-clinical/assign", assignTraineeToUser);

router.delete("/assign-clinical/assign", unassignTraineeFromUser);

router.get("/assign-clinical/:userId", getAssignedTraineeForUser);

router.get("/assign-clinical/trainee/:traineeId", getUsersAssignedToTrainee);

export default router;
