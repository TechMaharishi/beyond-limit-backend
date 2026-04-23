import admin, { ServiceAccount } from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
let serviceAccountPath = path.resolve(moduleDir, "serviceAccountKey.json");
if (!fs.existsSync(serviceAccountPath)) {
  serviceAccountPath = path.resolve(moduleDir, "../../src/config/serviceAccountKey.json");
}
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8")) as ServiceAccount;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as ServiceAccount),
  });
}

export default admin;