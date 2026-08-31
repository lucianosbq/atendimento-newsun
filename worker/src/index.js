import { DEPARTMENTS } from "./constants.js";
import { cleanupExpiredData, createHandoff, getHandoffStatus, updateWhatsAppStatuses } from "./handoff.js";
import { appendSessionTimeline, createChatSession, findSessionByToken, markSessionAbandoned } from "./session.js";
import { handleAccountUpload, handleFileDownload } from "./upload.js";
import { answerPublicChat } from "./llm.js";
import { ingestPublicDocument } from "./rag.js";
import {
  applySecurityHeaders,
  assertOriginAllowed,
  enforceRateLimit,
  verifyMetaSignature,
} from "./security.js";
import {
  HttpError,
  clampInt,
  cleanText,
  errorJson,
  json,
  readJson,
  timingSafeEqualString,
} from "./utils.js";

export default {
  async fetch(request, env, ctx) {
    let response;
    try {
      response = await route(request, env, ctx);
    } catch (error) {
      response = handleError(error);
    }
    return applySecurityHeaders(response, request, env);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupExpiredData(env));
  },
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    assertOriginAllowed(request, env);
    return new Response(null, { status: 204 });
  }

  if (method === "GET" && url.pathname === "/health") {
    return healthResponse(env);
  }

  if (method === "GET" && url.pathname === "/v1/departments") {
    return json({
      departments: Object.entries(DEPARTMENTS).map(([id, item]) => ({
        id,
        label: item.label,
        publicScope: item.publicScope,
      })),
    });
  }

  if (method === "POST" && url.pathname === "/v1/session") {
    assertOriginAllowed(request, env);
    const rate = await enforceRateLimit({
      request,
      env,
      scope: "session",
      limit: clampInt(env.SESSION_RATE_LIMIT, 8, 1, 100),
      windowSeconds: clampInt(env.SESSION_RATE_WINDOW_SECONDS, 3600, 60, 86_400),
    });
    if (!rate.allowed) {
      throw new HttpError(429, "Muitos cadastros em sequência. Tente novamente mais tarde.", "rate_limited", {
        retryAfter: rate.retryAfter,
      });
    }
    const input = await readJson(request, 16_000);
    const result = await createChatSession({ request, env, input });
    return json(result, 201);
  }

  if (method === "POST" && url.pathname === "/v1/session/abandon") {
    // Chega por navigator.sendBeacon (text/plain, sem preflight). Sempre
    // responde ok para não revelar se o token existe.
    assertOriginAllowed(request, env);
    const rate = await enforceRateLimit({
      request,
      env,
      scope: "abandon",
      limit: 30,
      windowSeconds: 600,
    });
    if (!rate.allowed) return json({ ok: true });
    const input = await readJson(request, 2000).catch(() => ({}));
    ctx.waitUntil(markSessionAbandoned(env, input?.sessionToken).catch(() => null));
    return json({ ok: true });
  }

  if (method === "POST" && url.pathname === "/v1/upload") {
    assertOriginAllowed(request, env);
    const rate = await enforceRateLimit({
      request,
      env,
      scope: "upload",
      limit: clampInt(env.UPLOAD_RATE_LIMIT, 10, 1, 60),
      windowSeconds: clampInt(env.UPLOAD_RATE_WINDOW_SECONDS, 3600, 60, 86_400),
    });
    if (!rate.allowed) {
      throw new HttpError(429, "Muitos envios de arquivo. Aguarde alguns minutos.", "rate_limited", {
        retryAfter: rate.retryAfter,
      });
    }
    const result = await handleAccountUpload({ request, env });
    return json(result, 201);
  }

  if (method === "GET" && url.pathname.startsWith("/v1/file/")) {
    // Aberto pelo funcionário a partir do link no card do Bitrix; o token HMAC
    // na query é a proteção — navegação direta não envia Origin.
    const uploadId = url.pathname.slice("/v1/file/".length);
    return handleFileDownload(env, uploadId, url.searchParams.get("t"));
  }

  if (method === "POST" && url.pathname === "/v1/chat") {
    assertOriginAllowed(request, env);
    const rate = await enforceRateLimit({
      request,
      env,
      scope: "chat",
      limit: clampInt(env.CHAT_RATE_LIMIT, 30, 1, 300),
      windowSeconds: clampInt(env.CHAT_RATE_WINDOW_SECONDS, 600, 60, 86_400),
    });
    if (!rate.allowed) {
      throw new HttpError(429, "Limite temporário de mensagens atingido. Tente novamente em alguns minutos.", "rate_limited", {
        retryAfter: rate.retryAfter,
      });
    }
    const input = validateChatInput(await readJson(request, 28_000));
    const result = await answerPublicChat(env, input);
    ctx.waitUntil(recordChatTurnBestEffort(env, input, result));
    ctx.waitUntil(cleanupOldRateLimitsBestEffort(env));
    return json(result);
  }

  if (method === "POST" && url.pathname === "/v1/handoff") {
    assertOriginAllowed(request, env);
    const rate = await enforceRateLimit({
      request,
      env,
      scope: "handoff",
      limit: clampInt(env.HANDOFF_RATE_LIMIT, 5, 1, 50),
      windowSeconds: clampInt(env.HANDOFF_RATE_WINDOW_SECONDS, 3600, 60, 86_400),
    });
    if (!rate.allowed) {
      throw new HttpError(429, "Muitas tentativas de encaminhamento. Tente novamente mais tarde.", "rate_limited", {
        retryAfter: rate.retryAfter,
      });
    }
    const input = await readJson(request, 34_000);
    const result = await createHandoff({ request, env, input });
    return json(result, 201);
  }

  if (method === "GET" && url.pathname === "/v1/handoff/status") {
    assertOriginAllowed(request, env);
    const rate = await enforceRateLimit({
      request,
      env,
      scope: "handoff_status",
      limit: 90,
      windowSeconds: 600,
    });
    if (!rate.allowed) {
      throw new HttpError(429, "Muitas verificações de status. Aguarde alguns instantes.", "rate_limited", {
        retryAfter: rate.retryAfter,
      });
    }
    const result = await getHandoffStatus(env, {
      protocol: url.searchParams.get("ticket"),
      statusToken: url.searchParams.get("token"),
    });
    return json(result);
  }

  if (method === "POST" && url.pathname === "/v1/admin/knowledge") {
    assertAdmin(request, env);
    const input = await readJson(request, 240_000);
    const result = await ingestPublicDocument(env, input);
    return json(result, 201);
  }

  if (url.pathname === "/webhooks/whatsapp" && method === "GET") {
    return verifyWhatsAppWebhook(url, env);
  }

  if (url.pathname === "/webhooks/whatsapp" && method === "POST") {
    const rawBody = await request.text();
    const validSignature = await verifyMetaSignature(rawBody, request, env);
    if (!validSignature) throw new HttpError(401, "Assinatura do webhook inválida.", "invalid_webhook_signature");
    const payload = JSON.parse(rawBody || "{}");
    const result = await updateWhatsAppStatuses(env, payload);
    return json({ ok: true, ...result });
  }

  return errorJson("Rota não encontrada.", 404, "not_found");
}

