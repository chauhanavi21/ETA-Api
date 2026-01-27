import express from "express";
import {
  createGroup,
  joinGroup,
  getUserGroups,
  getGroupMembers,
  getGroupById,
  addGroupExpense,
  updateGroupExpense,
  deleteGroupExpense,
  getGroupExpenses,
  getExpenseSplits,
  getGroupBalance,
  settleUp,
  toggleSmartSplit,
  leaveGroup,
} from "../controllers/groupsController.js";

const router = express.Router();

// Group operations
router.post("/", createGroup);
router.post("/join", joinGroup);
router.post("/leave", leaveGroup);
router.get("/user/:userId", getUserGroups);
router.get("/:groupId", getGroupById);
router.get("/:groupId/members", getGroupMembers);

// Expense operations
router.post("/:groupId/expenses", addGroupExpense);
router.put("/expenses/:expenseId", updateGroupExpense);
router.delete("/expenses/:expenseId", deleteGroupExpense);
router.get("/:groupId/expenses", getGroupExpenses);
router.get("/expenses/:expenseId/splits", getExpenseSplits);

// Balance
router.get("/:groupId/balance/:userId", getGroupBalance);
router.post("/settle", settleUp);

// Smart Split
router.post("/smart-split/toggle", toggleSmartSplit);

export default router;
