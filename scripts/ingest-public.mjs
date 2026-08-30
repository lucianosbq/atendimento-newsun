import { readFile } from "node:fs/promises";
import process from "node:process";

const file = process.argv[2] || "knowledge/public/seed-public.json";
const apiBase = String(process.env.NEWSUN_API_URL || "").replace(/\/$/, "");
const token = process.env.NEWSUN_ADMIN_INGEST_TOKEN || "";

if (!apiBase || !token) {
  console.error("Defina NEWSUN_API_URL e NEWSUN_ADMIN_INGEST_TOKEN.");
  process.exit(1);
}

const raw = JSON.parse(await readFile(file, "utf8"));
const documents = Array.isArray(raw) ? raw : raw.documents;
if (!Array.isArray(documents) || !documents.length) {
  console.error("Nenhum documento encontrado.");
  process.exit(1);
}

for (const document of documents) {
  if (document.visibility !== "public") throw new Error(`${document.sourceId}: visibility deve ser public`);
  if (!document.approvedAt || /PENDENTE|SUBSTITUIR/i.test(document.approvedBy || "")) {
    throw new Error(`${document.sourceId}: aprovação humana ainda está pendente`);
  }
}

let failures = 0;
for (const document of documents) {
  const response = await fetch(`${apiBase}/v1/admin/knowledge`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(document),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    failures += 1;
    console.error(`ERRO ${document.sourceId}:`, data.error || response.status);
  } else {
    console.log(`OK ${document.sourceId}: ${data.chunks} chunks; mutation=${data.mutationId || "n/a"}`);
  }
}

if (failures) process.exit(1);
