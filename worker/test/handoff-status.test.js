import test from "node:test";
import assert from "node:assert/strict";
import { getHandoffStatus } from "../src/handoff.js";
import { hmacHex } from "../src/utils.js";

function mockDb(row) {
  return {
    prepare() {
      return {
        bind() {
          return { first: async () => row };
        },
      };
    },
  };
}

test("status aceito pela Meta ainda não libera fechamento", async () => {
  const token = "status-token-seguro";
  const salt = "salt-de-teste";
  const pollTokenHash = await hmacHex(salt, token);
  const result = await getHandoffStatus(
    {
      RATE_LIMIT_SALT: salt,
      DB: mockDb({
        poll_token_hash: pollTokenHash,
        department: "comercial",
        status: "notified",
        notification_state: "accepted_by_whatsapp",
        updated_at: "2026-08-30T12:00:00Z",
      }),
    },
    { protocol: "NS-TEST", statusToken: token }
  );
  assert.equal(result.employeeNotified, false);
  assert.match(result.message, /Aguarde a confirmação/);
});

test("status delivered libera fechamento sem alegar leitura", async () => {
  const token = "status-token-seguro";
  const salt = "salt-de-teste";
  const pollTokenHash = await hmacHex(salt, token);
  const result = await getHandoffStatus(
    {
      RATE_LIMIT_SALT: salt,
      DB: mockDb({
        poll_token_hash: pollTokenHash,
        department: "comercial",
        status: "notified",
        notification_state: "delivered",
        updated_at: "2026-08-30T12:00:00Z",
      }),
    },
    { protocol: "NS-TEST", statusToken: token }
  );
  assert.equal(result.employeeNotified, true);
  assert.doesNotMatch(result.message, /leu|leitura/i);
  assert.match(result.message, /pode fechar/i);
});
