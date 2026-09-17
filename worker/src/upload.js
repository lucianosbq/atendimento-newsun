import { DEPARTMENTS } from "./constants.js";
import {
  addBitrixTimelineComment,
  getDepartmentRoute,
  notifyBitrixMessenger,
} from "./integrations.js";
import { findSessionByToken } from "./session.js";
import { analisarConta, calcularSimulacao } from "./simulacao.js";
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

// Recebe a conta de energia (PDF, JPG ou PNG) enviada pelo clipe do chat.
// Sempre: analisa a conta na hora (modelo de visão) e devolve a simulação de
// economia (pedido do CEO, 17/09/2026). Se o R2 estiver ligado, também guarda o
// arquivo, registra no D1 e anexa o link seguro no card do Bitrix; sem R2, o
// arquivo é processado só em memória e descartado.
export async function handleAccountUpload({ request, env }) {
  if (!env.DB) throw new HttpError(503, "Banco de dados não configurado.", "database_not_configured");
  const armazenar = Boolean(env.UPLOADS);

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

  const uploadId = randomId("up_").replaceAll("-", "");
  const filename = sanitizeFilename(file.name, extension);
  let secureLink = "";
  const retentionDays = Math.max(1, Math.min(365, Number(env.HANDOFF_RETENTION_DAYS) || 90));

  if (armazenar) {
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM session_uploads WHERE session_id = ?"
    ).bind(session.id).first();
    if (Number(countRow?.total || 0) >= MAX_FILES_PER_SESSION) {
      throw new HttpError(429, "Limite de arquivos desta conversa atingido. O time já tem o que precisa.", "upload_limit");
    }

    const r2Key = `contas/${session.protocol}/${uploadId}.${extension}`;
    await env.UPLOADS.put(r2Key, file.stream(), {
      httpMetadata: { contentType: file.type },
    });
    await env.DB.prepare(
      `INSERT INTO session_uploads (id, session_id, protocol, filename, content_type, size_bytes, r2_key, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uploadId, session.id, session.protocol, filename, file.type, file.size, r2Key, nowIso(), addDaysIso(retentionDays)).run();

    const token = await hmacHex(env.RATE_LIMIT_SALT || "development-only-salt", `file:${uploadId}`);
    secureLink = `${new URL(request.url).origin}/v1/file/${uploadId}?t=${token}`;
  }

  // Leitura da conta + simulação de economia: imagem via visão, PDF via extração
  // de texto (toMarkdown); se nada funcionar, o chat pede os dados mínimos.
  const extracao = await analisarConta(env, file);
  const simulacao = extracao?.consumoKwh
    ? calcularSimulacao(env, {
        consumoKwh: extracao.consumoKwh,
        distribuidora: extracao.distribuidora,
        uf: extracao.uf,
        cip: extracao.cip,
        tusdKwhConta: extracao.tusdUnit,
        teKwhConta: extracao.teUnit,
      })
    : null;

  const departmentLabel = DEPARTMENTS[session.department]?.label || session.department;
  const sizeKb = Math.max(1, Math.round(file.size / 1024));
  const linhasResumo = [
    `📎 Conta de energia recebida pelo atendimento IA — protocolo ${session.protocol}`,
    `Arquivo: ${filename} (${sizeKb} KB, ${file.type})`,
    secureLink
      ? `Download seguro: ${secureLink} (expira com a retenção de ${retentionDays} dias)`
      : "A conta está anexada a este comentário (armazenamento externo R2 desativado).",
  ];
  if (extracao?.consumoKwh) {
    linhasResumo.push(
      `Leitura automática: ${extracao.distribuidora || "distribuidora não identificada"}${extracao.uf ? ` (${extracao.uf})` : ""} · ${extracao.consumoKwh} kWh${extracao.mesReferencia ? ` · ref. ${extracao.mesReferencia}` : ""}${extracao.cip ? ` · CIP R$ ${extracao.cip}` : ""}`
    );
  }
  if (simulacao) {
    linhasResumo.push(
      `Simulação mostrada ao cliente: economia de R$ ${simulacao.resultado.economiaMensal.toFixed(2)}/mês (${simulacao.resultado.pctSobreElegivel}% da parcela elegível · tarifa ${simulacao.tarifa.referencia}).`
    );
  }

  // A conta vai ANEXADA ao mesmo card, como arquivo de verdade no comentário da
  // linha do tempo (pedido do Luciano, 17/09/2026) — independente do R2.
  if (session.bitrix_entity_id) {
    const anexo = { name: filename, base64: paraBase64(new Uint8Array(await file.arrayBuffer())) };
    await addBitrixTimelineComment(env, {
      entityId: session.bitrix_entity_id,
      text: linhasResumo.join("\n"),
      files: [anexo],
    }).catch(() => null);
  }
  const route = getDepartmentRoute(env, session.department);
  await notifyBitrixMessenger(
    env,
    route,
    [`Conta de energia recebida — ${departmentLabel}`, `Protocolo: ${session.protocol}`, ...linhasResumo.slice(1)].join("\n")
  ).catch(() => null);

  return {
    ok: true,
    fileId: armazenar ? uploadId : "",
    filename,
    armazenado: armazenar,
    message: armazenar
      ? "Conta recebida com sucesso. Ela já está anexada ao seu protocolo e o time usará exclusivamente para a análise de consumo, distribuidora e tarifa."
      : "Conta recebida e analisada na hora. O time usará os dados exclusivamente para a análise de consumo, distribuidora e tarifa.",
    extracao,
    simulacao,
    precisaDados: !simulacao,
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

// Converte os bytes do arquivo em base64 por blocos — String.fromCharCode com
// o arquivo inteiro estoura a pilha em anexos de vários MB.
function paraBase64(bytes) {
  let bin = "";
  const bloco = 0x8000;
  for (let i = 0; i < bytes.length; i += bloco) {
    bin += String.fromCharCode(...bytes.subarray(i, i + bloco));
  }
  return btoa(bin);
}

function sanitizeFilename(name, extension) {
  const base = cleanText(name, 120)
    .replace(/[^\p{L}\p{N}._ -]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/"+/g, "") || `conta.${extension}`;
  return base.toLowerCase().endsWith(`.${extension}`) ? base : `${base}.${extension}`;
}
