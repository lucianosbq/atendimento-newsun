import {
  HttpError,
  cleanText,
  nowIso,
  safeJsonParse,
  sha256Hex,
  truncate,
  uniqueStrings,
} from "./utils.js";

export async function embedTexts(env, texts) {
  if (!env.AI) throw new HttpError(503, "Serviço de IA não configurado.", "ai_not_configured");
  const normalized = texts.map((text) => cleanText(text, 8000)).filter(Boolean);
  if (!normalized.length) return [];
  const model = env.MODEL_EMBEDDING || "@cf/baai/bge-m3";
  const result = await env.AI.run(model, { text: normalized });
  const embeddings = extractEmbeddingArrays(result);
  if (embeddings.length !== normalized.length) {
    throw new Error(`O modelo de embeddings retornou ${embeddings.length} vetor(es) para ${normalized.length} texto(s).`);
  }
  return embeddings;
}

export async function retrievePublicContext(env, query, department) {
  if (!env.VECTORIZE || !env.DB) return { chunks: [], sources: [] };
  const [queryVector] = await embedTexts(env, [query]);
  if (!queryVector) return { chunks: [], sources: [] };

  const topK = Math.max(3, Math.min(20, Number(env.RAG_TOP_K) || 7));
  const namespace = env.PUBLIC_KB_NAMESPACE || "public";
  const result = await env.VECTORIZE.query(queryVector, {
    topK: Math.min(20, topK * 2),
    namespace,
    returnValues: false,
    returnMetadata: "all",
  });

  const matches = Array.isArray(result?.matches) ? result.matches : [];
  const minScore = Number.isFinite(Number(env.RAG_MIN_SCORE)) ? Number(env.RAG_MIN_SCORE) : 0.45;
  const candidateIds = matches
    .filter((match) => Number(match.score || 0) >= minScore)
    .map((match) => String(match.id))
    .slice(0, 30);
  if (!candidateIds.length) return { chunks: [], sources: [] };

  const placeholders = candidateIds.map(() => "?").join(",");
  const rowsResult = await env.DB.prepare(
    `SELECT id, source_id, title, source_url, department, content, approved_at
     FROM knowledge_chunks
     WHERE id IN (${placeholders})
       AND visibility = 'public'
       AND active = 1`
  ).bind(...candidateIds).all();

  const rows = Array.isArray(rowsResult?.results) ? rowsResult.results : [];
  const rowsById = new Map(rows.map((row) => [String(row.id), row]));
  const chunks = [];

  for (const match of matches) {
    const row = rowsById.get(String(match.id));
    if (!row) continue;
    const rowDepartment = String(row.department || "geral");
    if (rowDepartment !== "geral" && rowDepartment !== department) continue;
    chunks.push({
      id: String(row.id),
      sourceId: String(row.source_id),
      title: String(row.title),
      sourceUrl: row.source_url ? String(row.source_url) : "",
      department: rowDepartment,
      content: truncate(String(row.content), 2200),
      approvedAt: String(row.approved_at),
      score: Number(match.score || 0),
    });
    if (chunks.length >= topK) break;
  }

  const sources = [];
  const seen = new Set();
  for (const chunk of chunks) {
    if (seen.has(chunk.sourceId)) continue;
    seen.add(chunk.sourceId);
    sources.push({
      id: chunk.sourceId,
      title: chunk.title,
      url: chunk.sourceUrl,
      approvedAt: chunk.approvedAt,
    });
  }
  return { chunks, sources };
}

export function formatRagContext(chunks) {
  if (!chunks.length) return "NENHUM CONTEÚDO PÚBLICO APROVADO FOI RECUPERADO.";
  return chunks
    .map(
      (chunk) =>
        `<fonte_publica id="${escapeXml(chunk.sourceId)}" titulo="${escapeXml(chunk.title)}" departamento="${escapeXml(chunk.department)}">\n${chunk.content}\n</fonte_publica>`
    )
    .join("\n\n");
}

