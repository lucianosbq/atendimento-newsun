import test from "node:test";
import assert from "node:assert/strict";
import { encryptJson, decryptJson, normalizeBrazilianPhone, redactPii } from "../src/security.js";

test("normalizeBrazilianPhone aceita celular com ou sem +55", () => {
  assert.equal(normalizeBrazilianPhone("(11) 99999-9999"), "5511999999999");
  assert.equal(normalizeBrazilianPhone("+55 11 99999-9999"), "5511999999999");
  assert.equal(normalizeBrazilianPhone("123"), "");
});

test("redactPii remove contato, CPF e CNPJ do contexto da IA", () => {
  const text = "Meu e-mail é teste@example.com, telefone (11) 99999-9999, CPF 123.456.789-00 e CNPJ 12.345.678/0001-90";
  const output = redactPii(text);
  assert.doesNotMatch(output, /teste@example\.com/);
  assert.doesNotMatch(output, /99999/);
  assert.doesNotMatch(output, /123\.456/);
  assert.doesNotMatch(output, /12\.345/);
});

test("AES-GCM criptografa e recupera PII", async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const env = { PII_ENCRYPTION_KEY: Buffer.from(bytes).toString("base64") };
  const original = { name: "Luciano", phone: "5511999999999" };
  const encrypted = await encryptJson(original, env, "NS-TEST");
  assert.notEqual(encrypted.encryptedPayload, JSON.stringify(original));
  const restored = await decryptJson(encrypted.encryptedPayload, encrypted.iv, env, "NS-TEST");
  assert.deepEqual(restored, original);
});
