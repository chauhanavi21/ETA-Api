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

function tryParseServiceAccountFromEnv(raw) {
  if (!raw) return null;

  // Render/CI UIs sometimes wrap JSON in quotes; strip a single pair.
  let text = String(raw).trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }

  // Some UIs insert literal newlines into the JSON string (commonly within private_key).
  // JSON requires newlines inside strings to be escaped, so normalize to \n.
  const normalized = text.replace(/\r?\n/g, "\\n");

  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(normalized);
    } catch {
      return null;
    }
  }
}

function tryBuildServiceAccountFromParts() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKeyRaw) return null;

  // Render/CI env UIs often require \n instead of real newlines.
  const privateKey = String(privateKeyRaw).includes("\\n")
    ? String(privateKeyRaw).replace(/\\n/g, "\n")
    : String(privateKeyRaw);

  return {
    type: "service_account",
    project_id: String(projectId),
    client_email: String(clientEmail),
    private_key: privateKey,

    // Optional fields (helpful but not strictly required by firebase-admin)
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  };
}

function buildCredential() {
  // 1) Hosting-friendly options: env vars.

  // (a) Most reliable: base64-encoded service account JSON.
  const jsonB64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
  if (jsonB64) {
    try {
      const decoded = Buffer.from(String(jsonB64).trim(), "base64").toString("utf8");
      const parsed = tryParseServiceAccountFromEnv(decoded) || JSON.parse(decoded);
      return cert(parsed);
    } catch {
      throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 (must be base64 of JSON)");
    }
  }

  // (b) Plain JSON in env.
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    const parsed = tryParseServiceAccountFromEnv(json);
    if (parsed) return cert(parsed);
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON (must be valid JSON)");
  }

  // (c) Split into individual env vars.
  const parts = tryBuildServiceAccountFromParts();
  if (parts) {
    return cert(parts);
  }

  // 2) Other credential modes.
  const isProd = process.env.NODE_ENV === "production";
  const allowFileInProd = String(process.env.FIREBASE_ALLOW_CREDENTIAL_FILE || "").toLowerCase() === "true";
  const useAdc = String(process.env.FIREBASE_USE_ADC || "").toLowerCase() === "true";

  // In production we default to env-based credentials only unless explicitly configured.
  if (isProd && !allowFileInProd && !useAdc) {
    const err = new Error(
      "Missing Firebase Admin credentials. Set FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, FIREBASE_SERVICE_ACCOUNT_JSON, or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY (recommended for hosting). Alternatively set FIREBASE_USE_ADC=true."
    );
    err.code = "FIREBASE_CREDENTIALS_MISSING";
    throw err;
  }

  // Local/dev convenience: allow pointing to a JSON file.
  // - FIREBASE_SERVICE_ACCOUNT_PATH can be absolute or relative to process.cwd().
  // - If not set, we also try to load ./serviceAccount.json from the backend root.
  if (isProd && !allowFileInProd) {
    return applicationDefault();
  }

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
