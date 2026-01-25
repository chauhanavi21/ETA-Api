import { neon } from "@neondatabase/serverless";

import "dotenv/config";


export const sql = neon(process.env.DATABASE_URL);

export async function initDB() {
  try {
    // Personal transactions table (existing)
    await sql`CREATE TABLE IF NOT EXISTS transactions(
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      title  VARCHAR(255) NOT NULL,
      amount  DECIMAL(10,2) NOT NULL,
      category VARCHAR(255) NOT NULL,
      created_at DATE NOT NULL DEFAULT CURRENT_DATE
    )`;

    // Groups table
    await sql`CREATE TABLE IF NOT EXISTS groups(
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(6) UNIQUE NOT NULL,
      created_by VARCHAR(255) NOT NULL,
      currency VARCHAR(10) DEFAULT 'USD',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;

    // Group members table
    await sql`CREATE TABLE IF NOT EXISTS group_members(
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id VARCHAR(255) NOT NULL,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, user_id)
    )`;

    // Group expenses table
    await sql`CREATE TABLE IF NOT EXISTS group_expenses(
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      description VARCHAR(255) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      paid_by_user_id VARCHAR(255) NOT NULL,
      category VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;

    // Expense splits table
    await sql`CREATE TABLE IF NOT EXISTS expense_splits(
      id SERIAL PRIMARY KEY,
      expense_id INTEGER NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
      user_id VARCHAR(255) NOT NULL,
      amount_owed DECIMAL(10,2) NOT NULL,
      is_settled BOOLEAN DEFAULT FALSE,
      settled_at TIMESTAMP,
      UNIQUE(expense_id, user_id)
    )`;

    console.log("Database initialized successfully");
  } catch (error) {
    console.log("Error initializing DB", error);
    process.exit(1); // status code 1 means failure, 0 success
  }
}