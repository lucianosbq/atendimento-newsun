import test from "node:test";
import assert from "node:assert/strict";
import { createChatSession } from "../src/session.js";
import { isBusinessHours } from "../src/integrations.js";

const validInput = {
  department: "comercial",
  name: "Maria da Silva",
  email: "maria@example.com",
  phone: "(11) 98888-7777",
  consent: true,
  consentText:
    "Autorizo a NewSun a usar estes dados para registrar o atendimento e entrar em contato comigo pelo WhatsApp sobre esta solicitação.",
};

test("sessão exige banco configurado", async () => {
  await assert.rejects(
    () => createChatSession({ request: {}, env: {}, input: validInput }),
    (error) => error?.code === "database_not_configured"
  );
});

test("sessão recusa nome incompleto, e-mail inválido e falta de consentimento", async () => {
  const env = { DB: {} };
  await assert.rejects(
    () => createChatSession({ request: {}, env, input: { ...validInput, name: "Maria" } }),
    (error) => error?.code === "invalid_name"
  );
  await assert.rejects(
    () => createChatSession({ request: {}, env, input: { ...validInput, email: "maria@invalida" } }),
    (error) => error?.code === "invalid_email"
  );
  await assert.rejects(
    () => createChatSession({ request: {}, env, input: { ...validInput, consent: false } }),
    (error) => error?.code === "consent_required"
  );
});

test("expediente padrão: seg-sex 08h-18h no fuso -03:00", () => {
  const env = {};
  // Quarta-feira, 2026-09-02 14:00 em Brasília = 17:00 UTC
  assert.equal(isBusinessHours(env, new Date("2026-09-02T17:00:00Z")), true);
  // Quarta-feira, 2026-09-02 19:30 em Brasília = 22:30 UTC
  assert.equal(isBusinessHours(env, new Date("2026-09-02T22:30:00Z")), false);
  // Domingo, 2026-09-06 14:00 em Brasília
  assert.equal(isBusinessHours(env, new Date("2026-09-06T17:00:00Z")), false);
  // Antes das 08h: 07:59 em Brasília = 10:59 UTC
  assert.equal(isBusinessHours(env, new Date("2026-09-02T10:59:00Z")), false);
});

test("expediente respeita configuração customizada", () => {
  const env = {
    BUSINESS_HOURS_START: "09:00",
    BUSINESS_HOURS_END: "17:00",
    BUSINESS_DAYS: "1,2,3,4,5,6",
    BUSINESS_TZ_OFFSET_MINUTES: "-180",
  };
  // Sábado, 2026-09-05 10:00 em Brasília = 13:00 UTC
  assert.equal(isBusinessHours(env, new Date("2026-09-05T13:00:00Z")), true);
  // Sábado, 2026-09-05 17:00 em Brasília (fim exclusivo)
  assert.equal(isBusinessHours(env, new Date("2026-09-05T20:00:00Z")), false);
});
