import test from "node:test";
import assert from "node:assert/strict";
import { findExistingLeadId, getDepartmentRoute, notifyBitrixMessenger } from "../src/integrations.js";

test("rotas privadas são lidas apenas do ambiente", () => {
  const env = {
    DEPARTMENT_ROUTES_JSON: JSON.stringify({
      comercial: {
        label: "Comercial",
        employeeName: "Equipe Comercial",
        employeeWhatsApp: "+55 (11) 99999-9999",
        bitrixAssignedById: "123",
      },
    }),
  };
  const route = getDepartmentRoute(env, "comercial");
  assert.equal(route.employeeWhatsApp, "5511999999999");
  assert.equal(getDepartmentRoute(env, "financeiro"), null);
});

import { assertAtLeastOneHandoffRouteConfigured } from "../src/integrations.js";

test("Bitrix sozinho não autoriza aviso de que o funcionário foi notificado", () => {
  assert.throws(
    () => assertAtLeastOneHandoffRouteConfigured({ BITRIX_WEBHOOK_URL: "https://bitrix.example/rest" }, null),
    (error) => error?.code === "handoff_route_not_configured"
  );
});

test("n8n pode ser rota humana quando configurado", () => {
  assert.doesNotThrow(() => assertAtLeastOneHandoffRouteConfigured({ N8N_HANDOFF_URL: "https://n8n.example/webhook" }, null));
});

test("findExistingLeadId reaproveita o card já encontrado por telefone ou e-mail", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    // Simula: telefone não bate com ninguém, e-mail bate com o lead 742.
    const result = body.type === "PHONE" ? { LEAD: [] } : { LEAD: ["742"] };
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const env = { BITRIX_WEBHOOK_URL: "https://bitrix.example/rest/1/token" };
  const leadId = await findExistingLeadId(env, { phone: "5511988887777", email: "maria@example.com" });
  assert.equal(leadId, "742");
});

test("findExistingLeadId devolve null sem Bitrix configurado ou sem duplicidade", async (t) => {
  assert.equal(await findExistingLeadId({}, { phone: "5511988887777" }), null);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ result: { LEAD: [] } }) });
  t.after(() => { globalThis.fetch = originalFetch; });

  const env = { BITRIX_WEBHOOK_URL: "https://bitrix.example/rest/1/token" };
  assert.equal(await findExistingLeadId(env, { phone: "5511988887777", email: "maria@example.com" }), null);
});

test("notifyBitrixMessenger respeita o expediente por padrão, mas aceita ignorar", async (t) => {
  const originalFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called += 1; return { ok: true, status: 200, json: async () => ({ result: true }) }; };
  t.after(() => { globalThis.fetch = originalFetch; });

  // "9" é um dia da semana inválido (filtrado por isBusinessHours), então a
  // lista de dias permitidos fica vazia e nunca é expediente — determinístico,
  // sem depender do dia/hora real em que os testes rodam. String vazia não
  // serviria: `"" || "1,2,3,4,5"` cairia no padrão, por ser falsy em JS.
  const env = {
    BITRIX_WEBHOOK_URL: "https://bitrix.example/rest/1/token",
    BUSINESS_DAYS: "9",
  };
  const route = { bitrixUserId: "10" };

  const semBypass = await notifyBitrixMessenger(env, route, "aviso");
  assert.equal(semBypass.skipped, true);
  assert.equal(semBypass.reason, "fora_do_expediente");
  assert.equal(called, 0);

  const comBypass = await notifyBitrixMessenger(env, route, "aviso com prazo", { requireBusinessHours: false });
  assert.equal(comBypass.ok, true);
  assert.equal(called, 1);
});
