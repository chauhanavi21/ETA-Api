import express from "express";
import {
  registerPushToken,
  unregisterPushToken,
} from "../controllers/notificationsController.js";

const router = express.Router();

router.post("/register", registerPushToken);
router.post("/unregister", unregisterPushToken);

export default router;
