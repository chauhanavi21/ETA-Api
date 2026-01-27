import { sql } from "../config/db.js";

// Update user's name across all tables in the database
export async function updateUserName(req, res) {
  try {
    const { userId, userName } = req.body;

    if (!userId || !userName) {
      return res.status(400).json({ message: "User ID and user name are required" });
    }

    const trimmedName = userName.trim();
    if (!trimmedName) {
      return res.status(400).json({ message: "User name cannot be empty" });
    }

    // Update user_name in group_members table for all groups this user is in
    const updatedMembers = await sql`
      UPDATE group_members
      SET user_name = ${trimmedName}
      WHERE user_id = ${userId}
      RETURNING group_id
    `;

    console.log(`Updated user name for ${userId} in ${updatedMembers.length} groups`);

    res.status(200).json({
      message: "User name updated successfully across all groups",
      groupsUpdated: updatedMembers.length,
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

    // Get user's groups count
    const groups = await sql`
      SELECT COUNT(*) as group_count
      FROM group_members
      WHERE user_id = ${userId}
    `;

    // Get user's current name from any group membership
    const userInfo = await sql`
      SELECT user_name
      FROM group_members
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    res.status(200).json({
      userId: userId,
      userName: userInfo[0]?.user_name || null,
      groupCount: parseInt(groups[0].group_count) || 0,
    });
  } catch (error) {
    console.log("Error getting user profile", error);
    res.status(500).json({ message: "Internal server error" });
  }
}
