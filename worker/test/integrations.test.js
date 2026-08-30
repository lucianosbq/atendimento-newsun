import test from "node:test";
import assert from "node:assert/strict";
import { getDepartmentRoute } from "../src/integrations.js";

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