export async function ingestPublicDocument(env, input) {
  if (!env.DB || !env.VECTORIZE) throw new HttpError(503, "D1/Vectorize não configurados.", "storage_not_configured");
  const document = validatePublicDocument(input);
  const chunks = chunkPublicText(document.content);
  if (!chunks.length) throw new HttpError(400, "O documento não contém texto útil.", "empty_document");

  const oldRows = await env.DB.prepare("SELECT id FROM knowledge_chunks WHERE source_id = ?")
    .bind(document.sourceId)
    .all();
  const oldIds = (oldRows?.results || []).map((row) => String(row.id));
  if (oldIds.length) {
    await env.VECTORIZE.deleteByIds(oldIds);
    await env.DB.prepare("DELETE FROM knowledge_chunks WHERE source_id = ?").bind(document.sourceId).run();
  }

  const now = nowIso();
  const allVectors = [];
  const allStatements = [];
  const batchSize = 24;

  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    const vectors = await embedTexts(env, batch);
    for (let offset = 0; offset < batch.length; offset += 1) {
      const index = start + offset;
      const content = batch[offset];
      const idHash = await sha256Hex(`${document.sourceId}:${index}:${content}`);
      const chunkId = `kb_${idHash.slice(0, 44)}`;
      const checksum = await sha256Hex(content);

      allVectors.push({
        id: chunkId,
        namespace: env.PUBLIC_KB_NAMESPACE || "public",
        values: vectors[offset],
        metadata: {
          sourceId: document.sourceId.slice(0, 64),
          title: document.title.slice(0, 180),
          department: document.department,
          visibility: "public",
          sourceUrl: document.sourceUrl.slice(0, 500),
        },
      });

      allStatements.push(
        env.DB.prepare(
          `INSERT INTO knowledge_chunks
           (id, source_id, title, source_url, department, content, visibility, approved_by, approved_at, checksum, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'public', ?, ?, ?, 1, ?, ?)`
        ).bind(
          chunkId,
          document.sourceId,
          document.title,
          document.sourceUrl || null,
          document.department,
          content,
          document.approvedBy,
          document.approvedAt,
          checksum,
          now,
          now
        )
      );
    }
  }

  for (let start = 0; start < allStatements.length; start += 50) {
    await env.DB.batch(allStatements.slice(start, start + 50));
  }
  let mutationId = "";
  for (let start = 0; start < allVectors.length; start += 100) {
    const mutation = await env.VECTORIZE.upsert(allVectors.slice(start, start + 100));
    mutationId = mutation?.mutationId || mutationId;
  }

  return {
    ok: true,
    sourceId: document.sourceId,
    chunks: chunks.length,
    mutationId,
    note: "A atualização do Vectorize é assíncrona e pode levar alguns segundos para aparecer nas consultas.",
  };
}

export function chunkPublicText(content, maxChars = 1500, overlapChars = 180) {
  const text = String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return [];
  const paragraphs = text.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  const pushCurrent = () => {
    const normalized = current.trim();
    if (normalized.length >= 60) chunks.push(normalized);
    current = normalized.slice(Math.max(0, normalized.length - overlapChars));
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current.trim()) pushCurrent();
      let cursor = 0;
      while (cursor < paragraph.length) {
        let end = Math.min(paragraph.length, cursor + maxChars);
        if (end < paragraph.length) {
          const sentenceBreak = paragraph.lastIndexOf(". ", end);
          if (sentenceBreak > cursor + Math.floor(maxChars * 0.55)) end = sentenceBreak + 1;
        }
        const segment = paragraph.slice(cursor, end).trim();
        if (segment.length >= 60) chunks.push(segment);
        if (end >= paragraph.length) break;
        cursor = Math.max(cursor + 1, end - overlapChars);
      }
      current = "";
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      pushCurrent();
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      if (current.length > maxChars) pushCurrent();
    }
  }
  if (current.trim().length >= 60) chunks.push(current.trim());
  return uniqueStrings(chunks, 500, 1800);
}

function validatePublicDocument(input) {
  const sourceId = cleanText(input?.sourceId, 120);
  const title = cleanText(input?.title, 180);
  const sourceUrl = cleanText(input?.sourceUrl, 500);
  const department = cleanText(input?.department || "geral", 40);
  const visibility = cleanText(input?.visibility, 20);
  const approvedBy = cleanText(input?.approvedBy, 120);
  const approvedAt = cleanText(input?.approvedAt, 40);
  const content = String(input?.content || "").trim().slice(0, 220_000);

  if (!sourceId || !/^[a-zA-Z0-9._:-]+$/.test(sourceId)) {
    throw new HttpError(400, "sourceId inválido.", "invalid_source_id");
  }
  if (!title) throw new HttpError(400, "title é obrigatório.", "missing_title");
  if (visibility !== "public") {
    throw new HttpError(400, "A ingestão aceita exclusivamente visibility='public'.", "non_public_rejected");
  }
  if (!approvedBy || !approvedAt || Number.isNaN(Date.parse(approvedAt))) {
    throw new HttpError(400, "Aprovação humana (approvedBy/approvedAt) é obrigatória.", "approval_required");
  }
  if (!content || content.length < 60) throw new HttpError(400, "content é obrigatório.", "missing_content");
  if (!["geral", "comercial", "atendimento", "financeiro", "juridico", "operacoes", "parcerias", "imprensa", "pessoas"].includes(department)) {
    throw new HttpError(400, "department inválido.", "invalid_department");
  }
  if (sourceUrl && !/^https:\/\//i.test(sourceUrl)) {
    throw new HttpError(400, "sourceUrl deve usar HTTPS.", "invalid_source_url");
  }
  return { sourceId, title, sourceUrl, department, visibility, approvedBy, approvedAt, content };
}

function extractEmbeddingArrays(result) {
  const candidates = [
    result?.data,
    result?.embeddings,
    result?.response?.data,
    result?.response?.embeddings,
    result?.response,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    if (candidate.length && Array.isArray(candidate[0]) && candidate[0].every((value) => typeof value === "number")) {
      return candidate;
    }
    if (candidate.length && candidate[0]?.embedding && Array.isArray(candidate[0].embedding)) {
      return candidate.map((item) => item.embedding);
    }
    if (candidate.every((value) => typeof value === "number")) return [candidate];
  }
  throw new Error(`Formato de embeddings inesperado: ${JSON.stringify(result).slice(0, 500)}`);
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}
