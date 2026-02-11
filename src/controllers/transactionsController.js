import admin from "firebase-admin";
import { initFirebase } from "../config/firebase.js";
import { toCents, fromCents } from "../utils/money.js";

initFirebase();

function ensureSelf(req, userId) {
  if (!req.user?.uid || String(req.user.uid) !== String(userId)) {
    const err = new Error("Forbidden");
    err.statusCode = 403;
    throw err;
  }
}

function getDb() {
  return admin.firestore();
}

export async function createTransaction(req, res) {
    try {
      const { title, amount, category, user_id } = req.body;
  
      if (!title || !user_id || !category || amount === undefined) {
        return res.status(400).json({ message: "All fields are required" });
      }
  
      ensureSelf(req, user_id);

      const amountCents = toCents(amount);
      if (amountCents === null) {
        return res.status(400).json({ message: "Invalid amount" });
      }
      if (amountCents === 0) {
        return res.status(400).json({ message: "Amount must not be zero" });
      }

      const db = getDb();
      const txnRef = db.collection("users").doc(String(user_id)).collection("transactions").doc();
      const summaryRef = db.collection("users").doc(String(user_id)).collection("meta").doc("transactionSummary");

      await db.runTransaction(async (tx) => {
        tx.create(txnRef, {
          user_id: String(user_id),
          title: String(title).trim(),
          category: String(category).trim(),
          amountCents,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        });

        const inc = admin.firestore.FieldValue.increment;
        const incomeDelta = amountCents > 0 ? amountCents : 0;
        const expensesDelta = amountCents < 0 ? amountCents : 0;

        tx.set(
          summaryRef,
          {
            balanceCents: inc(amountCents),
            incomeCents: inc(incomeDelta),
            expensesCents: inc(expensesDelta),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      res.status(201).json({
        id: txnRef.id,
        user_id: String(user_id),
        title: String(title).trim(),
        amount: fromCents(amountCents),
        category: String(category).trim(),
      });
    } catch (error) {
      console.log("Error creating the transaction", error);
      res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
    }
}  

export async function getTransactionsByUserId(req, res) {
  try {
    const { userId } = req.params;

    ensureSelf(req, userId);

    const db = getDb();
    const snap = await db
      .collection("users")
      .doc(String(userId))
      .collection("transactions")
      .orderBy("created_at", "desc")
      .get();

    const transactions = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        user_id: data.user_id,
        title: data.title,
        amount: fromCents(data.amountCents),
        category: data.category,
        created_at: data.created_at?.toDate?.()?.toISOString?.() || null,
      };
    });

    res.status(200).json(transactions);
  } catch (error) {
    console.log("Error getting the transactions", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}

export async function deleteTransaction(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ message: "Invalid transaction ID" });
      }

      const userId = req.user?.uid;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const db = getDb();
      const txnRef = db.collection("users").doc(String(userId)).collection("transactions").doc(String(id));
      const summaryRef = db.collection("users").doc(String(userId)).collection("meta").doc("transactionSummary");

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(txnRef);
        if (!snap.exists) {
          const err = new Error("Transaction not found");
          err.statusCode = 404;
          throw err;
        }

        const amountCents = Number(snap.data().amountCents || 0);

        tx.delete(txnRef);

        const inc = admin.firestore.FieldValue.increment;
        const incomeDelta = amountCents > 0 ? -amountCents : 0;
        const expensesDelta = amountCents < 0 ? -amountCents : 0;

        tx.set(
          summaryRef,
          {
            balanceCents: inc(-amountCents),
            incomeCents: inc(incomeDelta),
            expensesCents: inc(expensesDelta),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      res.status(200).json({ message: "Transaction deleted successfully" });
    } catch (error) {
      console.log("Error deleting the transaction", error);
      res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
    }
}

export async function getSummaryByUserId(req, res) {
    try {
      const { userId } = req.params;

      ensureSelf(req, userId);
      const db = getDb();
      const summaryRef = db.collection("users").doc(String(userId)).collection("meta").doc("transactionSummary");
      const snap = await summaryRef.get();
      const data = snap.exists ? snap.data() : { balanceCents: 0, incomeCents: 0, expensesCents: 0 };

      res.status(200).json({
        balance: fromCents(data.balanceCents || 0),
        income: fromCents(data.incomeCents || 0),
        expenses: fromCents(data.expensesCents || 0),
      });
    } catch (error) {
      console.log("Error gettin the summary", error);
      res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
    }
}

export async function deleteAllUserTransactions(req, res) {
  try {
    const { userId } = req.params;

    ensureSelf(req, userId);
    const db = getDb();
    const txnsCol = db.collection("users").doc(String(userId)).collection("transactions");
    await db.recursiveDelete(txnsCol);

    await db.collection("users").doc(String(userId)).collection("meta").doc("transactionSummary").set({
      balanceCents: 0,
      incomeCents: 0,
      expensesCents: 0,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({
      message: "All transactions deleted successfully",
    });
  } catch (error) {
    console.log("Error deleting user transactions", error);
    res.status(error.statusCode || 500).json({ message: error.message || "Internal server error" });
  }
}