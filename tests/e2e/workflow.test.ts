import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { loadEnv } from "@pdf-summary/shared/env";
import { createApp } from "../../apps/api/src/app.js";
import { createContext } from "../../apps/api/src/context.js";

describe("pdf workflow", () => {
  let mongo: MongoMemoryServer;
  let directory: string;
  let close: () => Promise<void>;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    directory = await mkdtemp(path.join(os.tmpdir(), "pdf-summary-"));
    const env = loadEnv({
      NODE_ENV: "test",
      APP_ORIGIN: "http://localhost:5173",
      API_PORT: "4000",
      BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
      BETTER_AUTH_URL: "http://127.0.0.1:4000",
      MONGODB_URI: mongo.getUri(),
      REDIS_URL: "redis://127.0.0.1:6399",
      QDRANT_URL: "memory",
      STORAGE_DIR: directory,
      GEMINI_API_KEY: "",
      EMBEDDING_PROVIDER: "deterministic",
      GENERATION_PROVIDER: "fixture",
      RERANKER_PROVIDER: "none",
      INGESTION_MODE: "inline",
      RATE_LIMIT_STORE: "memory",
      OCR_MIN_CHARS: "40",
      RELEVANCE_MIN_SCORE: "0.2",
    });
    const ctx = await createContext(env);
    close = ctx.close;
    app = createApp(ctx);
  }, 120000);

  afterAll(async () => {
    await close?.();
    await mongo?.stop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("registers, indexes a PDF, cites a page, abstains, and isolates tenants", async () => {
    const owner = request.agent(app);
    const registered = await owner.post("/api/auth/register").send({
      email: "owner@example.com",
      password: "correct-horse",
      name: "Owner",
    });
    expect(registered.status).toBe(201);
    const workspaceId = registered.body.workspace.id as string;

    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("The contract reference is ZX-4419 and the renewal date is 12 March 2026.", {
      x: 50,
      y: 720,
      size: 12,
      font,
    });
    const bytes = Buffer.from(await pdf.save());
    const uploaded = await owner
      .post("/api/documents")
      .field("workspaceId", workspaceId)
      .attach("file", bytes, { filename: "contract.pdf", contentType: "application/pdf" });
    expect(uploaded.status).toBe(202);
    const documentId = uploaded.body.document.id as string;

    let status = "queued";
    let pageCount = 0;
    for (let attempt = 0; attempt < 40 && status !== "ready" && status !== "failed"; attempt += 1) {
      const progress = await owner.get(`/api/documents/${documentId}/progress`).set("x-workspace-id", workspaceId);
      status = progress.body.status;
      pageCount = progress.body.progress ? pageCount : pageCount;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const ready = await owner.get(`/api/documents/${documentId}`).set("x-workspace-id", workspaceId);
    expect(ready.body.document.status).toBe("ready");
    expect(ready.body.document.pageCount).toBe(1);

    const asked = await owner.post("/api/chat").send({
      workspaceId,
      documentIds: [documentId],
      question: "What is the contract reference?",
    });
    expect(asked.status).toBe(202);
    const streamed = await owner.get(asked.body.streamPath).set("x-workspace-id", workspaceId);
    expect(streamed.text).toContain("event: completed");
    expect(streamed.text).toContain("ZX-4419");
    const sources = await owner.get(`/api/chat/${asked.body.conversationId}/sources?messageId=${asked.body.messageId}`);
    expect(sources.body.sources[0].pageStart).toBe(1);
    expect(sources.body.sources[0].documentId).toBe(documentId);

    const unknown = await owner.post("/api/chat").send({
      workspaceId,
      documentIds: [documentId],
      question: "What is the mascot color of the lunar office?",
    });
    const abstained = await owner.get(unknown.body.streamPath);
    expect(abstained.text).toContain("enough evidence");
    const noSources = await owner.get(`/api/chat/${unknown.body.conversationId}/sources?messageId=${unknown.body.messageId}`);
    expect(noSources.body.sources).toEqual([]);

    const intruder = request.agent(app);
    const other = await intruder.post("/api/auth/register").send({
      email: "intruder@example.com",
      password: "correct-horse",
      name: "Intruder",
    });
    expect(other.status).toBe(201);
    const denied = await intruder.get(`/api/documents/${documentId}`).set("x-workspace-id", other.body.workspace.id);
    expect(denied.status).toBe(404);

    const removed = await owner.delete(`/api/documents/${documentId}`).set("x-workspace-id", workspaceId);
    expect(removed.status).toBe(204);
    const gone = await owner.get(`/api/documents/${documentId}`).set("x-workspace-id", workspaceId);
    expect(gone.status).toBe(404);
  });
});
