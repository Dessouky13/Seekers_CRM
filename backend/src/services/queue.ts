// Sprint 5 — BullMQ embedding queue
// Activated in Sprint 5 (Knowledge Base)
import { Queue, Worker } from "bullmq";
import { processDocumentEmbedding } from "./rag";

// BullMQ bundles its own ioredis — pass connection options directly
// to avoid type conflicts between top-level ioredis and BullMQ's internal copy.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host:               redisUrl.hostname,
  port:               parseInt(redisUrl.port || "6379", 10),
  password:           redisUrl.password || undefined,
  maxRetriesPerRequest: null as unknown as undefined,
};

export const embeddingQueue = new Queue("embedding", { connection });

// Worker: concurrency = 2 (process 2 documents at once)
export const embeddingWorker = new Worker(
  "embedding",
  async (job) => {
    const { documentId, filePath, fileType } = job.data as {
      documentId: string;
      filePath:   string;
      fileType:   string;
    };
    console.log(`[queue] Processing document: ${documentId}`);
    await processDocumentEmbedding(documentId, filePath, fileType);
    console.log(`[queue] Done: ${documentId}`);
  },
  {
    connection,
    concurrency: 2,
  },
);

embeddingWorker.on("failed", (job, err) => {
  console.error(`[queue] Job ${job?.id} failed:`, err.message);
});
