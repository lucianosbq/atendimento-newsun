import { cleanText } from "./utils.js";

// Política de Preços Mensal — v oficial 2º semestre 2026 · competência JULHO/2026
// (documento interno, emitido em 06/07/2026; incluído aqui a pedido do Luciano em
// 18/09/2026 para o cálculo da proposta na simulação).
//
// Fórmula oficial: Desconto Líquido = Desconto Total (sobre tarifa) − ICMS-TUSD,
// onde ICMS-TUSD é a representatividade fixa de 2026 por concessionária (auditoria
// tributária JUN/2026; subgrupo B3 convencional, contexto GD/SCEE). 19 estados têm
// isenção plena (ICMS-TUSD = 0%); 8 têm cobrança efetiva.
//
// FICA NO CÓDIGO DO WORKER de propósito: é política comercial interna. A simulação
// usa só a linha da concessionária do cliente; a tabela nunca vai para a base
// pública de conhecimento nem pode ser listada pelo assistente.

export const COMPETENCIA_POLITICA = "julho/2026";

const POLITICA = Object.freeze([
  { nome: "CELESC", aliases: ["celesc"], uf: "SC", descTotal: 15, icmsTusd: 9.96, descLiquido: 5.04 },
  { nome: "CEMIG-D", aliases: ["cemig"], uf: "MG", descTotal: 20, icmsTusd: 0, descLiquido: 20 },
  { nome: "COELBA", aliases: ["coelba", "neoenergia coelba"], uf: "BA", descTotal: 15, icmsTusd: 0, descLiquido: 15 },
  { nome: "COPEL-DIS", aliases: ["copel"], uf: "PR", descTotal: 17.5, icmsTusd: 11.86, descLiquido: 5.64 },
  { nome: "COSERN", aliases: ["cosern", "neoenergia cosern"], uf: "RN", descTotal: 12.5, icmsTusd: 0, descLiquido: 12.5 },
  { nome: "CPFL Santa Cruz", aliases: ["cpfl santa cruz"], uf: "SP", descTotal: 20, icmsTusd: 13.19, descLiquido: 6.81 },
  { nome: "CPFL-PAULISTA", aliases: ["cpfl paulista", "cpfl-paulista"], uf: "SP", descTotal: 20, icmsTusd: 11.81, descLiquido: 8.19 },
  { nome: "CPFL-PIRATININGA", aliases: ["cpfl piratininga", "piratininga"], uf: "SP", descTotal: 20, icmsTusd: 10.56, descLiquido: 9.44 },
  { nome: "EDP SP", aliases: ["edp sp", "edp sao paulo", "edp são paulo", "bandeirante"], uf: "SP", descTotal: 20, icmsTusd: 11.35, descLiquido: 8.65 },
  { nome: "ELEKTRO", aliases: ["elektro", "neoenergia elektro"], uf: "SP", descTotal: 20, icmsTusd: 11.69, descLiquido: 8.31 },
  { nome: "ELETROPAULO", aliases: ["eletropaulo", "enel sp", "enel sao paulo", "enel são paulo", "enel distribuicao sao paulo"], uf: "SP", descTotal: 15, icmsTusd: 11.62, descLiquido: 3.38 },
  { nome: "EMS", aliases: ["ems", "energisa ms", "energisa mato grosso do sul"], uf: "MS", descTotal: 15, icmsTusd: 0, descLiquido: 15 },
  { nome: "EMT", aliases: ["emt", "energisa mt", "energisa mato grosso"], uf: "MT", descTotal: 15, icmsTusd: 0, descLiquido: 15 },
  { nome: "ENEL CE", aliases: ["enel ce", "enel ceara", "enel ceará", "coelce"], uf: "CE", descTotal: 20, icmsTusd: 14.07, descLiquido: 5.93 },
  { nome: "EPB", aliases: ["epb", "energisa pb", "energisa paraiba", "energisa paraíba"], uf: "PB", descTotal: 10, icmsTusd: 0, descLiquido: 10 },
  { nome: "EQUATORIAL AL", aliases: ["equatorial al", "equatorial alagoas", "ceal"], uf: "AL", descTotal: 10, icmsTusd: 0, descLiquido: 10 },
  { nome: "EQUATORIAL GO", aliases: ["equatorial go", "equatorial goias", "equatorial goiás", "celg"], uf: "GO", descTotal: 15, icmsTusd: 0, descLiquido: 15 },
  { nome: "EQUATORIAL MA", aliases: ["equatorial ma", "equatorial maranhao", "equatorial maranhão", "cemar"], uf: "MA", descTotal: 10, icmsTusd: 0, descLiquido: 10 },
  { nome: "EQUATORIAL PA", aliases: ["equatorial pa", "equatorial para", "equatorial pará", "celpa"], uf: "PA", descTotal: 15, icmsTusd: 0, descLiquido: 15 },
  { nome: "EQUATORIAL PI", aliases: ["equatorial pi", "equatorial piaui", "equatorial piauí", "cepisa"], uf: "PI", descTotal: 10, icmsTusd: 0, descLiquido: 10 },
  { nome: "ESS", aliases: ["ess", "energisa se", "energisa sergipe"], uf: "SE", descTotal: 17.5, icmsTusd: 12.5, descLiquido: 5 },
  { nome: "ETO", aliases: ["eto", "energisa to", "energisa tocantins"], uf: "TO", descTotal: 20, icmsTusd: 14.74, descLiquido: 5.26 },
  { nome: "LIGHT SESA", aliases: ["light"], uf: "RJ", descTotal: 15, icmsTusd: 0, descLiquido: 15 },
  { nome: "Neoenergia Brasília", aliases: ["neoenergia brasilia", "neoenergia brasília", "ceb"], uf: "DF", descTotal: 15, icmsTusd: 0, descLiquido: 15 },
  { nome: "Neoenergia PE", aliases: ["neoenergia pe", "neoenergia pernambuco", "celpe"], uf: "PE", descTotal: 20, icmsTusd: 14.79, descLiquido: 5.21 },
  { nome: "RGE", aliases: ["rge", "cpfl rge"], uf: "RS", descTotal: 15, icmsTusd: 11.46, descLiquido: 3.54 },
]);

function normalizar(texto) {
  return cleanText(texto, 80).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Resolve a linha da política para a concessionária do cliente. Ordem: nome/alias
// (mais específico primeiro); depois UF, apenas quando a UF tem UMA concessionária
// na tabela — SP tem seis, então UF sozinha não decide lá.
export function resolverPolitica(distribuidora, uf) {
  const nome = normalizar(distribuidora);
  if (nome) {
    const candidatos = POLITICA
      .flatMap((linha) => linha.aliases.map((alias) => ({ linha, alias })))
      .filter(({ alias }) => nome.includes(alias) || alias.includes(nome))
      .sort((a, b) => b.alias.length - a.alias.length);
    if (candidatos.length) return candidatos[0].linha;
  }
  const estado = normalizar(uf).toUpperCase();
  if (estado) {
    const daUf = POLITICA.filter((linha) => linha.uf === estado);
    if (daUf.length === 1) return daUf[0];
  }
  return null;
}
