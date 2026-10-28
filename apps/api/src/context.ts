import { createEmbeddingProvider, type EmbeddingProvider } from "@pdf-summary/embeddings";
import { createGenerationProvider, type GenerationProvider } from "@pdf-summary/generation";
import { connectDatabase, type Database } from "@pdf-summary/database";
import {
  createTesseractOcr,
  ingestDocument,
  LocalObjectStore,
  type OcrEngine,
  type ObjectStore,
} from "@pdf-summary/document-processing";
import {
  createBgeReranker,
  createNoopReranker,
  MemoryVectorStore,
  QdrantVectorStore,
  type Reranker,
  type VectorStore,
} from "@pdf-summary/retrieval";
import type { AppEnv } from "@pdf-summary/shared/env";
import { createAuth, type Auth } from "./auth.js";
import { createBullQueue, createInlineQueue, createRedis, type IngestionQueue } from "./queue.js";
import type { Redis } from "ioredis";

export interface AppContext {
  env: AppEnv;
  db: Database;
  auth: Auth;
  store: ObjectStore;
  vectors: VectorStore;
  embeddings: EmbeddingProvider;
  generation: GenerationProvider;
  reranker: Reranker;
  queue: IngestionQueue;
  redis: Redis | null;
  close: () => Promise<void>;
}

export async function createContext(env: AppEnv): Promise<AppContext> {
  const db = await connectDatabase(env.MONGODB_URI);
  const auth = createAuth(db, env);
  const store = new LocalObjectStore(env.STORAGE_DIR);
  const vectors: VectorStore = env.QDRANT_URL === "memory"
    ? new MemoryVectorStore()
    : new QdrantVectorStore(env.QDRANT_URL, env.QDRANT_COLLECTION);
  const embeddings = createEmbeddingProvider(env);
  const generation = createGenerationProvider(env);
  const reranker = env.RERANKER_PROVIDER === "bge" && env.RERANKER_URL
    ? createBgeReranker(env.RERANKER_URL, env.RERANKER_MODEL)
    : createNoopReranker();
  const ocr: OcrEngine = createTesseractOcr();
  let redis: Redis | null = null;
  if (env.INGESTION_MODE === "queue" || env.RATE_LIMIT_STORE === "redis") {
    redis = createRedis(env.REDIS_URL);
  }
  const queue: IngestionQueue = env.INGESTION_MODE === "inline" || !redis
    ? createInlineQueue((job) => ingestDocument({
        env,
        db,
        store,
        vectors,
        embeddings,
        ocr,
        job,
        signal: AbortSignal.timeout(env.JOB_TIMEOUT_MS),
      }))
    : createBullQueue(redis);
  await vectors.ensureCollection(env.EMBEDDING_DIMENSIONS);
  return {
    env,
    db,
    auth,
    store,
    vectors,
    embeddings,
    generation,
    reranker,
    queue,
    redis,
    async close() {
      await queue.close();
      if (redis) await redis.quit();
      await db.close();
    },
  };
}
