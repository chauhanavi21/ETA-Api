import admin from "firebase-admin";
import { initFirebase } from "../config/firebase.js";
import { notifyGroupMembers, notifyUser } from "../utils/pushNotifications.js";
import { generateGroupCode } from "../utils/groupCode.js";
import { toCents, fromCents } from "../utils/money.js";

initFirebase();

function db() {
  return admin.firestore();
}

function ensureSelf(req, userId) {
  if (!req.user?.uid || String(req.user.uid) !== String(userId)) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }
}

function parsePositiveCents(amount) {
  const cents = toCents(amount);
  if (cents === null) {
    const err = new Error("Invalid amount");
    err.statusCode = 400;
    throw err;
  }
  if (cents <= 0) {
    const err = new Error("Amount must be positive");
    err.statusCode = 400;
    throw err;
  }
  return cents;
}

async function ensureMember(groupId, uid) {
  const snap = await db().collection("groups").doc(String(groupId)).collection("members").doc(String(uid)).get();
  if (!snap.exists) {
    const err = new Error("You are not a member of this group");
    err.statusCode = 403;
    throw err;
  }
}

async function getUserName(uid, groupId = null) {
  try {
    if (groupId) {
      const m = await db().collection("groups").doc(String(groupId)).collection("members").doc(String(uid)).get();
      if (m.exists && m.data()?.user_name) return m.data().user_name;
    }
    const u = await db().collection("users").doc(String(uid)).get();
    return u.exists ? (u.data()?.user_name || null) : null;
  } catch {
    return null;
  }
}

