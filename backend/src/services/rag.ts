// Sprint 5 — RAG service (text extraction, chunking, embedding, query)
// Implemented in Sprint 5 (Knowledge Base)
import pdfParse from "pdf-parse";
import { readFile } from "fs/promises";
import { getOpenAIClient } from "./openai";
import { db } from "../db/client";
import { kbChunks, kbDocuments } from "../db/schema";
import { eq } from "drizzle-orm";

// ── Text extraction ───────────────────────────────────────

export async function extractText(
  filePath: string,
  fileType: string,
): Promise<string> {
  if (fileType === "pdf") {
    const buffer = await readFile(filePath);
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }
  return readFile(filePath, "utf-8");
}

// ── Chunking (~500 tokens, 50-token overlap, paragraph-aware) ─

export function chunkText(
  text: string,
  chunkSize = 500,
  overlap = 50,
): string[] {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const words = (current + " " + para).trim().split(/\s+/);
    if (words.length > chunkSize) {
      chunks.push(current.trim());
      const overlapWords = current.trim().split(/\s+/).slice(-overlap);
      current = [...overlapWords, ...para.split(/\s+/)].join(" ");
    } else {
      current = words.join(" ");
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ── Embed via OpenAI ──────────────────────────────────────

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const openai = getOpenAIClient();
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

// ── Full document processing pipeline ────────────────────

export async function processDocumentEmbedding(
  documentId: string,
  filePath: string,
  fileType: string,
): Promise<void> {
  try {
    const text = await extractText(filePath, fileType);
    const chunks = chunkText(text);

    // Batch embed (OpenAI allows up to 2048 texts per call)
    const BATCH = 100;
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const embeddings = await embedTexts(batch);
      allEmbeddings.push(...embeddings);
    }

    // Insert chunks
    const rows = chunks.map((content, idx) => ({
      documentId,
      content,
      embedding: JSON.stringify(allEmbeddings[idx]), // stored as text locally; use vector type on VPS
      chunkIndex: idx,
    }));

    await db.insert(kbChunks).values(rows);
    await db
      .update(kbDocuments)
      .set({ status: "ready" })
      .where(eq(kbDocuments.id, documentId));
  } catch (err) {
    await db
      .update(kbDocuments)
      .set({ status: "error" })
      .where(eq(kbDocuments.id, documentId));
    throw err;
  }
}

// ── RAG query ─────────────────────────────────────────────

const AGENCY_BRAIN_PROMPT = `You are Agency Brain, the internal AI assistant for Seekers AI Automation Solutions.
Answer questions ONLY based on the context provided below.
If the answer is not in the context, say: "I don't have that information in the knowledge base."
Always cite your sources by document title.

Context:
---
{chunks}
---`;

export async function ragQuery(
  query: string,
  topK = 5,
): Promise<{
  answer: string;
  sources: { document_id: string; document_title: string; chunk_content: string; similarity_score: number }[];
}> {
  const openai = getOpenAIClient();

  // Embed query
  const [queryEmbedding] = await embedTexts([query]);
  const vectorStr = `[${queryEmbedding.join(",")}]`;

  // pgvector cosine search (raw SQL required for <=> operator)
  const { rows } = await (db as any).$client.query(
    `SELECT c.id, c.content, c.document_id, d.title,
            1 - (c.embedding <=> $1::vector) AS similarity
     FROM kb_chunks c
     JOIN kb_documents d ON d.id = c.document_id
     WHERE 1 - (c.embedding <=> $1::vector) > 0.7
     ORDER BY c.embedding <=> $1::vector
     LIMIT $2`,
    [vectorStr, topK],
  );

  if (rows.length === 0) {
    return {
      answer: "I don't have that information in the knowledge base.",
      sources: [],
    };
  }

  const context = rows
    .map((r: any, i: number) => `[${i + 1}] ${r.title}:\n${r.content}`)
    .join("\n\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: AGENCY_BRAIN_PROMPT.replace("{chunks}", context) },
      { role: "user",   content: query },
    ],
  });

  return {
    answer: completion.choices[0]?.message?.content ?? "No answer generated.",
    sources: rows.map((r: any) => ({
      document_id:    r.document_id,
      document_title: r.title,
      chunk_content:  r.content,
      similarity_score: Number(r.similarity),
    })),
  };
}
