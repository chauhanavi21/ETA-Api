import express from "express";
import { updateUserName, getUserProfile } from "../controllers/usersController.js";

const router = express.Router();

// User profile operations
router.put("/profile", updateUserName);
router.get("/profile/:userId", getUserProfile);

export default router;
