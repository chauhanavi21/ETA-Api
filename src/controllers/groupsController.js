import { sql } from "../config/db.js";
import { notifyGroupMembers, notifyUser } from "../utils/pushNotifications.js";

// Generate unique 6-character code
function generateGroupCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create a new group
export async function createGroup(req, res) {
  try {
    const { name, userId, userName, currency = "USD" } = req.body;

    if (!name || !userId) {
      return res.status(400).json({ message: "Name and userId are required" });
    }

    // Generate unique code
    let code = generateGroupCode();
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      const existing = await sql`SELECT id FROM groups WHERE code = ${code}`;
      if (existing.length === 0) {
        isUnique = true;
      } else {
        code = generateGroupCode();
        attempts++;
      }
    }

    if (!isUnique) {
      return res.status(500).json({ message: "Failed to generate unique code" });
    }

    // Create group
    const group = await sql`
      INSERT INTO groups(name, code, created_by, currency)
      VALUES (${name}, ${code}, ${userId}, ${currency})
      RETURNING *
    `;

    // Add creator as first member
    await sql`
      INSERT INTO group_members(group_id, user_id, user_name)
      VALUES (${group[0].id}, ${userId}, ${userName || 'User'})
      ON CONFLICT (group_id, user_id) 
      DO UPDATE SET user_name = COALESCE(${userName}, group_members.user_name, 'User')
    `;

    // Upsert canonical user name
    if (userName && String(userName).trim()) {
      await sql`
        INSERT INTO users (user_id, user_name)
        VALUES (${userId}, ${String(userName).trim()})
        ON CONFLICT (user_id)
        DO UPDATE SET user_name = EXCLUDED.user_name, updated_at = CURRENT_TIMESTAMP
      `;
    }

    res.status(201).json(group[0]);
  } catch (error) {
    console.log("Error creating group", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Join group via code
export async function joinGroup(req, res) {
  try {
    const { code, userId, userName } = req.body;

    if (!code || !userId) {
      return res.status(400).json({ message: "Code and userId are required" });
    }

    // Find group by code
    const group = await sql`SELECT * FROM groups WHERE code = ${code}`;

    if (group.length === 0) {
      return res.status(404).json({ message: "Group not found" });
    }

    // Check if already a member
    const existing = await sql`
      SELECT * FROM group_members 
      WHERE group_id = ${group[0].id} AND user_id = ${userId}
    `;

    if (existing.length > 0) {
      return res.status(400).json({ message: "Already a member of this group" });
    }

    // Add member
    await sql`
      INSERT INTO group_members(group_id, user_id, user_name)
      VALUES (${group[0].id}, ${userId}, ${userName || 'User'})
    `;

    // Upsert canonical user name
    if (userName && String(userName).trim()) {
      await sql`
        INSERT INTO users (user_id, user_name)
        VALUES (${userId}, ${String(userName).trim()})
        ON CONFLICT (user_id)
        DO UPDATE SET user_name = EXCLUDED.user_name, updated_at = CURRENT_TIMESTAMP
      `;
    }

    // Send notification to group members
    await notifyGroupMembers(
      sql,
      group[0].id,
      userId,
      "New Member Joined",
      `${userName || 'Someone'} joined your group '${group[0].name}'`,
      {
        type: 'member_joined',
        groupId: group[0].id,
        userId: userId,
        userName: userName || 'User',
      }
    );

    res.status(200).json(group[0]);
  } catch (error) {
    console.log("Error joining group", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Get all groups for a user
export async function getUserGroups(req, res) {
  try {
    const { userId } = req.params;

    const groups = await sql`
      SELECT g.*, gm.joined_at
      FROM groups g
      INNER JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.user_id = ${userId}
      ORDER BY g.created_at DESC
    `;

    res.status(200).json(groups);
  } catch (error) {
    console.log("Error getting user groups", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Get group members
export async function getGroupMembers(req, res) {
  try {
    const { groupId } = req.params;

    const members = await sql`
      SELECT 
        user_id, 
        COALESCE(gm.user_name, u.user_name, 'User') as user_name, 
        joined_at
      FROM group_members gm
      LEFT JOIN users u ON gm.user_id = u.user_id
      WHERE gm.group_id = ${groupId}
      ORDER BY joined_at ASC
    `;

    res.status(200).json(members);
  } catch (error) {
    console.log("Error getting group members", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Get group details
export async function getGroupById(req, res) {
  try {
    const { groupId } = req.params;

    const group = await sql`SELECT * FROM groups WHERE id = ${groupId}`;

    if (group.length === 0) {
      return res.status(404).json({ message: "Group not found" });
    }

    res.status(200).json(group[0]);
  } catch (error) {
    console.log("Error getting group", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Update group details (currently supports renaming)
export async function updateGroup(req, res) {
  try {
    const { groupId } = req.params;
    const { name, userId } = req.body;

    const trimmedName = (name || "").trim();
    if (!trimmedName) {
      return res.status(400).json({ message: "Group name is required" });
    }

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Ensure requester is a member of the group
    const member = await sql`
      SELECT 1
      FROM group_members
      WHERE group_id = ${groupId} AND user_id = ${userId}
      LIMIT 1
    `;

    if (member.length === 0) {
      return res.status(403).json({ message: "You are not a member of this group" });
    }

    const updated = await sql`
      UPDATE groups
      SET name = ${trimmedName}
      WHERE id = ${groupId}
      RETURNING *
    `;

    if (updated.length === 0) {
      return res.status(404).json({ message: "Group not found" });
    }

    res.status(200).json(updated[0]);
  } catch (error) {
    console.log("Error updating group", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Add expense to group
export async function addGroupExpense(req, res) {
  try {
    const { groupId, description, amount, paidBy, category, splits } = req.body;

    if (!groupId || !description || !amount || !paidBy || !category || !splits) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({ message: "Splits must be a non-empty array" });
    }

    // Verify paidBy is a member
    const paidByMember = await sql`
      SELECT * FROM group_members 
      WHERE group_id = ${groupId} AND user_id = ${paidBy}
    `;

    if (paidByMember.length === 0) {
      return res.status(403).json({ message: "User not a member of this group" });
    }

    // Create expense
    const expense = await sql`
      INSERT INTO group_expenses(group_id, description, amount, paid_by_user_id, category)
      VALUES (${groupId}, ${description}, ${amount}, ${paidBy}, ${category})
      RETURNING *
    `;

    // Create splits
    for (const split of splits) {
      await sql`
        INSERT INTO expense_splits(expense_id, user_id, amount_owed)
        VALUES (${expense[0].id}, ${split.userId}, ${split.amount})
      `;
    }

    res.status(201).json(expense[0]);
  } catch (error) {
    console.log("Error adding group expense", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Update/Edit expense
export async function updateGroupExpense(req, res) {
  try {
    const { expenseId } = req.params;
    const { description, amount, category, splits } = req.body;

    if (!description || !amount || !category || !splits) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({ message: "Splits must be a non-empty array" });
    }

    // Update expense
    const expense = await sql`
      UPDATE group_expenses
      SET description = ${description}, amount = ${amount}, category = ${category}
      WHERE id = ${expenseId}
      RETURNING *
    `;

    if (expense.length === 0) {
      return res.status(404).json({ message: "Expense not found" });
    }

    // Delete existing splits
    await sql`DELETE FROM expense_splits WHERE expense_id = ${expenseId}`;

    // Create new splits
    for (const split of splits) {
      await sql`
        INSERT INTO expense_splits(expense_id, user_id, amount_owed)
        VALUES (${expenseId}, ${split.userId}, ${split.amount})
      `;
    }

    // Get expense details and group info for notification
    const expenseDetails = await sql`
      SELECT 
        ge.*, 
        g.name as group_name,
        COALESCE(gm.user_name, u.user_name) as payer_name
      FROM group_expenses ge
      INNER JOIN groups g ON ge.group_id = g.id
      LEFT JOIN group_members gm ON ge.paid_by_user_id = gm.user_id AND gm.group_id = ge.group_id
      LEFT JOIN users u ON ge.paid_by_user_id = u.user_id
      WHERE ge.id = ${expenseId}
    `;

    if (expenseDetails.length > 0) {
      const exp = expenseDetails[0];
      // Send notification to group members about expense edit
      await notifyGroupMembers(
        sql,
        exp.group_id,
        exp.paid_by_user_id,
        "Expense Updated",
        `${exp.payer_name || 'Someone'} updated '${exp.description}' expense in '${exp.group_name}'`,
        {
          type: 'expense_edited',
          groupId: exp.group_id,
          expenseId: expenseId,
          description: exp.description,
        }
      );
    }

    res.status(200).json(expense[0]);
  } catch (error) {
    console.log("Error updating group expense", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Get group expenses
export async function getGroupExpenses(req, res) {
  try {
    const { groupId } = req.params;

    const expenses = await sql`
      SELECT 
        ge.*,
        COALESCE(gm.user_name, u.user_name, ge.paid_by_user_id) as paid_by_user_name
      FROM group_expenses ge
      LEFT JOIN group_members gm ON ge.paid_by_user_id = gm.user_id AND gm.group_id = ge.group_id
      LEFT JOIN users u ON ge.paid_by_user_id = u.user_id
      WHERE ge.group_id = ${groupId}
      ORDER BY ge.created_at DESC
    `;

    res.status(200).json(expenses);
  } catch (error) {
    console.log("Error getting group expenses", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Get expense splits for a specific expense
export async function getExpenseSplits(req, res) {
  try {
    const { expenseId } = req.params;

    const splits = await sql`
      SELECT 
        es.*,
        COALESCE(gm.user_name, u.user_name, es.user_id) as user_name,
        ge.group_id
      FROM expense_splits es
      INNER JOIN group_expenses ge ON es.expense_id = ge.id
      LEFT JOIN group_members gm ON es.user_id = gm.user_id AND gm.group_id = ge.group_id
      LEFT JOIN users u ON es.user_id = u.user_id
      WHERE es.expense_id = ${expenseId}
      ORDER BY COALESCE(gm.user_name, u.user_name, es.user_id)
    `;

    res.status(200).json(splits);
  } catch (error) {
    console.log("Error getting expense splits", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Get user's balance in a group (who owes who)
export async function getGroupBalance(req, res) {
  try {
    const { groupId, userId } = req.params;

    // Get detailed breakdown - others who owe the user
    const owesMe = await sql`
      SELECT 
        es.user_id, 
        COALESCE(gm.user_name, u.user_name, es.user_id) as user_name, 
        SUM(es.amount_owed) as total
      FROM expense_splits es
      INNER JOIN group_expenses ge ON es.expense_id = ge.id
      LEFT JOIN group_members gm ON es.user_id = gm.user_id AND gm.group_id = ${groupId}
      LEFT JOIN users u ON es.user_id = u.user_id
      WHERE ge.group_id = ${groupId} 
        AND ge.paid_by_user_id = ${userId}
        AND es.user_id != ${userId}
        AND es.is_settled = false
      GROUP BY es.user_id, gm.user_name
    `;

    // Get detailed breakdown - what user owes others
    const iOwe = await sql`
      SELECT 
        ge.paid_by_user_id as user_id, 
        COALESCE(gm.user_name, u.user_name, ge.paid_by_user_id) as user_name, 
        SUM(es.amount_owed) as total
      FROM expense_splits es
      INNER JOIN group_expenses ge ON es.expense_id = ge.id
      LEFT JOIN group_members gm ON ge.paid_by_user_id = gm.user_id AND gm.group_id = ${groupId}
      LEFT JOIN users u ON ge.paid_by_user_id = u.user_id
      WHERE ge.group_id = ${groupId}
        AND es.user_id = ${userId}
        AND ge.paid_by_user_id != ${userId}
        AND es.is_settled = false
      GROUP BY ge.paid_by_user_id, gm.user_name
    `;

    // Calculate totals
    const totalLent = owesMe.reduce((sum, o) => sum + parseFloat(o.total), 0);
    const totalBorrowed = iOwe.reduce((sum, o) => sum + parseFloat(o.total), 0);
    const netBalance = totalLent - totalBorrowed;

    res.status(200).json({
      totalPaid: totalLent,  // What others owe you (you lent)
      totalOwed: totalBorrowed,  // What you owe others (you borrowed)
      netBalance: netBalance,
      owesMe: owesMe.map((o) => ({
        userId: o.user_id,
        userName: o.user_name || o.user_id,
        amount: parseFloat(o.total),
      })),
      iOwe: iOwe.map((o) => ({
        userId: o.user_id,
        userName: o.user_name || o.user_id,
        amount: parseFloat(o.total),
      })),
    });
  } catch (error) {
    console.log("Error getting group balance", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Settle up debts between two users in a group
export async function settleUp(req, res) {
  try {
    const { groupId, fromUserId, toUserId } = req.body;

    if (!groupId || !fromUserId || !toUserId) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Get all unsettled splits where fromUserId owes toUserId
    const splits = await sql`
      SELECT es.*
      FROM expense_splits es
      INNER JOIN group_expenses ge ON es.expense_id = ge.id
      WHERE ge.group_id = ${groupId}
        AND ge.paid_by_user_id = ${toUserId}
        AND es.user_id = ${fromUserId}
        AND es.is_settled = false
    `;

    if (splits.length === 0) {
      return res.status(404).json({ message: "No debts to settle" });
    }

    // Mark all splits as settled
    for (const split of splits) {
      await sql`
        UPDATE expense_splits
        SET is_settled = true, settled_at = CURRENT_TIMESTAMP
        WHERE id = ${split.id}
      `;
    }

    // Calculate total amount settled
    const totalSettled = splits.reduce((sum, split) => sum + parseFloat(split.amount_owed), 0);

    // Get user names and group name (fallback to canonical users table)
    const fromUser = await sql`
      SELECT COALESCE(gm.user_name, u.user_name) as user_name
      FROM (SELECT ${fromUserId}::varchar as user_id) x
      LEFT JOIN group_members gm ON gm.group_id = ${groupId} AND gm.user_id = x.user_id
      LEFT JOIN users u ON u.user_id = x.user_id
    `;
    const toUser = await sql`
      SELECT COALESCE(gm.user_name, u.user_name) as user_name
      FROM (SELECT ${toUserId}::varchar as user_id) x
      LEFT JOIN group_members gm ON gm.group_id = ${groupId} AND gm.user_id = x.user_id
      LEFT JOIN users u ON u.user_id = x.user_id
    `;
    const group = await sql`SELECT name FROM groups WHERE id = ${groupId}`;

    const fromName = fromUser[0]?.user_name || 'Someone';
    const toName = toUser[0]?.user_name || 'Someone';
    const groupName = group[0]?.name || 'a group';

    // Notify the person who received the payment
    await notifyUser(
      sql,
      toUserId,
      "Payment Received",
      `${fromName} settled up $${totalSettled.toFixed(2)} with you in '${groupName}'`,
      {
        type: 'settled_up',
        groupId: groupId,
        amount: totalSettled,
        fromUserId: fromUserId,
      }
    );

    res.status(200).json({
      message: "Successfully settled up",
      settledCount: splits.length,
    });
  } catch (error) {
    console.log("Error settling up", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Delete expense
export async function deleteGroupExpense(req, res) {
  try {
    const { expenseId } = req.params;
    const { userId } = req.body;

    if (!expenseId) {
      return res.status(400).json({ message: "Expense ID is required" });
    }

    // Get expense details and group info for notification before deletion
    const expenseDetails = await sql`
      SELECT ge.*, g.name as group_name, g.id as group_id, gm.user_name as payer_name
      FROM group_expenses ge
      INNER JOIN groups g ON ge.group_id = g.id
      LEFT JOIN group_members gm ON ge.paid_by_user_id = gm.user_id AND gm.group_id = ge.group_id
      WHERE ge.id = ${expenseId}
    `;

    if (expenseDetails.length === 0) {
      return res.status(404).json({ message: "Expense not found" });
    }

    const expense = expenseDetails[0];

    // Check if the user is authorized to delete (only the person who created it)
    if (userId && expense.paid_by_user_id !== userId) {
      return res.status(403).json({ message: "You are not authorized to delete this expense" });
    }

    // Delete expense (splits will be deleted automatically due to CASCADE)
    await sql`DELETE FROM group_expenses WHERE id = ${expenseId}`;

    // Send notification to group members about expense deletion
    await notifyGroupMembers(
      sql,
      expense.group_id,
      expense.paid_by_user_id,
      "Expense Deleted",
      `${expense.payer_name || 'Someone'} deleted '${expense.description}' expense in '${expense.group_name}'`,
      {
        type: 'expense_deleted',
        groupId: expense.group_id,
        description: expense.description,
      }
    );

    res.status(200).json({ 
      message: "Expense deleted successfully",
      expenseId: expenseId
    });
  } catch (error) {
    console.log("Error deleting group expense", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Toggle Smart Split for a group
export async function toggleSmartSplit(req, res) {
  try {
    const { groupId, enabled } = req.body;

    if (!groupId || enabled === undefined) {
      return res.status(400).json({ message: "Group ID and enabled status are required" });
    }

    const result = await sql`
      UPDATE groups
      SET smart_split_enabled = ${enabled}
      WHERE id = ${groupId}
      RETURNING *
    `;

    if (result.length === 0) {
      return res.status(404).json({ message: "Group not found" });
    }

    res.status(200).json({
      message: "Smart Split setting updated",
      smartSplitEnabled: result[0].smart_split_enabled,
    });
  } catch (error) {
    console.log("Error toggling smart split", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

// Leave a group
export async function leaveGroup(req, res) {
  try {
    const { groupId, userId } = req.body;

    if (!groupId || !userId) {
      return res.status(400).json({ message: "Group ID and User ID are required" });
    }

    // Check if user is a member
    const member = await sql`
      SELECT * FROM group_members 
      WHERE group_id = ${groupId} AND user_id = ${userId}
    `;

    if (member.length === 0) {
      return res.status(404).json({ message: "You are not a member of this group" });
    }

    // Check for unsettled debts
    const unsettledDebts = await sql`
      SELECT es.*
      FROM expense_splits es
      INNER JOIN group_expenses ge ON es.expense_id = ge.id
      WHERE ge.group_id = ${groupId}
        AND (es.user_id = ${userId} OR ge.paid_by_user_id = ${userId})
        AND es.is_settled = false
    `;

    if (unsettledDebts.length > 0) {
      return res.status(400).json({ 
        message: "You have unsettled expenses in this group. Please settle up before leaving.",
        hasDebts: true
      });
    }

    // Get user and group details before removal
    const leavingUser = await sql`
      SELECT user_name FROM group_members 
      WHERE group_id = ${groupId} AND user_id = ${userId}
    `;
    const group = await sql`SELECT name FROM groups WHERE id = ${groupId}`;
    
    const userName = leavingUser[0]?.user_name || 'Someone';
    const groupName = group[0]?.name || 'a group';

    // Remove user from group
    await sql`
      DELETE FROM group_members 
      WHERE group_id = ${groupId} AND user_id = ${userId}
    `;

    // Check if group is now empty
    const remainingMembers = await sql`
      SELECT * FROM group_members WHERE group_id = ${groupId}
    `;

    // If no members left, delete the group
    if (remainingMembers.length === 0) {
      await sql`DELETE FROM groups WHERE id = ${groupId}`;
      return res.status(200).json({ 
        message: "Successfully left group. Group was deleted as you were the last member.",
        groupDeleted: true
      });
    }

    // Notify remaining group members
    await notifyGroupMembers(
      sql,
      groupId,
      userId,
      "Member Left Group",
      `${userName} left '${groupName}'`,
      {
        type: 'member_left',
        groupId: groupId,
        userId: userId,
        userName: userName,
      }
    );

    res.status(200).json({ 
      message: "Successfully left group",
      groupDeleted: false
    });
  } catch (error) {
    console.log("Error leaving group", error);
    res.status(500).json({ message: "Internal server error" });
  }
}
