import admin from "firebase-admin";
import { initFirebase } from "../config/firebase.js";

initFirebase();

function getDb() {
  return admin.firestore();
}

// Update user's name across all tables in the database
export async function updateUserName(req, res) {
  try {
    const { userName } = req.body;
    const userId = req.user?.uid;

    if (!userId || !userName) {
      return res.status(400).json({ message: "User ID and user name are required" });
    }

    const trimmedName = userName.trim();
    if (!trimmedName) {
      return res.status(400).json({ message: "User name cannot be empty" });
    }

    const db = getDb();

    await db.collection("users").doc(String(userId)).set(
      {
        user_name: trimmedName,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const groupsSnap = await db.collection("users").doc(String(userId)).collection("groups").get();
    const groupIds = groupsSnap.docs.map((d) => d.id);

    let updatedCount = 0;
    for (let i = 0; i < groupIds.length; i += 400) {
      const chunk = groupIds.slice(i, i + 400);
      const batch = db.batch();
      for (const groupId of chunk) {
        batch.set(
          db.collection("groups").doc(String(groupId)).collection("members").doc(String(userId)),
          { user_name: trimmedName },
          { merge: true }
        );
        updatedCount++;
      }
      await batch.commit();
    }

    console.log(`Updated user name for ${userId} in ${updatedCount} groups`);

    res.status(200).json({
      message: "User name updated successfully across all groups",
      groupsUpdated: updatedCount,
    });
  } catch (error) {
    console.log("Error updating user name", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Get user's profile information
export async function getUserProfile(req, res) {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    if (!req.user?.uid || String(req.user.uid) !== String(userId)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const db = getDb();
    const groupsSnap = await db.collection("users").doc(String(userId)).collection("groups").get();
    const userSnap = await db.collection("users").doc(String(userId)).get();
    const userName = userSnap.exists ? userSnap.data().user_name : null;

    res.status(200).json({
      userId: userId,
      userName: userName || null,
      groupCount: groupsSnap.size || 0,
    });
  } catch (error) {
    console.log("Error getting user profile", error);
    res.status(500).json({ message: "Internal server error" });
  }
}
