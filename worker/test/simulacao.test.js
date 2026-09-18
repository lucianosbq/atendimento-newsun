import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { calcularSimulacao, extrairJpegsDoPdf, extrairPorRegex, extrairTextoDoPdf, normalizarExtracao, resolverTarifa } from "../src/simulacao.js";

// Base tarifária do material oficial (Enel SP, B3, 5.000 kWh, CIP R$ 343,41).
// Decisão de 18/09/2026: o cartão calcula com o desconto TOTAL da política
// (Eletropaulo = 15%) e o líquido (3,38%) vai na letra miúda.
test("simulação da Enel SP estampa o desconto total e explica o líquido", () => {
  const sim = calcularSimulacao({}, { consumoKwh: 5000, distribuidora: "Enel SP", uf: "SP", cip: 343.41 });
  assert.equal(sim.resultado.parcelaElegivel, 3946.9);
  assert.equal(sim.resultado.semSolucao, 4290.31);
  assert.equal(sim.resultado.pctSobreElegivel, 15);
  assert.equal(sim.resultado.economiaMensal, Math.round(3946.9 * 0.15 * 100) / 100);
  assert.equal(sim.politica.concessionaria, "ELETROPAULO");
  assert.equal(sim.politica.descontoLiquidoPct, 3.38);
  assert.ok(sim.avisos.some((a) => /ICMS sobre a TUSD/.test(a) && /3\.38|3,38/.test(a)));
});

test("estado com isenção plena usa o desconto integral da política", () => {
  const sim = calcularSimulacao({}, { consumoKwh: 2000, distribuidora: "Cemig", uf: "MG" });
  assert.equal(sim.politica.concessionaria, "CEMIG-D");
  assert.equal(sim.resultado.pctSobreElegivel, 20);
  assert.ok(sim.avisos.some((a) => /isen[çc][ãa]o plena/.test(a)));
  assert.ok(sim.avisos.some((a) => /refer[êe]ncia de S[ãa]o Paulo/i.test(a)));
  assert.equal(sim.resultado.cip, null);
});

test("sem TUSD/TE legíveis, a tarifa média sai da própria conta (qualquer concessionária)", () => {
  const sim = calcularSimulacao({}, { consumoKwh: 500, distribuidora: "Coelba", uf: "BA", cip: 50, valorTotalConta: 650 });
  assert.equal(sim.tarifa.daConta, true);
  assert.equal(sim.resultado.parcelaElegivel, 600);
  assert.equal(sim.resultado.pctSobreElegivel, 15);
  assert.equal(sim.resultado.economiaMensal, 90);
  assert.ok(sim.avisos.some((a) => /tarifa m[ée]dia da sua pr[óo]pria conta/.test(a)));
});

test("tarifa média implausível é descartada e cai na tabela", () => {
  const sim = calcularSimulacao({}, { consumoKwh: 5000, distribuidora: "Enel SP", valorTotalConta: 50 });
  assert.equal(Boolean(sim.tarifa.daConta), false);
  assert.equal(sim.resultado.parcelaElegivel, 3946.9);
});

test("concessionária fora da política cai no desconto de referência com aviso", () => {
  const sim = calcularSimulacao({}, { consumoKwh: 2000, distribuidora: "Cooperativa XYZ", uf: "" });
  assert.equal(sim.politica, null);
  assert.equal(sim.resultado.pctSobreElegivel, 20);
  assert.ok(sim.avisos.some((a) => /Desconto de refer[êe]ncia/.test(a)));
});

test("resolverPolitica casa por nome e por UF única, e não chuta em SP", async () => {
  const { resolverPolitica } = await import("../src/precos.js");
  assert.equal(resolverPolitica("Enel Distribuição São Paulo", "").nome, "ELETROPAULO");
  assert.equal(resolverPolitica("CPFL Piratininga", "").descLiquido, 9.44);
  assert.equal(resolverPolitica("Equatorial Pará", "").descLiquido, 15);
  assert.equal(resolverPolitica("Equatorial Piauí", "").descLiquido, 10);
  assert.equal(resolverPolitica("", "RJ").nome, "LIGHT SESA");
  assert.equal(resolverPolitica("", "SP"), null);
});

test("todo resultado carrega os avisos de TUSD/TE e de reajuste", () => {
  const sim = calcularSimulacao({}, { consumoKwh: 5000, distribuidora: "enel" });
  assert.ok(sim.avisos.some((a) => /TUSD e TE dependem da concession[áa]ria e do estado/i.test(a)));
  assert.ok(sim.avisos.some((a) => /IPCA \+ 2%/.test(a)));
});

test("aviso permanente: leitura automática + validação humana, em qualquer método", () => {
  const permanente = /leitura autom[áa]tica.*valida[çc][ãa]o do atendimento humano|valida[çc][ãa]o do atendimento humano/;
  for (const entrada of [
    { consumoKwh: 5000, distribuidora: "Enel SP", tusdKwhConta: 0.56282, teKwhConta: 0.381 },
    { consumoKwh: 500, distribuidora: "Coelba", cip: 50, valorTotalConta: 650 },
    { consumoKwh: 2000, distribuidora: "Cooperativa XYZ" },
  ]) {
    const sim = calcularSimulacao({}, entrada);
    assert.ok(sim.avisos.some((a) => permanente.test(a) && /ilustrativ/i.test(a)));
  }
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
  assert.ok(sim.avisos.some((a) => /lidas da sua pr[óo]pria conta/.test(a)));
  assert.equal(sim.resultado.parcelaElegivel, Math.round(7102.8 * 0.94382 * 100) / 100);
  // desconto TOTAL da política para Enel SP (15%), sobre a parcela elegível da conta
  assert.equal(sim.resultado.pctSobreElegivel, 15);
  assert.equal(sim.resultado.economiaMensal, Math.round(sim.resultado.parcelaElegivel * 0.15 * 100) / 100);
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

test("extrairPorRegex lê o layout Coelba/Neoenergia (Consumo - TUSD / Consumo - TE)", () => {
  const texto = "COELBA - COMPANHIA DE ELETRICIDADE DO ESTADO DA BAHIA SALVADOR - BA " +
    "Consumo - TUSD kWh 6.800 0,682025 4.637,77 " +
    "Consumo - TE kWh 6.800 0,487341 3.311,92 " +
    "Contrib. de Iluminação Pública kWh 182,91";
  const r = extrairPorRegex(texto);
  assert.equal(r.consumoKwh, 6800);
  assert.equal(r.tusdUnit, 0.682025);
  assert.equal(r.teUnit, 0.487341);
  assert.equal(r.distribuidora, "Neoenergia");
  assert.equal(r.uf, "BA");
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
