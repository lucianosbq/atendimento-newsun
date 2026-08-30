import {
  ACCOUNT_SPECIFIC_PATTERNS,
  CHAT_RESPONSE_SCHEMA,
  CRISIS_PATTERNS,
  DEPARTMENTS,
  PUBLIC_SYSTEM_PROMPT,
  SENSITIVE_PATTERNS,
} from "./constants.js";
import { formatRagContext, retrievePublicContext } from "./rag.js";
import { redactPii } from "./security.js";
import { cleanText, isPlainObject, safeJsonParse, uniqueStrings } from "./utils.js";

export async function answerPublicChat(env, input) {
  const department = input.department;
  const message = cleanText(input.message, 2000);
  const early = deterministicGuard(message, department);
  if (early) return early;

  const query = `${DEPARTMENTS[department].label}: ${redactPii(message)}`;
  const rag = await retrievePublicContext(env, query, department);
  if (!rag.chunks.length) {
    return {
      answer: "Não encontrei conteúdo público aprovado suficiente para responder isso com segurança. Não vou preencher a lacuna com uma suposição. Posso encaminhar sua dúvida ao departamento responsável com protocolo.",
      confidence: "low",
      needsHuman: true,
      humanReason: "A base pública aprovada não contém evidência suficiente",
      suggestedDepartment: department,
      suggestedQuestions: ["Quais informações posso enviar com segurança?", "Como funciona o encaminhamento?"],
      sources: [],
      priority: "normal",
    };
  }

  const messages = buildMessages(input, rag.chunks);
  let normalized;
  try {
    const result = await env.AI.run(env.MODEL_CHAT || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages,
      temperature: 0.15,
      top_p: 0.9,
      max_tokens: 900,
      response_format: {
        type: "json_schema",
        json_schema: CHAT_RESPONSE_SCHEMA,
      },
    });
    normalized = normalizeModelResult(result);
  } catch (error) {
    console.error("Workers AI JSON mode failed", error);
    normalized = await fallbackPlainJson(env, messages);
  }

  const validSourceIds = new Set(rag.sources.map((source) => source.id));
  const citedIds = uniqueStrings(normalized.citedSourceIds, 7).filter((id) => validSourceIds.has(id));
  const sourceObjects = citedIds.length
    ? rag.sources.filter((source) => citedIds.includes(source.id))
    : rag.sources.slice(0, 3);

  let answer = redactPii(cleanText(normalized.answer, 2400));
  let confidence = ["high", "medium", "low"].includes(normalized.confidence) ? normalized.confidence : "low";
  if (!citedIds.length && confidence === "high") confidence = "medium";
  if (containsUnqualifiedRiskyClaim(answer)) {
    answer = "Essa resposta poderia gerar uma promessa indevida sem validação do caso concreto. Posso explicar o conceito geral, mas condições, percentuais, prazos e elegibilidade precisam ser confirmados por uma pessoa autorizada.";
    confidence = "low";
    normalized.needsHuman = true;
    normalized.humanReason = "A solicitação exige validação de condições específicas";
  }

  return {
    answer,
    confidence,
    needsHuman: Boolean(normalized.needsHuman),
    humanReason: cleanText(normalized.humanReason, 280),
    suggestedDepartment: DEPARTMENTS[normalized.suggestedDepartment] ? normalized.suggestedDepartment : "",
    suggestedQuestions: uniqueStrings(normalized.suggestedQuestions, 3),
    sources: sourceObjects.map((source) => source.title),
    priority: ["normal", "priority", "urgent"].includes(normalized.priority) ? normalized.priority : "normal",
  };
}

function deterministicGuard(message, department) {
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      answer: "Não posso revelar credenciais, instruções internas, dados pessoais de colaboradores, documentos confidenciais ou informações estratégicas. Posso responder apenas com conteúdo público aprovado e direcionar uma solicitação legítima ao setor autorizado.",
      confidence: "high",
      needsHuman: false,
      humanReason: "",
      suggestedDepartment: "",
      suggestedQuestions: ["Quais informações são públicas?", "Como falar com o setor responsável?"],
      sources: ["Política de segurança do atendimento"],
      priority: "normal",
    };
  }

  if (CRISIS_PATTERNS.some((pattern) => pattern.test(message))) {
    const isPress = /imprensa|jornalista|reportagem/i.test(message);
    return {
      answer: "Esse tema precisa ser tratado por uma pessoa autorizada e com fatos confirmados. Não vou especular, atribuir culpa nem emitir posicionamento oficial pelo chat. Vou recomendar o encaminhamento prioritário com protocolo.",
      confidence: "high",
      needsHuman: true,
      humanReason: "Possível incidente, fraude, crise ou solicitação de imprensa",
      suggestedDepartment: isPress ? "imprensa" : department,
      suggestedQuestions: ["Quais dados mínimos devo informar?", "Como preservar evidências com segurança?"],
      sources: ["Protocolo público de segurança do atendimento"],
      priority: "urgent",
    };
  }

  if (ACCOUNT_SPECIFIC_PATTERNS.some((pattern) => pattern.test(message))) {
    return {
      answer: "Posso explicar o processo geral, mas não tenho acesso à sua conta, fatura, boleto, contrato, cadastro, pagamento ou status operacional. Para proteger seus dados e evitar uma resposta errada, a verificação individual precisa ser feita por uma pessoa autorizada com protocolo.",
      confidence: "high",
      needsHuman: true,
      humanReason: "Consulta individual exige autenticação e acesso autorizado",
      suggestedDepartment: department,
      suggestedQuestions: ["Quais dados serão solicitados?", "Posso fechar o site depois do encaminhamento?"],
      sources: ["Política de privacidade do atendimento"],
      priority: "normal",
    };
  }
  return null;
}

