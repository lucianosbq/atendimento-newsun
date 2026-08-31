const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function errorJson(message, status = 400, code = "bad_request", details) {
  const body = { error: message, code };
  if (details !== undefined) body.details = details;
  return json(body, status);
}

export async function readJson(request, maxBytes = 32_000) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new HttpError(413, "Corpo da requisição excede o limite.", "payload_too_large");
  const text = await request.text();
  if (encoder.encode(text).byteLength > maxBytes) {
    throw new HttpError(413, "Corpo da requisição excede o limite.", "payload_too_large");
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "JSON inválido.", "invalid_json");
  }
}

export class HttpError extends Error {
  constructor(status, message, code = "request_error", details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function cleanText(value, maxLength = 2000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function clampFloat(value, fallback, min, max) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function nowIso() {
  return new Date().toISOString();
}

export function addDaysIso(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

export function randomId(prefix = "") {
  return `${prefix}${crypto.randomUUID()}`;
}

export function generateProtocol() {
  // Formato oficial: NS-DATA-NÚMERO com 6 dígitos (ex.: NS-20260830-482913).
  // Data no fuso de Brasília (-03:00) para o protocolo bater com o dia do atendimento.
  const local = new Date(Date.now() - 180 * 60_000);
  const ymd = [
    local.getUTCFullYear(),
    String(local.getUTCMonth() + 1).padStart(2, "0"),
    String(local.getUTCDate()).padStart(2, "0"),
  ].join("");
  const random = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return `NS-${ymd}-${String(random).padStart(6, "0")}`;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(String(value)));
  return bytesToHex(new Uint8Array(signature));
}

export function timingSafeEqualString(a, b) {
  const left = encoder.encode(String(a));
  const right = encoder.encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeUtf8(value) {
  return encoder.encode(String(value));
}

export function decodeUtf8(bytes) {
  return decoder.decode(bytes);
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function extractClientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "0.0.0.0";
}

export function truncate(value, maxLength) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function uniqueStrings(values, maxItems = 10, maxLength = 300) {
  return [...new Set((values || []).map((value) => cleanText(value, maxLength)).filter(Boolean))].slice(0, maxItems);
}
