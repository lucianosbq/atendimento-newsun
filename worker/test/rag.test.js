import test from "node:test";
import assert from "node:assert/strict";
import { chunkPublicText } from "../src/rag.js";

test("chunkPublicText cria blocos úteis sem ultrapassar limite relevante", () => {
  const paragraphs = Array.from({ length: 20 }, (_, index) => `Parágrafo ${index + 1}. ${"Energia limpa e previsibilidade. ".repeat(15)}`);
  const chunks = chunkPublicText(paragraphs.join("\n\n"), 900, 120);
  assert.ok(chunks.length > 4);
  assert.ok(chunks.every((chunk) => chunk.length >= 60));
  assert.ok(chunks.every((chunk) => chunk.length <= 1100));
});

test("chunkPublicText ignora conteúdo vazio", () => {
  assert.deepEqual(chunkPublicText("   \n\n  "), []);
});
