import { DEPARTMENTS } from "./constants.js";
import {
  addBitrixTimelineComment,
  getDepartmentRoute,
  notifyBitrixMessenger,
} from "./integrations.js";
import { findSessionByToken } from "./session.js";
import {
  HttpError,
  addDaysIso,
  cleanText,
  hmacHex,
  nowIso,
  randomId,
  timingSafeEqualString,
} from "./utils.js";

const ALLOWED_TYPES = Object.freeze({
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
});
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES_PER_SESSION = 5;

// Recebe a conta de energia (PDF, JPG ou PNG) enviada pelo clipe do chat,
// guarda no R2, registra no D1 e anexa o link seguro no card do Bitrix.
export async function handleAccountUpload({ request, env }) {
  if (!env.DB) throw new HttpError(503, "Banco de dados não configurado.", "database_not_configured");
  if (!env.UPLOADS) throw new HttpError(503, "Armazenamento de arquivos não configurado.", "storage_not_configured");

  let form;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Envie o arquivo como multipart/form-data.", "invalid_form");
  }

  const sessionToken = cleanText(form.get("sessionToken"), 160);
  const session = await findSessionByToken(env, sessionToken);
  if (!session) throw new HttpError(403, "Sessão inválida ou expirada. Recarregue a página e refaça o cadastro.", "invalid_session");

  const file = form.get("file");
  if (!file || typeof file === "string" || !file.size) {
    throw new HttpError(400, "Selecione um arquivo PDF, JPG ou PNG.", "missing_file");
  }
  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    throw new HttpError(400, "Formato não aceito. Envie a conta em PDF, JPG ou PNG.", "invalid_file_type");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new HttpError(413, "O arquivo excede o limite de 8 MB. Envie uma foto menor ou o PDF da conta.", "file_too_large");
  }

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM session_uploads WHERE session_id = ?"
  ).bind(session.id).first();
  if (Number(countRow?.total || 0) >= MAX_FILES_PER_SESSION) {
    throw new HttpError(429, "Limite de arquivos desta conversa atingido. O time já tem o que precisa.", "upload_limit");
  }

  const uploadId = randomId("up_").replaceAll("-", "");
  const filename = sanitizeFilename(file.name, extension);
  const r2Key = `contas/${session.protocol}/${uploadId}.${extension}`;
  await env.UPLOADS.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  const now = nowIso();
  const retentionDays = Math.max(1, Math.min(365, Number(env.HANDOFF_RETENTION_DAYS) || 90));
  await env.DB.prepare(
    `INSERT INTO session_uploads (id, session_id, protocol, filename, content_type, size_bytes, r2_key, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(uploadId, session.id, session.protocol, filename, file.type, file.size, r2Key, now, addDaysIso(retentionDays)).run();

  const token = await hmacHex(env.RATE_LIMIT_SALT || "development-only-salt", `file:${uploadId}`);
  const origin = new URL(request.url).origin;
  const secureLink = `${origin}/v1/file/${uploadId}?t=${token}`;
  const departmentLabel = DEPARTMENTS[session.department]?.label || session.department;
  const sizeKb = Math.max(1, Math.round(file.size / 1024));

  if (session.bitrix_entity_id) {
    await addBitrixTimelineComment(env, {
      entityId: session.bitrix_entity_id,
      text: [
        `📎 Conta de energia recebida pelo atendimento IA — protocolo ${session.protocol}`,
        `Arquivo: ${filename} (${sizeKb} KB, ${file.type})`,
        `Download seguro: ${secureLink}`,
        `O link expira junto com a retenção do atendimento (${retentionDays} dias).`,
      ].join("\n"),
    }).catch(() => null);
  }
  const route = getDepartmentRoute(env, session.department);
  await notifyBitrixMessenger(
    env,
    route,
    [
      `Conta de energia recebida — ${departmentLabel}`,
      `Protocolo: ${session.protocol}`,
      `Arquivo: ${filename} (${sizeKb} KB)`,
      `Download: ${secureLink}`,
    ].join("\n")
  ).catch(() => null);

  return {
    ok: true,
    fileId: uploadId,
    filename,
    message: "Conta recebida com sucesso. Ela já está anexada ao seu protocolo e o time usará exclusivamente para a análise de consumo, distribuidora e tarifa.",
  };
}

// Download pelo funcionário a partir do link no card. Protegido por token
// HMAC não adivinhável; sem exigência de Origin porque abre direto no navegador.
export async function handleFileDownload(env, uploadId, token) {
  if (!env.DB || !env.UPLOADS) throw new HttpError(503, "Armazenamento não configurado.", "storage_not_configured");
  const id = cleanText(uploadId, 80);
  const expected = await hmacHex(env.RATE_LIMIT_SALT || "development-only-salt", `file:${id}`);
  if (!token || !timingSafeEqualString(String(token), expected)) {
    throw new HttpError(403, "Link inválido ou expirado.", "invalid_file_token");
  }
  const row = await env.DB.prepare(
    "SELECT filename, content_type, r2_key, expires_at FROM session_uploads WHERE id = ?"
  ).bind(id).first();
  if (!row || row.expires_at < nowIso()) throw new HttpError(404, "Arquivo não encontrado ou expirado.", "file_not_found");

  const object = await env.UPLOADS.get(row.r2_key);
  if (!object) throw new HttpError(404, "Arquivo não encontrado.", "file_not_found");

  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": row.content_type,
      "content-disposition": `attachment; filename="${row.filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function cleanupExpiredUploads(env) {
  if (!env.DB || !env.UPLOADS) return;
  const now = nowIso();
  const rows = await env.DB.prepare(
    "SELECT id, r2_key FROM session_uploads WHERE expires_at < ? LIMIT 50"
  ).bind(now).all();
  for (const row of rows?.results || []) {
    await env.UPLOADS.delete(row.r2_key).catch(() => null);
    await env.DB.prepare("DELETE FROM session_uploads WHERE id = ?").bind(row.id).run();
  }
}

function sanitizeFilename(name, extension) {
  const base = cleanText(name, 120)
    .replace(/[^\p{L}\p{N}._ -]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/"+/g, "") || `conta.${extension}`;
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}
