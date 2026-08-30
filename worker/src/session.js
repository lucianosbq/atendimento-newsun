import { CONSENT_TEXT, DEPARTMENTS } from "./constants.js";
import {
  addBitrixTimelineComment,
  createBitrixSessionLead,
  getDepartmentRoute,
  isBusinessHours,
  notifyBitrixMessenger,
} from "./integrations.js";
import { encryptJson, normalizeBrazilianPhone, verifyTurnstile } from "./security.js";
import {
  HttpError,
  addDaysIso,
  cleanText,
  generateProtocol,
  hmacHex,
  nowIso,
  randomId,
} from "./utils.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Abre a conversa: valida cadastro (nome completo, e-mail, WhatsApp), gera o
// protocolo, grava a sessão com PII criptografada e cria o card no Bitrix.
export async function createChatSession({ request, env, input }) {
  if (!env.DB) throw new HttpError(503, "Banco de sessões não configurado.", "database_not_configured");
  const data = validateSessionInput(input);

  await verifyTurnstile({ token: data.turnstileToken, request, env, idempotencyKey: data.requestId });

  const protocol = generateProtocol();
  const sessionToken = randomId("sess_");
  const sessionTokenHash = await hmacHex(env.RATE_LIMIT_SALT || "development-only-salt", sessionToken);
  const sessionRowId = randomId("cs_");
  const now = nowIso();
  const retentionDays = Math.max(1, Math.min(365, Number(env.HANDOFF_RETENTION_DAYS) || 90));
  const departmentLabel = DEPARTMENTS[data.department].label;

  const encrypted = await encryptJson(
    { name: data.name, email: data.email, phone: data.phone },
    env,
    protocol
  );

  await env.DB.prepare(
    `INSERT INTO chat_sessions
     (id, protocol, session_token_hash, department, encrypted_payload, encryption_iv,
      consent_at, consent_text_version, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    sessionRowId,
    protocol,
    sessionTokenHash,
    data.department,
    encrypted.encryptedPayload,
    encrypted.iv,
    now,
    env.CONSENT_TEXT_VERSION || "2026-08-30-v1",
    now,
    now,
    addDaysIso(retentionDays)
  ).run();

  const route = getDepartmentRoute(env, data.department);
  const session = {
    protocol,
    department: data.department,
    departmentLabel,
    name: data.name,
    email: data.email,
    phone: data.phone,
    organization: "",
    consentAt: now,
    consentTextVersion: env.CONSENT_TEXT_VERSION || "2026-08-30-v1",
  };

  const bitrix = await createBitrixSessionLead(env, route, session).catch((error) => ({
    ok: false,
    channel: "bitrix",
    error: cleanText(error?.message || error, 300),
  }));

  let bitrixNotified = false;
  if (bitrix.ok && bitrix.entityId) {
    const im = await notifyBitrixMessenger(
      env,
      route,
      [
        `Novo atendimento IA em andamento — ${departmentLabel}`,
        `Protocolo: ${protocol}`,
        `Visitante: ${data.name}`,
        `A conversa está sendo conduzida pela IA. O card do lead já foi criado no CRM.`,
      ].join("\n")
    ).catch(() => ({ ok: false }));
    bitrixNotified = Boolean(im.ok);
  }

  await env.DB.prepare(
    "UPDATE chat_sessions SET bitrix_entity_id = ?, bitrix_notified = ?, updated_at = ? WHERE id = ?"
  ).bind(bitrix.entityId || null, bitrixNotified ? 1 : 0, nowIso(), sessionRowId).run();

  return {
    ok: true,
    protocol,
    sessionToken,
    department: data.department,
    departmentLabel,
    bitrixCardCreated: Boolean(bitrix.ok),
    withinBusinessHours: isBusinessHours(env),
    message: `Cadastro registrado. Seu protocolo é ${protocol}. Pode perguntar à vontade — quando precisar de uma pessoa, o setor ${departmentLabel} será acionado com todo o histórico.`,
  };
}

// Recupera a sessão pelo token seguro. Devolve null quando não existe/expirou.
export async function findSessionByToken(env, sessionToken) {
  const token = cleanText(sessionToken, 160);
  if (!token || !env.DB) return null;
  const hash = await hmacHex(env.RATE_LIMIT_SALT || "development-only-salt", token);
  const row = await env.DB.prepare(
    `SELECT id, protocol, department, encrypted_payload, encryption_iv, consent_at,
            consent_text_version, bitrix_entity_id
     FROM chat_sessions WHERE session_token_hash = ? AND expires_at >= ?`
  ).bind(hash, nowIso()).first();
  return row || null;
}

export async function appendSessionTimeline(env, sessionRow, text) {
  if (!sessionRow?.bitrix_entity_id) return { ok: false, skipped: true };
  return addBitrixTimelineComment(env, { entityId: sessionRow.bitrix_entity_id, text });
}

function validateSessionInput(input) {
  const department = cleanText(input?.department, 40);
  const name = cleanText(input?.name, 100);
  const email = cleanText(input?.email, 160).toLowerCase();
  const phone = normalizeBrazilianPhone(input?.phone);
  const consentText = cleanText(input?.consentText, 500);
  const requestId = cleanText(input?.requestId, 120) || crypto.randomUUID();
  const turnstileToken = cleanText(input?.turnstileToken, 4096);

  if (!DEPARTMENTS[department]) throw new HttpError(400, "Departamento inválido.", "invalid_department");
  if (name.length < 5 || !name.includes(" ")) {
    throw new HttpError(400, "Informe seu nome completo (nome e sobrenome).", "invalid_name");
  }
  if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, "Informe um e-mail válido.", "invalid_email");
  if (!phone) throw new HttpError(400, "Informe um WhatsApp válido com DDD.", "invalid_phone");
  if (input?.consent !== true || consentText !== CONSENT_TEXT) {
    throw new HttpError(400, "O consentimento explícito é obrigatório para iniciar o atendimento.", "consent_required");
  }
  return { department, name, email, phone, requestId, turnstileToken };
}
