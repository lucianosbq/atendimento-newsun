import test from "node:test";
import assert from "node:assert/strict";
import { cleanText, generateProtocol, sha256Hex, uniqueStrings } from "../src/utils.js";

test("cleanText normaliza espaços e limita tamanho", () => {
  assert.equal(cleanText("  Olá\n\n NewSun  ", 20), "Olá NewSun");
  assert.equal(cleanText("abcdef", 3), "abc");
});

test("generateProtocol usa formato rastreável sem PII", () => {
  assert.match(generateProtocol(), /^NS-\d{8}-\d{6}$/);
});

test("sha256Hex é determinístico", async () => {
  assert.equal(await sha256Hex("newsun"), await sha256Hex("newsun"));
  assert.notEqual(await sha256Hex("newsun"), await sha256Hex("NewSun"));
});

test("uniqueStrings preserva texto longo quando solicitado", () => {
  const long = "x".repeat(1000);
  const result = uniqueStrings([long, long], 10, 1200);
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 1000);
});
