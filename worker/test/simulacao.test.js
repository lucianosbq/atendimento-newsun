import test from "node:test";
import assert from "node:assert/strict";
import { calcularSimulacao, normalizarExtracao, resolverTarifa } from "../src/simulacao.js";

// Valores do material oficial "A economia em reais" (Enel SP, B3 convencional,
// 5.000 kWh/mês, CIP R$ 343,41): a simulação tem de reproduzi-los ao centavo.
test("simulação reproduz o material oficial da Enel SP", () => {
  const sim = calcularSimulacao({}, { consumoKwh: 5000, distribuidora: "Enel SP", uf: "SP", cip: 343.41 });
  assert.equal(sim.resultado.parcelaElegivel, 3946.9);
  assert.equal(sim.resultado.semSolucao, 4290.31);
  assert.equal(sim.resultado.economiaMensal, 789.38);
  assert.equal(sim.resultado.comSolucao, 3500.93);
  assert.equal(sim.resultado.pctSobreElegivel, 20);
  assert.equal(sim.resultado.pctSobreSubtotal, 18.4);
  assert.deepEqual(sim.projecaoAnual.map((p) => p.acumulado), [9472.56, 18945.12, 28417.68, 37890.24, 47362.8]);
  assert.equal(sim.tarifa.generica, false);
});

test("distribuidora desconhecida cai na referência com aviso explícito", () => {
  const sim = calcularSimulacao({}, { consumoKwh: 2000, distribuidora: "Cemig", uf: "MG" });
  assert.equal(sim.tarifa.generica, true);
  assert.match(sim.avisos[0], /refer[êe]ncia de S[ãa]o Paulo/i);
  assert.equal(sim.resultado.cip, null);
});

test("todo resultado carrega os avisos de TUSD/TE e de reajuste", () => {
  const sim = calcularSimulacao({}, { consumoKwh: 5000, distribuidora: "enel" });
  assert.ok(sim.avisos.some((a) => /TUSD e TE dependem da concession[áa]ria e do estado/i.test(a)));
  assert.ok(sim.avisos.some((a) => /IPCA \+ 2%/.test(a)));
});

test("consumo fora da faixa não simula", () => {
  assert.equal(calcularSimulacao({}, { consumoKwh: 50 }), null);
  assert.equal(calcularSimulacao({}, { consumoKwh: "abc" }), null);
});

test("normalizarExtracao valida faixas e descarta lixo", () => {
  const ok = normalizarExtracao({ distribuidora: "Enel SP", uf: "sp", consumo_kwh: "5000", valor_total: 4290.31, cip: 343.41, mes_referencia: "07/2026" });
  assert.equal(ok.consumoKwh, 5000);
  assert.equal(ok.uf, "SP");
  assert.equal(ok.cip, 343.41);
  const foraDaFaixa = normalizarExtracao({ consumo_kwh: 12 });
  assert.equal(foraDaFaixa.consumoKwh, null);
  assert.equal(normalizarExtracao(null), null);
  assert.equal(normalizarExtracao("texto"), null);
});

test("resolverTarifa casa apelidos da Enel", () => {
  assert.equal(resolverTarifa("Eletropaulo", "").generica, false);
  assert.equal(resolverTarifa("", "SP").generica, false);
  assert.equal(resolverTarifa("Equatorial", "PA").generica, true);
});
