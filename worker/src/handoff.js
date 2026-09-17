import { CONSENT_TEXT, DEPARTMENTS } from "./constants.js";
import {
  addBitrixTimelineComment,
  assertAtLeastOneHandoffRouteConfigured,
  confirmCustomerWhatsApp,
  createBitrixLead,
  findExistingLeadId,
  getDepartmentRoute,
  notifyBitrixMessenger,
  notifyEmployeeWhatsApp,
  notifyN8n,
} from "./integrations.js";
import { findSessionByToken } from "./session.js";
import {
  encryptJson,
  normalizeBrazilianPhone,
  redactPii,
  verifyTurnstile,
} from "./security.js";
import {
  HttpError,
  addDaysIso,
  cleanText,
  generateProtocol,
  hmacHex,
  nowIso,
  randomId,
  safeJsonParse,
  timingSafeEqualString,
  truncate,
} from "./utils.js";

export async function createHandoff({ request, env, input }) {
  if (!env.DB) throw new HttpError(503, "Banco de protocolos não configurado.", "database_not_configured");
  const data = validateHandoffInput(input);
  const route = getDepartmentRoute(env, data.department);
  assertAtLeastOneHandoffRouteConfigured(env, route);

  const requestId = cleanText(data.requestId, 120) || crypto.randomUUID();
  const idempotencyKey = await hmacHex(env.RATE_LIMIT_SALT || "development-only-salt", `handoff:${requestId}`);
  const cached = await getIdempotentResponse(env, idempotencyKey);
  if (cached) return cached;

  // Sessão aberta no cadastro inicial: já passou pelo Turnstile e já tem
  // protocolo e card no Bitrix — o handoff reaproveita os dois.
  const sessionRow = await findSessionByToken(env, input?.sessionToken);
  if (!sessionRow) {
    await verifyTurnstile({ token: data.turnstileToken, request, env, idempotencyKey: requestId });
  }

  let protocol = sessionRow?.protocol || generateProtocol();
  const existingByProtocol = sessionRow
    ? await env.DB.prepare("SELECT id FROM handoffs WHERE protocol = ?").bind(protocol).first()
    : null;
  if (existingByProtocol?.id) protocol = generateProtocol();
  const statusToken = randomId("status_");
  const pollTokenHash = await hmacHex(env.RATE_LIMIT_SALT || "development-only-salt", statusToken);
  const handoffId = randomId("ho_");
  const now = nowIso();
  const retentionDays = Math.max(1, Math.min(365, Number(env.HANDOFF_RETENTION_DAYS) || 90));
  const expiresAt = addDaysIso(retentionDays);
  const summary = buildConversationSummary(data.history, data.reason);
  const departmentLabel = DEPARTMENTS[data.department].label;
  const sessionHash = await hmacHex(env.RATE_LIMIT_SALT || "development-only-salt", data.sessionId || requestId);
  const encrypted = await encryptJson(
    {
      name: data.name,
      phone: data.phone,
      email: data.email,
      organization: data.organization,
      reason: data.reason,
      summary,
    },
    env,
    protocol
  );

  await env.DB.prepare(
    `INSERT INTO handoffs
     (id, protocol, poll_token_hash, session_hash, department, encrypted_payload, encryption_iv, consent_at,
      consent_text_version, status, notification_state, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', 'pending', ?, ?, ?)`
  ).bind(
    handoffId,
    protocol,
    pollTokenHash,
    sessionHash,
    data.department,
    encrypted.encryptedPayload,
    encrypted.iv,
    now,
    env.CONSENT_TEXT_VERSION || "2026-08-30-v1",
    now,
    now,
    expiresAt
  ).run();
  await addHandoffEvent(env, handoffId, "handoff_created", { department: data.department });

  const handoff = {
    id: handoffId,
    protocol,
    department: data.department,
    departmentLabel,
    name: data.name,
    phone: data.phone,
    email: data.email,
    organization: data.organization,
    reason: data.reason,
    summary,
    consentAt: now,
    consentTextVersion: env.CONSENT_TEXT_VERSION || "2026-08-30-v1",
  };

  const results = await Promise.all([
    notifyEmployeeWhatsApp(env, route, handoff).catch((error) => integrationFailure("whatsapp_employee", error)),
    registerHandoffInBitrix(env, route, handoff, sessionRow).catch((error) => integrationFailure("bitrix", error)),
    notifyN8n(env, route, handoff).catch((error) => integrationFailure("n8n", error)),
    notifyBitrixMessenger(
      env,
      route,
      [
        `Encaminhamento humano solicitado — ${departmentLabel}`,
        `Protocolo: ${protocol}`,
        `Visitante (nome informado por ele, não verificado): ${data.name}`,
        `WhatsApp informado (não verificado): https://wa.me/${data.phone}`,
        `Resumo do que o visitante quer saber (texto dele, não verificado — confirme antes de agir):`,
        summary,
      ].join("\n")
    ).catch((error) => integrationFailure("bitrix_im", error)),
  ]);

  const employeeWhatsApp = results.find((item) => item.channel === "whatsapp_employee");
  const bitrix = results.find((item) => item.channel === "bitrix");
  const n8n = results.find((item) => item.channel === "n8n");
  const bitrixIm = results.find((item) => item.channel === "bitrix_im");
  const successful = results.filter((item) => item.ok);
  // O card no Bitrix (criado/atualizado) já é notificação real e verificável do setor —
  // não depende do WhatsApp Business (Meta) nem do n8n estarem configurados.
  const notificationAccepted = Boolean(
    employeeWhatsApp?.ok || (n8n?.ok && n8n?.notified === true) || bitrix?.ok || bitrixIm?.ok
  );

  if (!notificationAccepted) {
    const safeErrors = results
      .filter((item) => !item.skipped)
      .map((item) => ({
        channel: item.channel,
        error: item.error || (item.channel === "n8n" ? "workflow não confirmou a notificação humana" : "falha"),
      }));
    await env.DB.prepare(
      "UPDATE handoffs SET status = 'notification_failed', notification_state = 'failed', bitrix_entity_id = ?, last_error = ?, updated_at = ? WHERE id = ?"
    ).bind(bitrix?.entityId || null, truncate(JSON.stringify(safeErrors), 900), nowIso(), handoffId).run();
    await addHandoffEvent(env, handoffId, "notification_failed", { channels: safeErrors.map((item) => item.channel) });
    throw new HttpError(
      503,
      "O protocolo foi preservado, mas ainda não confirmamos o envio da notificação ao setor. Tente novamente para concluir o acionamento humano.",
      "notification_failed"
    );
  }

  const n8nConfirmed = Boolean(n8n?.ok && n8n?.notified === true);
  const bitrixConfirmed = Boolean(bitrix?.ok || bitrixIm?.ok);
  const primaryChannel = employeeWhatsApp?.ok ? "whatsapp" : n8nConfirmed ? "n8n" : "bitrix";
  const notificationState = n8nConfirmed
    ? "confirmed_by_n8n"
    : employeeWhatsApp?.ok
      ? "accepted_by_whatsapp"
      : "confirmed_by_bitrix";
  await env.DB.prepare(
    `UPDATE handoffs
     SET status = 'notified', notification_channel = ?, notification_state = ?, whatsapp_message_id = ?, bitrix_entity_id = ?, updated_at = ?
     WHERE id = ?`
  ).bind(
    primaryChannel,
    notificationState,
    employeeWhatsApp?.messageId || null,
    bitrix?.entityId || null,
    nowIso(),
    handoffId
  ).run();
  await addHandoffEvent(env, handoffId, "department_notification_accepted", {
    channels: successful.map((item) => item.channel),
    whatsappAccepted: Boolean(employeeWhatsApp?.ok),
    n8nConfirmed,
    bitrixConfirmed,
  });

  const customerConfirmation = await confirmCustomerWhatsApp(env, handoff).catch((error) => integrationFailure("whatsapp_customer", error));
  await addHandoffEvent(env, handoffId, customerConfirmation.ok ? "customer_confirmation_accepted" : "customer_confirmation_skipped_or_failed", {
    channel: "whatsapp_customer",
    accepted: Boolean(customerConfirmation.ok),
  });

  const employeeNotified = n8nConfirmed || bitrixConfirmed;
  const message = employeeNotified
    ? `Seu atendimento foi registrado. O departamento ${departmentLabel} confirmou o recebimento da notificação e do seu contato. Você não precisa manter esta página aberta.`
    : `Seu atendimento foi registrado e a notificação foi aceita para envio ao departamento ${departmentLabel}. Estamos confirmando a entrega antes de liberar o fechamento desta página.`;

  const response = {
    ok: true,
    ticketId: protocol,
    statusToken,
    employeeNotified,
    notificationAccepted: true,
    notificationState,
    customerConfirmationAccepted: Boolean(customerConfirmation.ok),
    message,
  };
  await saveIdempotentResponse(env, idempotencyKey, response);
  return response;
}

