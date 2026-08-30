import {
  HttpError,
  base64ToBytes,
  bytesToBase64,
  cleanText,
  decodeUtf8,
  encodeUtf8,
  extractClientIp,
  hmacHex,
  safeJsonParse,
  timingSafeEqualString,
} from "./utils.js";

export function parseAllowedOrigins(env) {
  const raw = String(env.ALLOWED_ORIGINS || "");
  const parsed = safeJsonParse(raw, null);
  const values = Array.isArray(parsed) ? parsed : raw.split(",");
  return new Set(values.map((item) => String(item).trim().replace(/\/$/, "")).filter(Boolean));
}

export function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = parseAllowedOrigins(env);
  const headers = {
    "vary": "Origin",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type,Idempotency-Key,X-Client-Version,Authorization",
    "access-control-max-age": "86400",
  };
  if (origin && allowed.has(origin.replace(/\/$/, ""))) headers["access-control-allow-origin"] = origin;
  return headers;
}

export function assertOriginAllowed(request, env, { allowNoOrigin = false } = {}) {
  const origin = request.headers.get("Origin");
  if (!origin) {
    if (allowNoOrigin) return;
    throw new HttpError(403, "Origem da requisição não autorizada.", "origin_required");
  }
  const allowed = parseAllowedOrigins(env);
  if (!allowed.has(origin.replace(/\/$/, ""))) {
    throw new HttpError(403, "Origem da requisição não autorizada.", "origin_not_allowed");
  }
}

export function applySecurityHeaders(response, request, env) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) headers.set(key, value);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("cross-origin-resource-policy", "cross-origin");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function enforceRateLimit({ request, env, scope, limit, windowSeconds }) {
  if (!env.DB) return { allowed: true, remaining: limit };
  const now = Math.floor(Date.now() / 1000);
  const bucketStart = Math.floor(now / windowSeconds) * windowSeconds;
  const ip = extractClientIp(request);
  const salt = env.RATE_LIMIT_SALT || "development-only-salt";
  const rateKey = await hmacHex(salt, `${scope}:${ip}`);
  const expiresAt = bucketStart + windowSeconds + 60;

  await env.DB.prepare(
    `INSERT INTO rate_limits (rate_key, bucket_start, request_count, expires_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(rate_key, bucket_start)
     DO UPDATE SET request_count = request_count + 1, expires_at = excluded.expires_at`
  ).bind(rateKey, bucketStart, expiresAt).run();

  const row = await env.DB.prepare(
    "SELECT request_count FROM rate_limits WHERE rate_key = ? AND bucket_start = ?"
  ).bind(rateKey, bucketStart).first();
  const count = Number(row?.request_count || 1);
  const allowed = count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.max(1, bucketStart + windowSeconds - now),
  };
}

export async function verifyTurnstile({ token, request, env, idempotencyKey }) {
  const required = String(env.TURNSTILE_REQUIRED || "true").toLowerCase() !== "false";
  if (!required) return { success: true, bypassed: true };
  if (!env.TURNSTILE_SECRET) throw new HttpError(503, "Proteção antiabuso não configurada.", "turnstile_not_configured");
  if (!token) throw new HttpError(400, "Conclua a verificação de segurança.", "turnstile_required");

  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", cleanText(token, 4096));
  form.set("remoteip", extractClientIp(request));
  if (idempotencyKey) form.set("idempotency_key", idempotencyKey);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) {
    throw new HttpError(403, "A verificação de segurança não foi validada. Atualize e tente novamente.", "turnstile_failed", {
      errorCodes: Array.isArray(result["error-codes"]) ? result["error-codes"] : [],
    });
  }
  return result;
}

export function normalizeBrazilianPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
  if (!/^\d{10,11}$/.test(digits)) return "";
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return "";
  return `55${digits}`;
}

export function maskPhoneForLogs(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 8) return "***";
  return `${digits.slice(0, 4)}*****${digits.slice(-3)}`;
}

export function redactPii(value) {
  return String(value || "")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[E-MAIL REMOVIDO]")
    .replace(/(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?\d{4,5}[-.\s]?\d{4}(?!\d)/g, "[TELEFONE REMOVIDO]")
    .replace(/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g, "[CPF REMOVIDO]")
    .replace(/(?<!\d)\d{2}\.?\d{3}\.?\d{3}[/\\-]?\d{4}-?\d{2}(?!\d)/g, "[CNPJ REMOVIDO]")
    .replace(/(?<!\d)\d{4}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}(?!\d)/g, "[DADO FINANCEIRO REMOVIDO]");
}

export async function encryptJson(payload, env, additionalData = "") {
  const keyBytes = getEncryptionKeyBytes(env);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const algorithm = { name: "AES-GCM", iv };
  if (additionalData) algorithm.additionalData = encodeUtf8(additionalData);
  const encrypted = await crypto.subtle.encrypt(algorithm, key, encodeUtf8(JSON.stringify(payload)));
  return {
    encryptedPayload: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptJson(encryptedPayload, ivBase64, env, additionalData = "") {
  const keyBytes = getEncryptionKeyBytes(env);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const algorithm = { name: "AES-GCM", iv: base64ToBytes(ivBase64) };
  if (additionalData) algorithm.additionalData = encodeUtf8(additionalData);
  const decrypted = await crypto.subtle.decrypt(algorithm, key, base64ToBytes(encryptedPayload));
  return JSON.parse(decodeUtf8(new Uint8Array(decrypted)));
}

function getEncryptionKeyBytes(env) {
  if (!env.PII_ENCRYPTION_KEY) throw new HttpError(503, "Criptografia de dados não configurada.", "encryption_not_configured");
  let bytes;
  try {
    bytes = base64ToBytes(env.PII_ENCRYPTION_KEY);
  } catch {
    throw new HttpError(503, "Chave de criptografia inválida.", "invalid_encryption_key");
  }
  if (bytes.byteLength !== 32) throw new HttpError(503, "A chave de criptografia deve ter 32 bytes.", "invalid_encryption_key");
  return bytes;
}

export async function verifyMetaSignature(rawBody, request, env) {
  if (!env.META_APP_SECRET) return false;
  const provided = request.headers.get("X-Hub-Signature-256") || "";
  if (!provided.startsWith("sha256=")) return false;
  const expected = await hmacHex(env.META_APP_SECRET, rawBody);
  return timingSafeEqualString(provided, `sha256=${expected}`);
}
