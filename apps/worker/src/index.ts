import { Queue, UnrecoverableError, Worker } from "bullmq";
import { loadEnv } from "@pdf-summary/shared/env";
import { AppError, createLogger } from "@pdf-summary/shared";
import { connectDatabase } from "@pdf-summary/database";
import {
  applyRetention,
  createTesseractOcr,
  ingestDocument,
  LocalObjectStore,
  removeDocument,
} from "@pdf-summary/document-processing";
import { createEmbeddingProvider } from "@pdf-summary/embeddings";
import { QdrantVectorStore } from "@pdf-summary/retrieval";
import { Redis } from "ioredis";

const INGESTION_QUEUE = "ingestion";
const logger = createLogger("worker");
const env = loadEnv();
if (env.INGESTION_MODE !== "queue") throw new Error("The worker requires INGESTION_MODE=queue");
if (env.QDRANT_URL === "memory") throw new Error("The worker requires a Qdrant URL");

const db = await connectDatabase(env.MONGODB_URI);
const store = new LocalObjectStore(env.STORAGE_DIR);
const vectors = new QdrantVectorStore(env.QDRANT_URL, env.QDRANT_COLLECTION);
const embeddings = createEmbeddingProvider(env);
const ocr = createTesseractOcr();
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
await vectors.ensureCollection(env.EMBEDDING_DIMENSIONS);

const queue = new Queue(INGESTION_QUEUE, { connection });

async function processJob(data: { documentId: string; workspaceId: string; version: number }): Promise<void> {
  try {
    await ingestDocument({
      env,
      db,
      store,
      vectors,
      embeddings,
      ocr,
      job: data,
      signal: AbortSignal.timeout(env.JOB_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof AppError && !error.retryable) throw new UnrecoverableError(error.message);
    throw error;
  }
}

const worker = new Worker(INGESTION_QUEUE, async (job) => {
  logger.info({ jobId: job.id, documentId: job.data.documentId }, "ingestion started");
  await processJob(job.data);
}, {
  connection,
  concurrency: env.INGESTION_CONCURRENCY,
  lockDuration: env.JOB_TIMEOUT_MS,
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, err: error }, "ingestion job failed");
});

async function reconcile(): Promise<void> {
  const stuck = await db.listStuckDocuments(new Date(Date.now() - 60_000));
  for (const document of stuck) {
    if (document.status === "deleting") {
      await removeDocument({ db, store, vectors, document }).catch((error: unknown) => {
        logger.error({ err: error, documentId: document._id }, "deletion reconciliation failed");
      });
      continue;
    }
    const jobId = `${document._id}:${document.version}`;
    const existing = await queue.getJob(jobId);
    if (existing && (await existing.isActive() || await existing.isWaiting())) continue;
    await db.updateDocument(document._id, { status: "queued", progress: { stage: "queued", percent: 0 } });
    await queue.add("ingest", {
      documentId: document._id,
      workspaceId: document.workspaceId,
      version: document.version,
    }, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    }).catch(() => undefined);
    logger.info({ documentId: document._id }, "requeued document after an interrupted job");
  }
  const workspaces = await db.workspaces().find({ retentionDays: { $gt: 0 } }).toArray();
  const removed = await applyRetention({ db, store, vectors, workspaces });
  if (removed > 0) logger.info({ removed }, "retention cleanup removed documents");
}

await reconcile();
const timer = setInterval(() => {
  void reconcile().catch((error: unknown) => logger.error({ err: error }, "reconciliation failed"));
}, 60 * 60 * 1000);

async function shutdown() {
  clearInterval(timer);
  await worker.close();
  await queue.close();
  await connection.quit();
  await db.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
logger.info("worker listening");
