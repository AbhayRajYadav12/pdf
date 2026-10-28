import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { loadEnv } from "@pdf-summary/shared/env";
import { createLogger } from "@pdf-summary/shared";
import { createApp } from "../apps/api/src/app.js";
import { createContext } from "../apps/api/src/context.js";

const logger = createLogger("memory-api");
const mongo = await MongoMemoryServer.create();
const storage = await mkdtemp(path.join(os.tmpdir(), "pdf-summary-demo-"));
const env = loadEnv({
  NODE_ENV: "development",
  APP_ORIGIN: process.env.DEMO_ORIGIN ?? "http://localhost:5173",
  API_PORT: "4000",
  BETTER_AUTH_SECRET: "local-demo-secret-that-is-at-least-32",
  BETTER_AUTH_URL: "http://localhost:4000",
  MONGODB_URI: mongo.getUri(),
  REDIS_URL: "redis://127.0.0.1:6399",
  QDRANT_URL: "memory",
  STORAGE_DIR: storage,
  GEMINI_API_KEY: "",
  EMBEDDING_PROVIDER: "deterministic",
  GENERATION_PROVIDER: "fixture",
  RERANKER_PROVIDER: "none",
  INGESTION_MODE: "inline",
  RATE_LIMIT_STORE: "memory",
});
const ctx = await createContext(env);
const server = createApp(ctx).listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT, storage }, "development API using in-memory MongoDB, memory vectors, deterministic embeddings, and fixture answers");
});
server.requestTimeout = 0;

async function shutdown() {
  server.close();
  await ctx.close();
  await mongo.stop();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
