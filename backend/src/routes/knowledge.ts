// Sprint 5 — Knowledge Base / Agency Brain endpoints
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { kbDocuments, kbChunks } from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { ragQuerySchema } from "../utils/validators";
import { saveFile, deleteFile } from "../services/storage";
import { ragQuery } from "../services/rag";
import { embeddingQueue } from "../services/queue";
import type { AppEnv } from "../types";

const knowledge = new Hono<AppEnv>();

// GET /knowledge/documents
knowledge.get("/documents", authMiddleware, async (c) => {
  const docs = await db
    .select()
    .from(kbDocuments)
    .orderBy(kbDocuments.createdAt);
  return c.json(docs);
});

// POST /knowledge/documents — multipart file upload
// Uses Hono's native parseBody() for multipart/form-data
knowledge.post("/documents", authMiddleware, async (c) => {
  const user = c.get("user");

  // Parse multipart form data
  const body = await c.req.parseBody();
  const file  = body["file"];
  const title = (body["title"] as string) || null;

  if (!file || typeof file === "string") {
    return c.json({ error: "A file is required" }, 400);
  }

  // Validate file type by extension
  const originalName = (file as File).name;
  const ext = originalName.split(".").pop()?.toLowerCase() ?? "";
  if (!["pdf", "txt", "md"].includes(ext)) {
    return c.json({ error: "File type not allowed. Supported: PDF, TXT, Markdown" }, 400);
  }

  // Validate file size (50 MB max)
  const maxBytes = (Number(process.env.MAX_FILE_SIZE_MB ?? 50)) * 1024 * 1024;
  if ((file as File).size > maxBytes) {
    return c.json({ error: `File exceeds ${process.env.MAX_FILE_SIZE_MB ?? 50} MB limit` }, 400);
  }

  const buffer = Buffer.from(await (file as File).arrayBuffer());

  let saved;
  try {
    saved = await saveFile(buffer, originalName);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  const [doc] = await db
    .insert(kbDocuments)
    .values({
      title:      title ?? originalName,
      filePath:   saved.filePath,
      fileUrl:    saved.fileUrl,
      fileType:   saved.fileType,
      fileSize:   saved.fileSize,
      uploadedBy: user.id,
      status:     "processing",
    })
    .returning();

  // Enqueue async embedding job
  await embeddingQueue.add("embed-document", {
    documentId: doc.id,
    filePath:   saved.filePath,
    fileType:   saved.fileType,
  });

  return c.json(doc, 201);
});

// GET /knowledge/documents/:id
knowledge.get("/documents/:id", authMiddleware, async (c) => {
  const [doc] = await db
    .select()
    .from(kbDocuments)
    .where(eq(kbDocuments.id, c.req.param("id")))
    .limit(1);

  if (!doc) return c.json({ error: "Document not found" }, 404);
  return c.json(doc);
});

// DELETE /knowledge/documents/:id — admin only
knowledge.delete("/documents/:id", authMiddleware, adminOnly, async (c) => {
  const id = c.req.param("id");

  const [doc] = await db
    .select()
    .from(kbDocuments)
    .where(eq(kbDocuments.id, id))
    .limit(1);

  if (!doc) return c.json({ error: "Document not found" }, 404);

  // Delete chunks (CASCADE handles this via FK, but explicit for clarity)
  await db.delete(kbChunks).where(eq(kbChunks.documentId, id));
  await db.delete(kbDocuments).where(eq(kbDocuments.id, id));

  // Delete file from disk
  if (doc.filePath) await deleteFile(doc.filePath);

  return new Response(null, { status: 204 });
});

// POST /knowledge/query — RAG semantic search
knowledge.post("/query", authMiddleware, async (c) => {
  const body = ragQuerySchema.parse(await c.req.json());
  const result = await ragQuery(body.query, body.top_k ?? 5);
  return c.json(result);
});

export default knowledge;
