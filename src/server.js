import express from "express";
import dotenv from "dotenv";
import rateLimiter from "./middleware/rateLimiter.js";
import firebaseAuth from "./middleware/firebaseAuth.js";
import { initFirebase } from "./config/firebase.js";

import transactionsRoute from "./routes/transactionsRoute.js";
import groupsRoute from "./routes/groupsRoute.js";
import notificationsRoute from "./routes/notificationsRoute.js";
import usersRoute from "./routes/usersRoute.js";
import job from "./config/cron.js";

dotenv.config();

// Initialize Firebase Admin SDK (Firestore + Auth)
initFirebase();

const app = express();

if (process.env.NODE_ENV === "production") job.start();

app.use(rateLimiter);
app.use(express.json());

const PORT = process.env.PORT || 5001;

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Protect all API routes (except health)
app.use("/api", firebaseAuth);

app.use("/api/transactions", transactionsRoute);
app.use("/api/groups", groupsRoute);
app.use("/api/notifications", notificationsRoute);
app.use("/api/users", usersRoute);

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal server error";
  res.status(status).json({ message });
});

app.listen(PORT, () => {
  console.log("Server is up and running on PORT:", PORT);
});