// Create a new group
export async function createGroup(req, res) {
  try {
    const { name, userId, userName, currency = "USD" } = req.body;

    if (!name || !userId) {
      return res.status(400).json({ message: "Name and userId are required" });
    }
    ensureSelf(req, userId);

    const firestore = db();
    const trimmedName = String(name).trim();
    if (!trimmedName) return res.status(400).json({ message: "Name and userId are required" });

    let attempts = 0;
    while (attempts < 10) {
      const code = generateGroupCode();
      const groupRef = firestore.collection("groups").doc();
      const codeRef = firestore.collection("groupCodes").doc(code);
      const memberRef = groupRef.collection("members").doc(String(userId));
      const userGroupRef = firestore.collection("users").doc(String(userId)).collection("groups").doc(groupRef.id);

      try {
        await firestore.runTransaction(async (tx) => {
          tx.create(codeRef, {
            group_id: groupRef.id,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
          });

          tx.create(groupRef, {
            name: trimmedName,
            code,
            created_by: String(userId),
            currency: String(currency || "USD"),
            smart_split_enabled: true,
            member_count: 1,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
          });

          tx.create(memberRef, {
            user_id: String(userId),
            user_name: userName ? String(userName).trim() : "User",
            joined_at: admin.firestore.FieldValue.serverTimestamp(),
          });

          tx.create(userGroupRef, {
            group_id: groupRef.id,
            joined_at: admin.firestore.FieldValue.serverTimestamp(),
          });

          if (userName && String(userName).trim()) {
            tx.set(
              firestore.collection("users").doc(String(userId)),
              {
                user_id: String(userId),
                user_name: String(userName).trim(),
                updated_at: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        });

        return res.status(201).json({
          id: groupRef.id,
          name: trimmedName,
          code,
          created_by: String(userId),
          currency: String(currency || "USD"),
          smart_split_enabled: true,
        });
      } catch (e) {
        // collision or transient failure
        attempts++;
      }
    }

    return res.status(500).json({ message: "Failed to generate unique code" });
  } catch (error) {
    console.log("Error creating group", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

// Join group via code
export async function joinGroup(req, res) {
  try {
    const { code, userId, userName } = req.body;

    if (!code || !userId) {
      return res.status(400).json({ message: "Code and userId are required" });
    }

    ensureSelf(req, userId);
    const firestore = db();

    const codeRef = firestore.collection("groupCodes").doc(String(code));
    let groupId = null;
    let groupName = null;

    await firestore.runTransaction(async (tx) => {
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists) {
        const err = new Error("Group not found");
        err.statusCode = 404;
        throw err;
      }

      groupId = codeSnap.data().group_id;
      const groupRef = firestore.collection("groups").doc(String(groupId));
      const groupSnap = await tx.get(groupRef);
      if (!groupSnap.exists) {
        const err = new Error("Group not found");
        err.statusCode = 404;
        throw err;
      }

      groupName = groupSnap.data().name;

      const memberRef = groupRef.collection("members").doc(String(userId));
      const memberSnap = await tx.get(memberRef);
      if (memberSnap.exists) {
        const err = new Error("Already a member of this group");
        err.statusCode = 400;
        throw err;
      }

      tx.create(memberRef, {
        user_id: String(userId),
        user_name: userName ? String(userName).trim() : "User",
        joined_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.create(firestore.collection("users").doc(String(userId)).collection("groups").doc(String(groupId)), {
        group_id: String(groupId),
        joined_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.update(groupRef, { member_count: admin.firestore.FieldValue.increment(1) });

      if (userName && String(userName).trim()) {
        tx.set(
          firestore.collection("users").doc(String(userId)),
          {
            user_id: String(userId),
            user_name: String(userName).trim(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    });

    await notifyGroupMembers(
      groupId,
      userId,
      "New Member Joined",
      `${userName || 'Someone'} joined your group '${groupName || ''}'`,
      {
        type: "member_joined",
        groupId: String(groupId),
        userId: String(userId),
        userName: userName || "User",
      }
    );

    res.status(200).json({ id: String(groupId), name: groupName, code: String(code) });
  } catch (error) {
    console.log("Error joining group", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

// Get all groups for a user
export async function getUserGroups(req, res) {
  try {
    const { userId } = req.params;

    ensureSelf(req, userId);
    const firestore = db();

    const memberships = await firestore.collection("users").doc(String(userId)).collection("groups").orderBy("joined_at", "desc").get();
    const groupIds = memberships.docs.map((d) => d.id);

    // If user has no groups, return empty array
    if (groupIds.length === 0) {
      return res.status(200).json([]);
    }

    const groupSnaps = await firestore.getAll(
      ...groupIds.map((gid) => firestore.collection("groups").doc(String(gid)))
    );

    const groups = groupSnaps
      .filter((s) => s.exists)
      .map((s) => ({ id: s.id, ...s.data() }));

    res.status(200).json(groups);
  } catch (error) {
    console.log("Error getting user groups", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

// Get group members
export async function getGroupMembers(req, res) {
  try {
    const { groupId } = req.params;

    await ensureMember(groupId, req.user.uid);
    const firestore = db();

    const snap = await firestore.collection("groups").doc(String(groupId)).collection("members").orderBy("joined_at", "asc").get();
    const members = await Promise.all(
      snap.docs.map(async (d) => {
        const data = d.data();
        const fallback = await getUserName(d.id);
        return {
          user_id: d.id,
          user_name: data.user_name || fallback || d.id,
          joined_at: data.joined_at?.toDate?.()?.toISOString?.() || null,
        };
      })
    );

    res.status(200).json(members);
  } catch (error) {
    console.log("Error getting group members", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

// Get group details
export async function getGroupById(req, res) {
  try {
    const { groupId } = req.params;

    await ensureMember(groupId, req.user.uid);
    const snap = await db().collection("groups").doc(String(groupId)).get();
    if (!snap.exists) return res.status(404).json({ message: "Group not found" });

    res.status(200).json({ id: snap.id, ...snap.data() });
  } catch (error) {
    console.log("Error getting group", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
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

    ensureSelf(req, userId);
    await ensureMember(groupId, userId);

    const groupRef = db().collection("groups").doc(String(groupId));
    const snap = await groupRef.get();
    if (!snap.exists) return res.status(404).json({ message: "Group not found" });

    await groupRef.update({ name: trimmedName, updated_at: admin.firestore.FieldValue.serverTimestamp() });
    const updated = await groupRef.get();
    res.status(200).json({ id: updated.id, ...updated.data() });
  } catch (error) {
    console.log("Error updating group", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

// Add expense to group
export async function addGroupExpense(req, res) {
  try {
    const routeGroupId = req.params.groupId;
    const { groupId, description, amount, paidBy, category, splits } = req.body;

    const effectiveGroupId = String(groupId || routeGroupId || "");

    console.log('=== addGroupExpense ===', { groupId: effectiveGroupId, description, amount, paidBy, category, splits });

    if (!effectiveGroupId || !description || amount === undefined || !paidBy || !category || !splits) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Any group member can add an expense; paidBy must be a member (validated below)
    await ensureMember(effectiveGroupId, req.user.uid);

    if (!Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({ message: "Splits must be a non-empty array" });
    }

    const amountCents = parsePositiveCents(amount);
    const splitCents = splits.map((s) => ({ userId: String(s.userId), amountCents: parsePositiveCents(s.amount) }));
    const sumCents = splitCents.reduce((sum, s) => sum + s.amountCents, 0);
    if (sumCents !== amountCents) {
      return res.status(400).json({ message: "Custom splits must sum to the expense amount" });
    }

    await ensureMember(effectiveGroupId, paidBy);

    const firestore = db();
    const groupRef = firestore.collection("groups").doc(String(effectiveGroupId));
    const expenseRef = groupRef.collection("expenses").doc();

    await firestore.runTransaction(async (tx) => {
      const groupSnap = await tx.get(groupRef);
      if (!groupSnap.exists) {
        const err = new Error("Group not found");
        err.statusCode = 404;
        throw err;
      }

      // Validate all split users are members
      for (const s of splitCents) {
        const mem = await tx.get(groupRef.collection("members").doc(String(s.userId)));
        if (!mem.exists) {
          const err = new Error("Split user not a member of this group");
          err.statusCode = 403;
          throw err;
        }
      }

      tx.create(expenseRef, {
        group_id: String(effectiveGroupId),
        description: String(description).trim(),
        amountCents,
        amount: fromCents(amountCents),
        paid_by_user_id: String(paidBy),
        created_by_user_id: String(req.user.uid),
        category: String(category).trim(),
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      for (const s of splitCents) {
        tx.create(groupRef.collection("splits").doc(), {
          expense_id: expenseRef.id,
          user_id: String(s.userId),
          from_user_id: String(s.userId),
          to_user_id: String(paidBy),
          amount_owedCents: s.amountCents,
          amount_owed: fromCents(s.amountCents),
          is_settled: false,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });

    await notifyGroupMembers(
      effectiveGroupId,
      paidBy,
      "New Expense",
      `${(await getUserName(paidBy, effectiveGroupId)) || 'Someone'} added '${String(description).trim()}' in '${(await groupRef.get()).data()?.name || 'a group'}'`,
      { type: "expense_added", groupId: String(effectiveGroupId), expenseId: expenseRef.id }
    );

    res.status(201).json({ id: expenseRef.id, group_id: String(effectiveGroupId) });
  } catch (error) {
    console.log("Error adding group expense", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

// Update/Edit expense
export async function updateGroupExpense(req, res) {
  try {
    const { expenseId } = req.params;
    const { groupId, description, amount, category, splits, userId } = req.body;

    if (!groupId) {
      return res.status(400).json({ message: "Group ID is required" });
    }

    if (userId) ensureSelf(req, userId);

    if (!description || !amount || !category || !splits) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({ message: "Splits must be a non-empty array" });
    }

    const firestore = db();
    const groupRef = firestore.collection("groups").doc(String(groupId));
    const expenseRef = groupRef.collection("expenses").doc(String(expenseId));

    const amountCents = parsePositiveCents(amount);
    const splitCents = splits.map((s) => ({ userId: String(s.userId), amountCents: parsePositiveCents(s.amount) }));
    const sumCents = splitCents.reduce((sum, s) => sum + s.amountCents, 0);
    if (sumCents !== amountCents) {
      return res.status(400).json({ message: "Custom splits must sum to the expense amount" });
    }

    const uid = req.user.uid;

    await firestore.runTransaction(async (tx) => {
      const expSnap = await tx.get(expenseRef);
      if (!expSnap.exists) {
        const err = new Error("Expense not found");
        err.statusCode = 404;
        throw err;
      }

      const exp = expSnap.data();
      if (String(exp.paid_by_user_id) !== String(uid)) {
        const err = new Error("You are not authorized to edit this expense");
        err.statusCode = 403;
        throw err;
      }

      // Validate all split users are members
      for (const s of splitCents) {
        const mem = await tx.get(groupRef.collection("members").doc(String(s.userId)));
        if (!mem.exists) {
          const err = new Error("Split user not a member of this group");
          err.statusCode = 403;
          throw err;
        }
      }

      // Existing splits
      const splitsQuery = groupRef.collection("splits").where("expense_id", "==", String(expenseId));
      const existingSplitsSnap = await tx.get(splitsQuery);
      existingSplitsSnap.docs.forEach((d) => {
        if (d.data()?.is_settled) {
          const err = new Error("Cannot edit an expense with settled splits");
          err.statusCode = 400;
          throw err;
        }
        tx.delete(d.ref);
      });

      tx.update(expenseRef, {
        description: String(description).trim(),
        category: String(category).trim(),
        amountCents,
        amount: fromCents(amountCents),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      for (const s of splitCents) {
        tx.create(groupRef.collection("splits").doc(), {
          expense_id: expenseRef.id,
          user_id: String(s.userId),
          from_user_id: String(s.userId),
          to_user_id: String(uid),
          amount_owedCents: s.amountCents,
          amount_owed: fromCents(s.amountCents),
          is_settled: false,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });

    const groupSnap = await groupRef.get();
    await notifyGroupMembers(
      groupId,
      uid,
      "Expense Updated",
      `${(await getUserName(uid, groupId)) || 'Someone'} updated '${String(description).trim()}' expense in '${groupSnap.data()?.name || 'a group'}'`,
      { type: "expense_edited", groupId: String(groupId), expenseId: String(expenseId), description: String(description).trim() }
    );

    const updated = await expenseRef.get();
    res.status(200).json({ id: updated.id, ...updated.data() });
  } catch (error) {
    console.log("Error updating group expense", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

// Get group expenses
export async function getGroupExpenses(req, res) {
  try {
    const { groupId } = req.params;

    await ensureMember(groupId, req.user.uid);
    const firestore = db();
    const groupRef = firestore.collection("groups").doc(String(groupId));
    const snap = await groupRef.collection("expenses").orderBy("created_at", "desc").get();

    const expenses = await Promise.all(
      snap.docs.map(async (d) => {
        const data = d.data();
        const payerName = (await getUserName(data.paid_by_user_id, groupId)) || data.paid_by_user_id;
        return {
          id: d.id,
          ...data,
          amount: data.amount ?? fromCents(data.amountCents),
          paid_by_user_name: payerName,
          created_at: data.created_at?.toDate?.()?.toISOString?.() || null,
        };
      })
    );

    res.status(200).json(expenses);
  } catch (error) {
    console.log("Error getting group expenses", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

// Get expense splits for a specific expense
export async function getExpenseSplits(req, res) {
  try {
    const { expenseId } = req.params;

    // Firestore needs groupId to locate the expense.
    const groupId = req.query.groupId || req.headers["x-group-id"];
    if (!groupId) {
      return res.status(400).json({ message: "Group ID is required" });
    }

    await ensureMember(groupId, req.user.uid);

    const firestore = db();
    const groupRef = firestore.collection("groups").doc(String(groupId));
    const snap = await groupRef.collection("splits").where("expense_id", "==", String(expenseId)).get();

    const splits = await Promise.all(
      snap.docs.map(async (d) => {
        const data = d.data();
        const name = (await getUserName(data.user_id, groupId)) || data.user_id;
        return {
          id: d.id,
          expense_id: data.expense_id,
          user_id: data.user_id,
          amount_owed: data.amount_owed ?? fromCents(data.amount_owedCents),
          is_settled: Boolean(data.is_settled),
          settled_at: data.settled_at?.toDate?.()?.toISOString?.() || null,
          user_name: name,
          group_id: String(groupId),
        };
      })
    );

    splits.sort((a, b) => String(a.user_name || a.user_id).localeCompare(String(b.user_name || b.user_id)));
    res.status(200).json(splits);
  } catch (error) {
    console.log("Error getting expense splits", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

// Get user's balance in a group (who owes who)
export async function getGroupBalance(req, res) {
  try {
    const { groupId, userId } = req.params;

    ensureSelf(req, userId);
    await ensureMember(groupId, userId);

    const firestore = db();
    const groupRef = firestore.collection("groups").doc(String(groupId));

    // Firestore can't aggregate/groupBy server-side; aggregate in memory.
    const owesMeSnap = await groupRef
      .collection("splits")
      .where("to_user_id", "==", String(userId))
      .where("is_settled", "==", false)
      .get();

    const iOweSnap = await groupRef
      .collection("splits")
      .where("from_user_id", "==", String(userId))
      .where("is_settled", "==", false)
      .get();

    const owesMeMap = new Map();
    for (const d of owesMeSnap.docs) {
      const data = d.data();
      const fromId = String(data.from_user_id);
      const cents = Number(data.amount_owedCents || 0);
      if (fromId === String(userId)) continue;
      owesMeMap.set(fromId, (owesMeMap.get(fromId) || 0) + cents);
    }

    const iOweMap = new Map();
    for (const d of iOweSnap.docs) {
      const data = d.data();
      const toId = String(data.to_user_id);
      const cents = Number(data.amount_owedCents || 0);
      if (toId === String(userId)) continue;
      iOweMap.set(toId, (iOweMap.get(toId) || 0) + cents);
    }

    const owesMe = await Promise.all(
      Array.from(owesMeMap.entries()).map(async ([otherId, cents]) => ({
        userId: otherId,
        userName: (await getUserName(otherId, groupId)) || otherId,
        amount: fromCents(cents),
      }))
    );

    const iOwe = await Promise.all(
      Array.from(iOweMap.entries()).map(async ([otherId, cents]) => ({
        userId: otherId,
        userName: (await getUserName(otherId, groupId)) || otherId,
        amount: fromCents(cents),
      }))
    );

    const totalPaid = owesMe.reduce((sum, o) => sum + o.amount, 0);
    const totalOwed = iOwe.reduce((sum, o) => sum + o.amount, 0);
    const netBalance = totalPaid - totalOwed;

    res.status(200).json({ totalPaid, totalOwed, netBalance, owesMe, iOwe });
  } catch (error) {
    console.log("Error getting group balance", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

// Settle up debts between two users in a group
export async function settleUp(req, res) {
  try {
    const { groupId, fromUserId, toUserId } = req.body;

    if (!groupId || !fromUserId || !toUserId) {
      return res.status(400).json({ message: "All fields are required" });
    }

    ensureSelf(req, fromUserId);
    await ensureMember(groupId, fromUserId);
    await ensureMember(groupId, toUserId);

    const firestore = db();
    const groupRef = firestore.collection("groups").doc(String(groupId));

    const splitsSnap = await groupRef
      .collection("splits")
      .where("from_user_id", "==", String(fromUserId))
      .where("to_user_id", "==", String(toUserId))
      .where("is_settled", "==", false)
      .get();

    if (splitsSnap.empty) {
      return res.status(404).json({ message: "No debts to settle" });
    }

    if (splitsSnap.size > 450) {
      return res.status(400).json({ message: "Too many debts to settle at once" });
    }

    let totalCents = 0;
    const batch = firestore.batch();
    splitsSnap.docs.forEach((d) => {
      const data = d.data();
      totalCents += Number(data.amount_owedCents || 0);
      batch.update(d.ref, {
        is_settled: true,
        settled_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    const groupSnap = await groupRef.get();
    const groupName = groupSnap.exists ? groupSnap.data().name : "a group";
    const fromName = (await getUserName(fromUserId, groupId)) || "Someone";

    await notifyUser(
      toUserId,
      "Payment Received",
      `${fromName} settled up $${fromCents(totalCents).toFixed(2)} with you in '${groupName}'`,
      { type: "settled_up", groupId: String(groupId), amount: fromCents(totalCents), fromUserId: String(fromUserId) }
    );

    res.status(200).json({ message: "Successfully settled up", settledCount: splitsSnap.size });
  } catch (error) {
    console.log("Error settling up", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

// Delete expense
export async function deleteGroupExpense(req, res) {
  try {
    const { expenseId } = req.params;
    const { userId, groupId } = req.body;

    if (!expenseId) {
      return res.status(400).json({ message: "Expense ID is required" });
    }

    if (!groupId) return res.status(400).json({ message: "Group ID is required" });
    if (userId) ensureSelf(req, userId);
    const uid = req.user.uid;

    const firestore = db();
    const groupRef = firestore.collection("groups").doc(String(groupId));
    const expenseRef = groupRef.collection("expenses").doc(String(expenseId));

    const expSnap = await expenseRef.get();
    if (!expSnap.exists) return res.status(404).json({ message: "Expense not found" });
    const expense = expSnap.data();

    if (String(expense.paid_by_user_id) !== String(uid)) {
      return res.status(403).json({ message: "You are not authorized to delete this expense" });
    }

    // Ensure no settled splits exist
    const splitsSnap = await groupRef.collection("splits").where("expense_id", "==", String(expenseId)).get();
    if (splitsSnap.docs.some((d) => d.data()?.is_settled)) {
      return res.status(400).json({ message: "Cannot delete an expense with settled splits" });
    }

    const batch = firestore.batch();
    splitsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(expenseRef);
    await batch.commit();

    const groupSnap = await groupRef.get();
    await notifyGroupMembers(
      groupId,
      uid,
      "Expense Deleted",
      `${(await getUserName(uid, groupId)) || 'Someone'} deleted '${expense.description}' expense in '${groupSnap.data()?.name || 'a group'}'`,
      { type: "expense_deleted", groupId: String(groupId), description: expense.description }
    );

    res.status(200).json({ message: "Expense deleted successfully", expenseId: String(expenseId) });
  } catch (error) {
    console.log("Error deleting group expense", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

// Toggle Smart Split for a group
export async function toggleSmartSplit(req, res) {
  try {
    const { groupId, enabled } = req.body;

    if (!groupId || enabled === undefined) {
      return res.status(400).json({ message: "Group ID and enabled status are required" });
    }

    await ensureMember(groupId, req.user.uid);
    const groupRef = db().collection("groups").doc(String(groupId));
    const snap = await groupRef.get();
    if (!snap.exists) return res.status(404).json({ message: "Group not found" });

    await groupRef.update({ smart_split_enabled: Boolean(enabled) });
    res.status(200).json({ message: "Smart Split setting updated", smartSplitEnabled: Boolean(enabled) });
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

    ensureSelf(req, userId);
    await ensureMember(groupId, userId);

    const firestore = db();
    const groupRef = firestore.collection("groups").doc(String(groupId));
    const memberRef = groupRef.collection("members").doc(String(userId));
    const userGroupRef = firestore.collection("users").doc(String(userId)).collection("groups").doc(String(groupId));

    // Check for unsettled debts (two queries; Firestore doesn't support OR)
    const [fromSnap, toSnap] = await Promise.all([
      groupRef.collection("splits").where("from_user_id", "==", String(userId)).where("is_settled", "==", false).get(),
      groupRef.collection("splits").where("to_user_id", "==", String(userId)).where("is_settled", "==", false).get(),
    ]);

    if (!fromSnap.empty || !toSnap.empty) {
      return res.status(400).json({
        message: "You have unsettled expenses in this group. Please settle up before leaving.",
        hasDebts: true,
      });
    }

    const [memberSnap, groupSnap] = await Promise.all([memberRef.get(), groupRef.get()]);
    const userName = memberSnap.exists ? (memberSnap.data().user_name || "Someone") : "Someone";
    const groupName = groupSnap.exists ? (groupSnap.data().name || "a group") : "a group";
    const groupCode = groupSnap.exists ? groupSnap.data().code : null;

    await memberRef.delete();
    await userGroupRef.delete();
    await groupRef.update({ member_count: admin.firestore.FieldValue.increment(-1) });

    // Check if empty
    const remaining = await groupRef.collection("members").limit(1).get();
    if (remaining.empty) {
      // Cleanup code mapping + group
      try {
        if (groupCode) await firestore.collection("groupCodes").doc(String(groupCode)).delete();
      } catch {}

      try {
        await firestore.recursiveDelete(groupRef);
      } catch (e) {
        console.log("Group cleanup error", e);
      }

      return res.status(200).json({
        message: "Successfully left group. Group was deleted as you were the last member.",
        groupDeleted: true,
      });
    }

    await notifyGroupMembers(
      groupId,
      userId,
      "Member Left Group",
      `${userName} left '${groupName}'`,
      { type: "member_left", groupId: String(groupId), userId: String(userId), userName }
    );

    res.status(200).json({ message: "Successfully left group", groupDeleted: false });
  } catch (error) {
    console.log("Error leaving group", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}
