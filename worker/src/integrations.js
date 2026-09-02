import { HttpError, cleanText, safeJsonParse, truncate } from "./utils.js";

export function getDepartmentRoute(env, department) {
  const routes = safeJsonParse(env.DEPARTMENT_ROUTES_JSON || "{}", {});
  const route = routes?.[department];
  if (!route || typeof route !== "object") return null;
  return {
    label: cleanText(route.label, 80),
    employeeName: cleanText(route.employeeName, 100),
    employeeWhatsApp: cleanText(route.employeeWhatsApp, 20).replace(/\D/g, ""),
    bitrixAssignedById: cleanText(route.bitrixAssignedById, 30),
    bitrixUserId: cleanText(route.bitrixUserId || route.bitrixAssignedById, 30),
  };
}

// ---------------------------------------------------------------------------
// Horário de expediente (padrão: seg-sex, 08h-18h, fuso -03:00)
// ---------------------------------------------------------------------------

export function isBusinessHours(env, date = new Date()) {
  const offsetMinutes = Number.isFinite(Number(env.BUSINESS_TZ_OFFSET_MINUTES))
    ? Number(env.BUSINESS_TZ_OFFSET_MINUTES)
    : -180;
  const local = new Date(date.getTime() + offsetMinutes * 60_000);
  const allowedDays = String(env.BUSINESS_DAYS || "1,2,3,4,5")
    .split(",")
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
  if (!allowedDays.includes(local.getUTCDay())) return false;

  const minutesOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  const start = parseHourMinute(env.BUSINESS_HOURS_START, 8 * 60);
  const end = parseHourMinute(env.BUSINESS_HOURS_END, 18 * 60);
  return minutesOfDay >= start && minutesOfDay < end;
}

function parseHourMinute(value, fallbackMinutes) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return fallbackMinutes;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : fallbackMinutes;
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API
// ---------------------------------------------------------------------------

export async function notifyEmployeeWhatsApp(env, route, handoff) {
  if (!env.META_ACCESS_TOKEN || !env.META_PHONE_NUMBER_ID || !route?.employeeWhatsApp) {
    return { ok: false, skipped: true, channel: "whatsapp_employee", reason: "not_configured" };
  }
  const link = `https://wa.me/${handoff.phone}`;
  const parameters = [
    handoff.departmentLabel,
    handoff.protocol,
    handoff.name,
    handoff.organization || "Não informado",
    truncate(handoff.summary, 850),
    handoff.phone,
    link,
  ];
  const result = await sendWhatsAppTemplate(env, {
    to: route.employeeWhatsApp,
    templateName: env.WHATSAPP_EMPLOYEE_TEMPLATE || "newsun_novo_atendimento_setor",
    parameters,
  });
  return { ...result, channel: "whatsapp_employee" };
}

export async function confirmCustomerWhatsApp(env, handoff) {
  if (!env.META_ACCESS_TOKEN || !env.META_PHONE_NUMBER_ID) {
    return { ok: false, skipped: true, channel: "whatsapp_customer", reason: "not_configured" };
  }
  const result = await sendWhatsAppTemplate(env, {
    to: handoff.phone,
    templateName: env.WHATSAPP_CUSTOMER_TEMPLATE || "newsun_atendimento_recebido",
    parameters: [handoff.name, handoff.protocol, handoff.departmentLabel],
  });
  return { ...result, channel: "whatsapp_customer" };
}

