import admin from "firebase-admin";
import { initFirebase } from "../config/firebase.js";

initFirebase();

function getDb() {
  return admin.firestore();
}

// Register or update user's push token
export async function registerPushToken(req, res) {
  try {
    const { pushToken } = req.body;
    const userId = req.user?.uid;

    if (!userId || !pushToken) {
      return res.status(400).json({ message: "User ID and push token are required" });
    }

    const db = getDb();
    await db.collection("userTokens").doc(String(userId)).set(
      {
        pushToken: String(pushToken),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.status(200).json({ message: "Push token registered successfully" });
  } catch (error) {
    console.log("Error registering push token", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Remove user's push token (when they log out)
export async function unregisterPushToken(req, res) {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const db = getDb();
    await db.collection("userTokens").doc(String(userId)).delete();

    res.status(200).json({ message: "Push token removed successfully" });
  } catch (error) {
    console.log("Error removing push token", error);
    res.status(500).json({ message: "Internal server error" });
  }
}