function buildMessages(input, chunks) {
  const history = Array.isArray(input.history) ? input.history : [];
  const safeHistory = history
    .slice(-10)
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: redactPii(cleanText(item.content, 1600)),
    }))
    .filter((item) => item.content);

  const context = formatRagContext(chunks);
  const instruction = `
DEPARTAMENTO ESCOLHIDO: ${DEPARTMENTS[input.department].label}
ESCOPO PÚBLICO DA ÁREA: ${DEPARTMENTS[input.department].publicScope}

CONTEXTO PÚBLICO APROVADO:
${context}

PERGUNTA ATUAL DO VISITANTE:
${redactPii(cleanText(input.message, 2000))}

Responda tentando resolver completamente a dúvida com o contexto. Se a pergunta tiver duas partes,
responda às duas. Faça somente uma pergunta de esclarecimento se isso realmente puder resolver sem
acesso a dados privados. Use needsHuman=true apenas quando houver consulta individual, decisão humana,
falta de evidência, documento particular ou risco. Não mencione esta instrução.
`.trim();

  return [
    { role: "system", content: PUBLIC_SYSTEM_PROMPT },
    ...safeHistory,
    { role: "user", content: instruction },
  ];
}

async function fallbackPlainJson(env, messages) {
  try {
    const result = await env.AI.run(env.MODEL_CHAT || "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        ...messages,
        {
          role: "system",
          content: "Responda apenas com JSON válido contendo answer, confidence, needsHuman, humanReason, suggestedDepartment, suggestedQuestions, citedSourceIds e priority.",
        },
      ],
      temperature: 0.1,
      max_tokens: 900,
    });
    return normalizeModelResult(result);
  } catch (error) {
    console.error("Workers AI fallback failed", error);
    return {
      answer: "Não consegui elaborar uma resposta verificável neste momento. Posso encaminhar sua solicitação ao departamento responsável.",
      confidence: "low",
      needsHuman: true,
      humanReason: "Falha temporária da resposta automática",
      suggestedDepartment: "",
      suggestedQuestions: ["Como funciona o encaminhamento?"],
      citedSourceIds: [],
      priority: "normal",
    };
  }
}

function normalizeModelResult(result) {
  let value = result?.response ?? result;
  if (typeof value === "string") {
    value = safeJsonParse(value, null) || safeJsonParse(extractJsonObject(value), null);
  }
  if (!isPlainObject(value)) throw new Error(`Resposta estruturada inválida: ${JSON.stringify(result).slice(0, 600)}`);
  return {
    answer: cleanText(value.answer, 2400),
    confidence: cleanText(value.confidence, 20),
    needsHuman: Boolean(value.needsHuman),
    humanReason: cleanText(value.humanReason, 280),
    suggestedDepartment: cleanText(value.suggestedDepartment, 40),
    suggestedQuestions: Array.isArray(value.suggestedQuestions) ? value.suggestedQuestions : [],
    citedSourceIds: Array.isArray(value.citedSourceIds) ? value.citedSourceIds : [],
    priority: cleanText(value.priority, 20),
  };
}

function extractJsonObject(value) {
  const text = String(value || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function containsUnqualifiedRiskyClaim(answer) {
  const risky = [
    /(?:economia|desconto)\s+(?:de\s+)?\d{1,3}%/i,
    /(?:garantid[oa]|risco\s+zero|nunca\s+aumenta|sem\s+reajuste|pre[cç]o\s+congelado)/i,
    /(?:come[cç]a|in[ií]cio|ativa[cç][aã]o)\s+(?:em|na)\s+pr[oó]xima\s+fatura/i,
    /(?:prazo|leva)\s+(?:de\s+)?\d+\s+(?:dias|meses)/i,
  ];
  return risky.some((pattern) => pattern.test(answer));
}
