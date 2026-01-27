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
      user_name VARCHAR(255) NOT NULL,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, user_id)
    )`;

    // Canonical users table (display names should be resolved from here)
    await sql`CREATE TABLE IF NOT EXISTS users(
      user_id VARCHAR(255) PRIMARY KEY,
      user_name VARCHAR(255) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    // User tokens table for push notifications
    await sql`CREATE TABLE IF NOT EXISTS user_tokens(
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL UNIQUE,
      push_token VARCHAR(255) NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`;

    // Migration: Add user_name column if it doesn't exist
    try {
      await sql`ALTER TABLE group_members ADD COLUMN IF NOT EXISTS user_name VARCHAR(255) DEFAULT 'User'`;
      console.log("Migration: user_name column added/verified");
    } catch (migrationError) {
      console.log("Migration note:", migrationError.message);
    }

    // Update existing records with empty user_name
    try {
      await sql`UPDATE group_members SET user_name = 'User' WHERE user_name IS NULL OR user_name = ''`;
      console.log("Migration: Updated existing records with default user_name");
    } catch (updateError) {
      console.log("Migration update note:", updateError.message);
    }

    // Seed users table from existing group membership names (best-effort)
    try {
      await sql`
        INSERT INTO users (user_id, user_name)
        SELECT DISTINCT user_id, user_name
        FROM group_members
        WHERE user_id IS NOT NULL AND user_id <> ''
          AND user_name IS NOT NULL AND user_name <> ''
        ON CONFLICT (user_id)
        DO UPDATE SET
          user_name = EXCLUDED.user_name,
          updated_at = CURRENT_TIMESTAMP
      `;
      console.log("Migration: Seeded users table from group_members");
    } catch (seedError) {
      console.log("Migration seed note:", seedError.message);
    }

    // Migration: Add smart_split_enabled column to groups
    try {
      await sql`ALTER TABLE groups ADD COLUMN IF NOT EXISTS smart_split_enabled BOOLEAN DEFAULT TRUE`;
      console.log("Migration: smart_split_enabled column added/verified");
    } catch (migrationError) {
      console.log("Migration note:", migrationError.message);
    }

    console.log("Database initialized successfully");
  } catch (error) {
    console.log("Error initializing DB", error);
    process.exit(1); // status code 1 means failure, 0 success
  }
}