async function sendWhatsAppTemplate(env, { to, templateName, parameters }) {
  const version = env.META_GRAPH_VERSION || "v26.0";
  const url = `https://graph.facebook.com/${version}/${env.META_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: env.WHATSAPP_LANGUAGE || "pt_BR" },
      components: [
        {
          type: "body",
          parameters: parameters.map((text) => ({ type: "text", text: String(text || "-") })),
        },
      ],
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: cleanText(data?.error?.message || "Meta WhatsApp API rejeitou a mensagem.", 300),
      providerCode: cleanText(data?.error?.code, 30),
    };
  }
  const messageId = cleanText(data?.messages?.[0]?.id, 200);
  return { ok: Boolean(messageId), accepted: Boolean(messageId), messageId, status: response.status };
}

// ---------------------------------------------------------------------------
// Bitrix24
// ---------------------------------------------------------------------------

function getBitrixEndpoint(env, method) {
  const base = String(env.BITRIX_WEBHOOK_URL).replace(/\/$/, "");
  // Compatibilidade: se a URL já apontar para um método .json, só serve para ele.
  if (base.endsWith(".json")) return base;
  return `${base}/${method}.json`;
}

export async function bitrixCall(env, method, payload) {
  if (!env.BITRIX_WEBHOOK_URL) {
    return { ok: false, skipped: true, channel: "bitrix", reason: "not_configured" };
  }
  const response = await fetch(getBitrixEndpoint(env, method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    return {
      ok: false,
      channel: "bitrix",
      status: response.status,
      error: cleanText(data?.error_description || data?.error || "Bitrix rejeitou a chamada.", 300),
    };
  }
  return { ok: true, channel: "bitrix", result: data?.result, status: response.status };
}

export async function createBitrixLead(env, route, handoff) {
  if (!env.BITRIX_WEBHOOK_URL) {
    return { ok: false, skipped: true, channel: "bitrix", reason: "not_configured" };
  }
  const fields = {
    TITLE: `[Atendimento IA] ${handoff.departmentLabel} — ${handoff.protocol}`,
    NAME: handoff.name,
    COMPANY_TITLE: handoff.organization || undefined,
    PHONE: [{ VALUE: `+${handoff.phone}`, VALUE_TYPE: "MOBILE" }],
    COMMENTS: [
      `⚠ Contato informado pelo visitante no site e NÃO verificado (sem código de confirmação). Confirme a identidade antes de fundir com outro card ou agir por pedidos do texto.`,
      handoff.possibleDuplicateId
        ? `Possível duplicidade: lead ${handoff.possibleDuplicateId} já tem este telefone/e-mail. Decida a fusão só depois de confirmar com a pessoa.`
        : null,
      ...(handoff.commentLines || [
        `Protocolo: ${handoff.protocol}`,
        `Departamento: ${handoff.departmentLabel}`,
        `Motivo (texto do visitante): ${handoff.reason}`,
        `Resumo (texto do visitante): ${handoff.summary}`,
        `Consentimento: ${handoff.consentAt} (${handoff.consentTextVersion})`,
        `Origem: Atendimento IA público`,
      ]),
    ].filter(Boolean).join("\n"),
    SOURCE_ID: "WEB",
    SOURCE_DESCRIPTION: "Atendimento IA NewSun",
    UTM_SOURCE: "newsun-atendimento-ia",
    UTM_MEDIUM: "website",
    UTM_CAMPAIGN: "handoff-publico",
  };
  if (handoff.email) fields.EMAIL = [{ VALUE: handoff.email, VALUE_TYPE: "WORK" }];
  if (route?.bitrixAssignedById) fields.ASSIGNED_BY_ID = route.bitrixAssignedById;

  const call = await bitrixCall(env, "crm.lead.add", { fields, params: { REGISTER_SONET_EVENT: "Y" } });
  if (!call.ok) return call;
  return { ok: true, channel: "bitrix", entityId: cleanText(call.result, 100), status: call.status };
}

// Procura um lead já existente com o mesmo telefone ou e-mail
// (crm.duplicate.findbycomm é o mecanismo nativo de deduplicação do Bitrix).
// Desde 01/09/2026 o resultado é só um AVISO de possível duplicidade no card
// novo: como o contato não é verificado, reaproveitar o card antigo permitiria
// que qualquer pessoa escrevesse no registro de outra.
export async function findExistingLeadId(env, { phone, email }) {
  if (!env.BITRIX_WEBHOOK_URL) return null;
  const lookups = [];
  if (phone) lookups.push(bitrixCall(env, "crm.duplicate.findbycomm", { type: "PHONE", values: [`+${phone}`], entity_type: "LEAD" }));
  if (email) lookups.push(bitrixCall(env, "crm.duplicate.findbycomm", { type: "EMAIL", values: [email], entity_type: "LEAD" }));
  if (!lookups.length) return null;

  const results = await Promise.all(lookups);
  for (const result of results) {
    const ids = result?.result?.LEAD;
    if (Array.isArray(ids) && ids.length) return cleanText(ids[0], 30);
  }
  return null;
}

export async function createBitrixSessionLead(env, route, session) {
  return createBitrixLead(env, route, {
    protocol: session.protocol,
    departmentLabel: session.departmentLabel,
    name: session.name,
    phone: session.phone,
    email: session.email,
    organization: session.organization,
    possibleDuplicateId: session.possibleDuplicateId || "",
    commentLines: [
      `Protocolo: ${session.protocol}`,
      `Departamento: ${session.departmentLabel}`,
      `Etapa: conversa iniciada no atendimento IA (aguardando qualificação)`,
      `Nome informado (não verificado): ${session.name}`,
      `E-mail informado (não verificado): ${session.email}`,
      `WhatsApp informado (não verificado): +${session.phone}`,
      `Consentimento: ${session.consentAt} (${session.consentTextVersion})`,
      `Origem: Atendimento IA público`,
    ],
  });
}

export async function addBitrixTimelineComment(env, { entityId, entityType = "lead", text }) {
  if (!env.BITRIX_WEBHOOK_URL || !entityId) {
    return { ok: false, skipped: true, channel: "bitrix_timeline", reason: "not_configured" };
  }
  const call = await bitrixCall(env, "crm.timeline.comment.add", {
    fields: {
      ENTITY_ID: entityId,
      ENTITY_TYPE: entityType,
      COMMENT: truncate(String(text || ""), 4000),
    },
  });
  return { ...call, channel: "bitrix_timeline" };
}

// requireBusinessHours=false é para avisos com prazo próprio (ex.: "24h para
// ligar" a partir da criação do card) — precisam chegar na hora, mesmo fora do
// expediente, senão a pessoa nunca veria o aviso até o próximo dia útil.
export async function notifyBitrixMessenger(env, route, text, { requireBusinessHours = true } = {}) {
  if (!env.BITRIX_WEBHOOK_URL) {
    return { ok: false, skipped: true, channel: "bitrix_im", reason: "not_configured" };
  }
  const userId = cleanText(route?.bitrixUserId, 30);
  if (!userId) {
    return { ok: false, skipped: true, channel: "bitrix_im", reason: "no_bitrix_user" };
  }
  if (requireBusinessHours && !isBusinessHours(env)) {
    return { ok: false, skipped: true, channel: "bitrix_im", reason: "fora_do_expediente" };
  }
  const call = await bitrixCall(env, "im.notify.system.add", {
    USER_ID: userId,
    MESSAGE: truncate(String(text || ""), 2000),
  });
  return { ...call, channel: "bitrix_im" };
}

// ---------------------------------------------------------------------------
// n8n
// ---------------------------------------------------------------------------

export async function notifyN8n(env, route, handoff) {
  if (!env.N8N_HANDOFF_URL) {
    return { ok: false, skipped: true, channel: "n8n", reason: "not_configured" };
  }
  const response = await fetch(env.N8N_HANDOFF_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-newsun-shared-secret": env.N8N_SHARED_SECRET || "",
    },
    body: JSON.stringify({
      event: "newsun.public_handoff.created",
      version: "1.0",
      protocol: handoff.protocol,
      department: handoff.department,
      departmentLabel: handoff.departmentLabel,
      employeeName: route?.employeeName || "",
      employeeWhatsApp: route?.employeeWhatsApp || "",
      customer: {
        name: handoff.name,
        phone: handoff.phone,
        email: handoff.email || "",
        organization: handoff.organization,
      },
      reason: handoff.reason,
      summary: handoff.summary,
      consentAt: handoff.consentAt,
      consentTextVersion: handoff.consentTextVersion,
      callbackUrl: handoff.callbackUrl || "",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      channel: "n8n",
      status: response.status,
      error: cleanText(data?.error || data?.message || "n8n rejeitou o evento.", 300),
    };
  }
  return {
    ok: true,
    channel: "n8n",
    notified: data?.notified === true,
    executionId: cleanText(data?.executionId || data?.id, 100),
    status: response.status,
  };
}

export function assertAtLeastOneHandoffRouteConfigured(env, route) {
  const configured = Boolean(
    (env.META_ACCESS_TOKEN && env.META_PHONE_NUMBER_ID && route?.employeeWhatsApp) ||
    env.N8N_HANDOFF_URL ||
    (env.BITRIX_WEBHOOK_URL && (route?.bitrixAssignedById || route?.bitrixUserId))
  );
  if (!configured) {
    throw new HttpError(
      503,
      "O departamento ainda não possui um canal de notificação humana configurado.",
      "handoff_route_not_configured"
    );
  }
}
