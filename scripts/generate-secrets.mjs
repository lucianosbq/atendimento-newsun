import { randomBytes } from "node:crypto";

const base64 = (size) => randomBytes(size).toString("base64");
const hex = (size) => randomBytes(size).toString("hex");

console.log("PII_ENCRYPTION_KEY=" + base64(32));
console.log("RATE_LIMIT_SALT=" + hex(32));
console.log("ADMIN_INGEST_TOKEN=" + hex(32));
console.log("META_WEBHOOK_VERIFY_TOKEN=" + hex(24));
console.log("N8N_SHARED_SECRET=" + hex(32));
