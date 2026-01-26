import { sql } from "../config/db.js";

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
      ON CONFLICT (group_id, user_id) DO UPDATE SET user_name = ${userName || 'User'}
    `;

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
      SELECT user_id, user_name, joined_at
      FROM group_members
      WHERE group_id = ${groupId}
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

// Get group expenses
export async function getGroupExpenses(req, res) {
  try {
    const { groupId } = req.params;

    const expenses = await sql`
      SELECT * FROM group_expenses
      WHERE group_id = ${groupId}
      ORDER BY created_at DESC
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
        gm.user_name,
        ge.group_id
      FROM expense_splits es
      INNER JOIN group_expenses ge ON es.expense_id = ge.id
      LEFT JOIN group_members gm ON es.user_id = gm.user_id AND gm.group_id = ge.group_id
      WHERE es.expense_id = ${expenseId}
      ORDER BY gm.user_name
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
      SELECT es.user_id, gm.user_name, SUM(es.amount_owed) as total
      FROM expense_splits es
      INNER JOIN group_expenses ge ON es.expense_id = ge.id
      LEFT JOIN group_members gm ON es.user_id = gm.user_id AND gm.group_id = ${groupId}
      WHERE ge.group_id = ${groupId} 
        AND ge.paid_by_user_id = ${userId}
        AND es.user_id != ${userId}
        AND es.is_settled = false
      GROUP BY es.user_id, gm.user_name
    `;

    // Get detailed breakdown - what user owes others
    const iOwe = await sql`
      SELECT ge.paid_by_user_id as user_id, gm.user_name, SUM(es.amount_owed) as total
      FROM expense_splits es
      INNER JOIN group_expenses ge ON es.expense_id = ge.id
      LEFT JOIN group_members gm ON ge.paid_by_user_id = gm.user_id AND gm.group_id = ${groupId}
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

    res.status(200).json({
      message: "Successfully settled up",
      settledCount: splits.length,
    });
  } catch (error) {
    console.log("Error settling up", error);
    res.status(500).json({ message: "Internal server error" });
  }
}
