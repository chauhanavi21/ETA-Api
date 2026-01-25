import express from "express";
import {
  createGroup,
  joinGroup,
  getUserGroups,
  getGroupMembers,
  getGroupById,
  addGroupExpense,
  getGroupExpenses,
  getExpenseSplits,
  getGroupBalance,
} from "../controllers/groupsController.js";

const router = express.Router();

// Group operations
router.post("/", createGroup);
router.post("/join", joinGroup);
router.get("/user/:userId", getUserGroups);
router.get("/:groupId", getGroupById);
router.get("/:groupId/members", getGroupMembers);

// Expense operations
router.post("/:groupId/expenses", addGroupExpense);
router.get("/:groupId/expenses", getGroupExpenses);
router.get("/expenses/:expenseId/splits", getExpenseSplits);

// Balance
router.get("/:groupId/balance/:userId", getGroupBalance);

export default router;
