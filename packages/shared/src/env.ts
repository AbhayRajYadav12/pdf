import { z } from "zod";

const booleanString = z
  .union([z.boolean(), z.string()])
  .transform((value) => value === true || value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:4000"),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
  QDRANT_URL: z.string().min(1).default("http://127.0.0.1:6333"),
  QDRANT_COLLECTION: z.string().min(1).default("document_chunks"),
  STORAGE_DIR: z.string().min(1).default("./data/documents"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_GENERATION_MODEL: z.string().min(1).default("gemini-3.8-flash"),
  GEMINI_EMBEDDING_MODEL: z.string().min(1).default("gemini-embedding-2"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(128).max(3072).default(768),
  EMBEDDING_PROVIDER: z.enum(["gemini", "deterministic"]).default("gemini"),
  GENERATION_PROVIDER: z.enum(["gemini", "fixture"]).default("gemini"),
  RERANKER_PROVIDER: z.enum(["bge", "none"]).default("none"),
  RERANKER_URL: z.string().optional().default("http://127.0.0.1:8088"),
  RERANKER_MODEL: z.string().min(1).default("BAAI/bge-reranker-v2-m3"),
  INGESTION_MODE: z.enum(["queue", "inline"]).default("queue"),
  RATE_LIMIT_STORE: z.enum(["redis", "memory"]).default("redis"),
  TRUST_PROXY: booleanString.default(false),
  LOG_LEVEL: z.string().default("info"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(26_214_400),
  MAX_PDF_PAGES: z.coerce.number().int().positive().default(200),
  CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(700),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().int().nonnegative().default(100),
  OCR_MIN_CHARS: z.coerce.number().int().nonnegative().default(40),
  RETRIEVAL_DENSE_K: z.coerce.number().int().positive().default(20),
  RETRIEVAL_SPARSE_K: z.coerce.number().int().positive().default(20),
  RERANK_CANDIDATES: z.coerce.number().int().positive().default(20),
  CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(4000),
  GENERATION_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1024),
  RELEVANCE_MIN_SCORE: z.coerce.number().default(0.35),
  INGESTION_CONCURRENCY: z.coerce.number().int().positive().default(2),
  JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  METRICS_TOKEN: z.string().optional().default(""),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment: ${details}`);
  }
  const env = parsed.data;
  if (env.QDRANT_URL !== "memory") {
    try {
      new URL(env.QDRANT_URL);
    } catch {
      throw new Error("Invalid environment: QDRANT_URL must be an http URL or the test value memory");
    }
  }
  if (env.NODE_ENV === "production") {
    if (env.EMBEDDING_PROVIDER === "deterministic") {
      throw new Error("EMBEDDING_PROVIDER=deterministic is not allowed in production");
    }
    if (env.GENERATION_PROVIDER === "fixture") {
      throw new Error("GENERATION_PROVIDER=fixture is not allowed in production");
    }
    if (env.QDRANT_URL === "memory") {
      throw new Error("QDRANT_URL=memory is not allowed in production");
    }
    if (env.INGESTION_MODE === "inline") {
      throw new Error("INGESTION_MODE=inline is not allowed in production");
    }
  }
  if (env.CHUNK_OVERLAP_TOKENS >= env.CHUNK_TARGET_TOKENS) {
    throw new Error("CHUNK_OVERLAP_TOKENS must be smaller than CHUNK_TARGET_TOKENS");
  }
  return env;
}