export async function getHandoffStatus(env, { protocol, statusToken }) {
  if (!env.DB) throw new HttpError(503, "Banco de protocolos não configurado.", "database_not_configured");
  const ticket = cleanText(protocol, 80);
  const token = cleanText(statusToken, 160);
  if (!ticket || !token) throw new HttpError(400, "Protocolo e token de status são obrigatórios.", "invalid_status_request");

  const row = await env.DB.prepare(
    "SELECT poll_token_hash, department, status, notification_state, updated_at FROM handoffs WHERE protocol = ?"
  ).bind(ticket).first();
  if (!row?.poll_token_hash) throw new HttpError(404, "Protocolo não encontrado.", "handoff_not_found");

  const providedHash = await hmacHex(env.RATE_LIMIT_SALT || "development-only-salt", token);
  if (!timingSafeEqualString(providedHash, row.poll_token_hash)) {
    throw new HttpError(403, "Token de status inválido.", "invalid_status_token");
  }

  const state = cleanText(row.notification_state, 40);
  // "accepted_by_whatsapp" fica de fora de propósito: a Meta aceitou o ENVIO, mas a
  // entrega ao funcionário ainda não foi confirmada — não libera fechar a página.
  const employeeNotified = ["delivered", "read", "confirmed_by_n8n", "confirmed_by_bitrix"].includes(state);
  const failed = row.status === "notification_failed" || state === "failed";
  const departmentLabel = DEPARTMENTS[row.department]?.label || "responsável";
  const message = employeeNotified
    ? `O departamento ${departmentLabel} confirmou o recebimento da notificação. Você pode fechar esta página.`
    : failed
      ? "Não foi possível confirmar a entrega da notificação. Mantenha o protocolo e tente o encaminhamento novamente."
      : `A notificação ao departamento ${departmentLabel} ainda está em trânsito. Aguarde a confirmação antes de fechar esta página.`;

  return {
    ok: true,
    ticketId: ticket,
    employeeNotified,
    failed,
    notificationState: state,
    message,
    updatedAt: row.updated_at,
  };
}

