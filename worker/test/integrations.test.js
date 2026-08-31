import test from "node:test";
import assert from "node:assert/strict";
import { findExistingLeadId, getDepartmentRoute } from "../src/integrations.js";

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
