import admin, { ServiceAccount } from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function loadServiceAccount(): ServiceAccount {
  // Production / CI: full JSON stored as a base64-encoded env var.
  // Generate with: node -e "console.log(Buffer.from(fs.readFileSync('src/config/serviceAccountKey.json')).toString('base64'))"
  // Then set FIREBASE_SERVICE_ACCOUNT_B64=<output> in your deployment environment.
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (b64) {
    try {
      return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as ServiceAccount;
    } catch {
      throw new Error("[Firebase] FIREBASE_SERVICE_ACCOUNT_B64 is set but could not be parsed. Ensure it is valid base64-encoded JSON.");
    }
  }

  // Local development fallback: read from file.
  // This file must NOT be committed — it is already in .gitignore.
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, "serviceAccountKey.json"),
    path.resolve(moduleDir, "../../src/config/serviceAccountKey.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, "utf8")) as ServiceAccount;
    }
  }

  throw new Error(
    "[Firebase] No credentials found. Set FIREBASE_SERVICE_ACCOUNT_B64 env var, " +
    "or place serviceAccountKey.json in src/config/ for local development."
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
  });
}

export default admin;