export async function updateWhatsAppStatuses(env, payload) {
  if (!env.DB) return { processed: 0 };
  const statuses = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      for (const status of change?.value?.statuses || []) {
        statuses.push({
          messageId: cleanText(status?.id, 200),
          status: cleanText(status?.status, 40),
          timestamp: cleanText(status?.timestamp, 30),
          errorCodes: Array.isArray(status?.errors) ? status.errors.map((item) => cleanText(item?.code, 30)) : [],
        });
      }
    }
  }
  let processed = 0;
  for (const status of statuses) {
    if (!status.messageId || !["sent", "delivered", "read", "failed"].includes(status.status)) continue;
    const row = await env.DB.prepare("SELECT id FROM handoffs WHERE whatsapp_message_id = ?")
      .bind(status.messageId)
      .first();
    if (!row?.id) continue;
    await env.DB.prepare(
      "UPDATE handoffs SET notification_state = ?, status = ?, last_error = ?, updated_at = ? WHERE id = ?"
    ).bind(
      status.status,
      status.status === "failed" ? "notification_failed" : "notified",
      status.errorCodes.length ? JSON.stringify(status.errorCodes) : null,
      nowIso(),
      row.id
    ).run();
    await addHandoffEvent(env, row.id, `whatsapp_${status.status}`, {
      timestamp: status.timestamp,
      errorCodes: status.errorCodes,
    });
    processed += 1;
  }
  return { processed };
}

export async function cleanupExpiredData(env) {
  if (!env.DB) return;
  const { cleanupExpiredUploads } = await import("./upload.js");
  await cleanupExpiredUploads(env).catch(() => null);
  const now = nowIso();
  const epoch = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM handoffs WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM chat_sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM idempotency_keys WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(epoch),
  ]);
}