function validateChatInput(input) {
  const department = cleanText(input?.department, 40);
  const message = cleanText(input?.message, 2000);
  const sessionId = cleanText(input?.sessionId, 100);
  const sessionToken = cleanText(input?.sessionToken, 160);
  if (!DEPARTMENTS[department]) throw new HttpError(400, "Departamento inválido.", "invalid_department");
  if (!message) throw new HttpError(400, "Escreva uma mensagem.", "empty_message");
  if (message.length < 2) throw new HttpError(400, "A mensagem é curta demais.", "message_too_short");

  const history = Array.isArray(input?.history)
    ? input.history.slice(-12).map((item) => ({
        role: item?.role === "assistant" ? "assistant" : "user",
        content: cleanText(item?.content, 1600),
      })).filter((item) => item.content)
    : [];
  return { department, message, sessionId, sessionToken, history };
}

function assertAdmin(request, env) {
  if (!env.ADMIN_INGEST_TOKEN) throw new HttpError(503, "Token de ingestão não configurado.", "admin_not_configured");
  const authorization = request.headers.get("Authorization") || "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!provided || !timingSafeEqualString(provided, env.ADMIN_INGEST_TOKEN)) {
    throw new HttpError(401, "Não autorizado.", "unauthorized");
  }
}

function verifyWhatsAppWebhook(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") || "";
  if (
    mode === "subscribe" &&
    env.META_WEBHOOK_VERIFY_TOKEN &&
    token &&
    timingSafeEqualString(token, env.META_WEBHOOK_VERIFY_TOKEN)
  ) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  throw new HttpError(403, "Verificação do webhook recusada.", "webhook_verification_failed");
}

function healthResponse(env) {
  return json({
    status: "ok",
    service: "newsun-atendimento-api",
    version: "1.0.0",
    environment: env.ENVIRONMENT || "unknown",
    model: env.MODEL_CHAT || "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    capabilities: {
      workersAI: Boolean(env.AI),
      d1: Boolean(env.DB),
      vectorize: Boolean(env.VECTORIZE),
      turnstile: Boolean(env.TURNSTILE_SECRET),
      whatsapp: Boolean(env.META_ACCESS_TOKEN && env.META_PHONE_NUMBER_ID),
      bitrix: Boolean(env.BITRIX_WEBHOOK_URL),
      n8n: Boolean(env.N8N_HANDOFF_URL),
    },
    timestamp: new Date().toISOString(),
  });
}

function handleError(error) {
  if (error instanceof HttpError) {
    const headers = {};
    if (error.status === 429 && error.details?.retryAfter) headers["retry-after"] = String(error.details.retryAfter);
    return new Response(
      JSON.stringify({ error: error.message, code: error.code, details: error.details }),
      {
        status: error.status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
      }
    );
  }
  console.error("Unhandled worker error", error?.name, error?.message);
  return errorJson(
    "O serviço ficou temporariamente indisponível. Nenhuma resposta foi inventada. Tente novamente ou use o encaminhamento humano.",
    500,
    "internal_error"
  );
}

// Grava cada pergunta/resposta na timeline do card do Bitrix desde a
// primeira mensagem — não só no encaminhamento humano. Fire-and-forget:
// falha aqui não pode atrasar nem quebrar a resposta ao visitante.
async function recordChatTurnBestEffort(env, input, result) {
  try {
    const sessionRow = await findSessionByToken(env, input.sessionToken);
    if (!sessionRow?.bitrix_entity_id) return;
    const answer = typeof result?.answer === "string" ? result.answer : "";
    await appendSessionTimeline(
      env,
      sessionRow,
      [`Visitante: ${input.message}`, `Assistente: ${answer}`].join("\n")
    );
  } catch {
    // registro auxiliar; não impacta a resposta principal
  }
}

async function cleanupOldRateLimitsBestEffort(env) {
  if (!env.DB || Math.random() > 0.03) return;
  try {
    await env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?")
      .bind(Math.floor(Date.now() / 1000))
      .run();
  } catch {
    // limpeza oportunista; não impacta a resposta principal
  }
}
