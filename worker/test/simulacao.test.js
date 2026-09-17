import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { calcularSimulacao, extrairJpegsDoPdf, extrairPorRegex, extrairTextoDoPdf, normalizarExtracao, resolverTarifa } from "../src/simulacao.js";

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

test("extrairJpegsDoPdf acha o JPEG embutido num PDF escaneado", () => {
  // PDF sintético: lixo + um "JPEG" de 30 KB entre SOI (FFD8FF) e EOI (FFD9).
  const tamanho = 30_000;
  const pdf = new Uint8Array(tamanho + 200);
  pdf.fill(0x20);
  const inicio = 100;
  pdf[inicio] = 0xff; pdf[inicio + 1] = 0xd8; pdf[inicio + 2] = 0xff;
  pdf.fill(0x41, inicio + 3, inicio + tamanho);
  pdf[inicio + tamanho] = 0xff; pdf[inicio + tamanho + 1] = 0xd9;
  const jpegs = extrairJpegsDoPdf(pdf);
  assert.equal(jpegs.length, 1);
  assert.equal(jpegs[0][0], 0xff);
  assert.equal(jpegs[0][jpegs[0].length - 1], 0xd9);
  // imagem pequena demais (ícone/logo) é ignorada
  const pequeno = new Uint8Array(500);
  pequeno[0] = 0xff; pequeno[1] = 0xd8; pequeno[2] = 0xff; pequeno[498] = 0xff; pequeno[499] = 0xd9;
  assert.equal(extrairJpegsDoPdf(pequeno).length, 0);
});

test("tarifas lidas da própria conta têm prioridade sobre a tabela", () => {
  // Valores reais da fatura Enel SP inspecionada em 17/09/2026 (com tributos).
  const sim = calcularSimulacao({}, {
    consumoKwh: 7102.8, distribuidora: "Enel SP", uf: "SP", cip: 494.5,
    tusdKwhConta: 0.56282, teKwhConta: 0.381,
  });
  assert.equal(sim.tarifa.daConta, true);
  assert.equal(sim.tarifa.tusdKwh, 0.56282);
  assert.match(sim.tarifa.referencia, /pr[óo]pria conta/);
  assert.match(sim.avisos[0], /lidas da sua pr[óo]pria conta/);
  assert.equal(sim.resultado.parcelaElegivel, Math.round(7102.8 * 0.94382 * 100) / 100);
  assert.equal(sim.resultado.economiaMensal, Math.round(sim.resultado.parcelaElegivel * 0.2 * 100) / 100);
});

test("tarifa unitária fora da faixa é ignorada e cai na tabela", () => {
  const sim = calcularSimulacao({}, { consumoKwh: 5000, distribuidora: "Enel SP", tusdKwhConta: 12, teKwhConta: 0.3 });
  assert.equal(Boolean(sim.tarifa.daConta), false);
  assert.equal(sim.resultado.parcelaElegivel, 3946.9);
});

test("extrairTextoDoPdf infla FlateDecode e junta os literais de texto", async () => {
  const conteudo = "BT (CONSUMO ) Tj (7.102,800 kWh ) Tj (TUSD 0,56282) Tj ET";
  const comprimido = zlib.deflateSync(Buffer.from(conteudo, "latin1"));
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.7\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n", "latin1"),
    comprimido,
    Buffer.from("\nendstream\nendobj\n%%EOF", "latin1"),
  ]);
  const texto = await extrairTextoDoPdf(new Uint8Array(pdf));
  assert.match(texto, /7\.102,800 kWh/);
  assert.match(texto, /TUSD 0,56282/);
});

test("extrairPorRegex lê as linhas de itens de fatura no padrão ANEEL", () => {
  // Trecho sintético no layout real da fatura Enel SP (sem dados pessoais).
  const texto = "SAO PAULO/SP www.eneldistribuicaosp.com Itens de Fatura Unid. Quant. (kWh) Preço unit (R$) com tributos " +
    "USO SIST. DISTR. (TUSD) KWH 7.102,800 0,56282 3.997,60 206,51 " +
    "ENERGIA (TE) KWH 7.102,800 0,38100 2.706,17 139,79 " +
    "COSIP - SÃO PAULO - MUNICIPAL 494,50 0,01";
  const r = extrairPorRegex(texto);
  assert.equal(r.consumoKwh, 7102.8);
  assert.equal(r.tusdUnit, 0.56282);
  assert.equal(r.teUnit, 0.381);
  assert.equal(r.cip, 494.5);
  assert.equal(r.distribuidora, "Enel SP");
  assert.equal(r.uf, "SP");
  // sem a linha TUSD não inventa nada
  assert.equal(extrairPorRegex("fatura qualquer sem itens"), null);
});

test("normalizarExtracao aceita número em formato brasileiro", () => {
  const r = normalizarExtracao({ consumo_kwh: "7.102,8", tusd_unit: "0,56282", te_unit: 0.381, cip: "494,50" });
  assert.equal(r.consumoKwh, 7102.8);
  assert.equal(r.tusdUnit, 0.56282);
  assert.equal(r.cip, 494.5);
});

test("resolverTarifa casa apelidos da Enel", () => {
  assert.equal(resolverTarifa("Eletropaulo", "").generica, false);
  assert.equal(resolverTarifa("", "SP").generica, false);
  assert.equal(resolverTarifa("Equatorial", "PA").generica, true);
});