// Sessão com card já aberto no Bitrix (o card DESTA sessão, criado pelo token
// dela) recebe comentário na linha do tempo. Sem sessão, cria card novo. Um lead
// antigo com o mesmo telefone/e-mail NUNCA é reaproveitado: o contato não é
// verificado, e escrever no card de outra pessoa permitiria impersonação
// (revisão de segurança de 01/09/2026). A duplicidade vira só um aviso.
async function registerHandoffInBitrix(env, route, handoff, sessionRow) {
  const entityId = sessionRow?.bitrix_entity_id || null;
  if (!entityId) {
    const possibleDuplicateId = await findExistingLeadId(env, { phone: handoff.phone, email: handoff.email }).catch(() => null);
    return createBitrixLead(env, route, { ...handoff, possibleDuplicateId: possibleDuplicateId || "" });
  }
  const comment = await addBitrixTimelineComment(env, {
    entityId,
    text: [
      `Encaminhamento humano solicitado — protocolo ${handoff.protocol}`,
      `Motivo (texto do visitante, não verificado): ${redactPii(handoff.reason)}`,
      `Resumo da conversa (texto do visitante, não verificado — confirme antes de agir):`,
      handoff.summary,
      `Consentimento: ${handoff.consentAt} (${handoff.consentTextVersion})`,
    ].join("\n"),
  });
  return { ...comment, channel: "bitrix", entityId };
}

function validateHandoffInput(input) {
  const department = cleanText(input?.department, 40);
  const name = cleanText(input?.name, 100);
  const email = cleanText(input?.email, 160).toLowerCase();
  const phone = normalizeBrazilianPhone(input?.phone);
  const organization = cleanText(input?.organization, 140);
  const reason = cleanText(input?.reason || "Solicitação do visitante", 400);
  const sessionId = cleanText(input?.sessionId, 100);
  const consentText = cleanText(input?.consentText, 500);
  const requestId = cleanText(input?.requestId, 120);
  const turnstileToken = cleanText(input?.turnstileToken, 4096);
  const history = Array.isArray(input?.history) ? input.history.slice(-12) : [];

  if (!DEPARTMENTS[department]) throw new HttpError(400, "Departamento inválido.", "invalid_department");
  if (name.length < 2) throw new HttpError(400, "Informe seu nome.", "invalid_name");
  if (!phone) throw new HttpError(400, "Informe um WhatsApp válido com DDD.", "invalid_phone");
  if (input?.consent !== true || consentText !== CONSENT_TEXT) {
    throw new HttpError(400, "O consentimento explícito é obrigatório para o contato.", "consent_required");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new HttpError(400, "Informe um e-mail válido ou deixe o campo vazio.", "invalid_email");
  }
  return { department, name, email, phone, organization, reason, sessionId, requestId, turnstileToken, history };
}

function buildConversationSummary(history, reason) {
  const lines = [];
  for (const item of history || []) {
    const role = item?.role === "assistant" ? "Assistente" : "Visitante";
    const content = redactPii(cleanText(item?.content, 700));
    if (content) lines.push(`${role}: ${content}`);
  }
  const transcript = lines.slice(-8).join("\n");
  return truncate([`Motivo declarado: ${redactPii(reason)}`, transcript].filter(Boolean).join("\n"), 1700);
}

async function addHandoffEvent(env, handoffId, eventType, payload) {
  await env.DB.prepare(
    "INSERT INTO handoff_events (id, handoff_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(randomId("ev_"), handoffId, eventType, JSON.stringify(payload || {}), nowIso()).run();
}

function integrationFailure(channel, error) {
  return { ok: false, channel, error: cleanText(error?.message || error, 300) };
}

async function getIdempotentResponse(env, key) {
  const row = await env.DB.prepare(
    "SELECT response_json FROM idempotency_keys WHERE idempotency_key = ? AND expires_at >= ?"
  ).bind(key, nowIso()).first();
  return row?.response_json ? safeJsonParse(row.response_json, null) : null;
}

async function saveIdempotentResponse(env, key, response) {
  await env.DB.prepare(
    `INSERT INTO idempotency_keys (idempotency_key, response_json, created_at, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET response_json = excluded.response_json, expires_at = excluded.expires_at`
  ).bind(key, JSON.stringify(response), nowIso(), addDaysIso(1)).run();
}
