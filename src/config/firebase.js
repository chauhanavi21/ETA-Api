import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function tryReadServiceAccountJson(filePath) {
  try {
    if (!filePath) return null;
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

function buildCredential() {
  // Preferred on hosted platforms: provide the full service account JSON as an env var.
  // Example: FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      return cert(parsed);
    } catch (e) {
      throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON (must be valid JSON)");
    }
  }

  // Local/dev convenience: allow pointing to a JSON file.
  // - FIREBASE_SERVICE_ACCOUNT_PATH can be absolute or relative to process.cwd().
  // - If not set, we also try to load ./serviceAccount.json from the backend root.
  const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : null;

  const candidatePaths = [
    envPath,
    path.resolve(process.cwd(), "serviceAccount.json"),
    path.resolve(__dirname, "../../serviceAccount.json"),
  ];

  for (const p of candidatePaths) {
    const parsed = tryReadServiceAccountJson(p);
    if (parsed) return cert(parsed);
  }

  // Fallback: use GOOGLE_APPLICATION_CREDENTIALS or platform default.
  return applicationDefault();
}

export function initFirebase() {
  if (getApps().length === 0) {
    initializeApp({ credential: buildCredential() });
  }

  const db = getFirestore();
  const auth = getAuth();

  // Firestore settings (keep defaults; set ignoreUndefinedProperties for convenience)
  db.settings({ ignoreUndefinedProperties: true });

  return { db, auth };
}
