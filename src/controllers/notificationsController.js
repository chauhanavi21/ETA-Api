import { sql } from "../config/db.js";

// Register or update user's push token
export async function registerPushToken(req, res) {
  try {
    const { userId, pushToken } = req.body;

    if (!userId || !pushToken) {
      return res.status(400).json({ message: "User ID and push token are required" });
    }

    // Insert or update push token
    await sql`
      INSERT INTO user_tokens(user_id, push_token, updated_at)
      VALUES (${userId}, ${pushToken}, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id)
      DO UPDATE SET push_token = ${pushToken}, updated_at = CURRENT_TIMESTAMP
    `;

    res.status(200).json({ message: "Push token registered successfully" });
  } catch (error) {
    console.log("Error registering push token", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Remove user's push token (when they log out)
export async function unregisterPushToken(req, res) {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    await sql`DELETE FROM user_tokens WHERE user_id = ${userId}`;

    res.status(200).json({ message: "Push token removed successfully" });
  } catch (error) {
    console.log("Error removing push token", error);
    res.status(500).json({ message: "Internal server error" });
  }
}
