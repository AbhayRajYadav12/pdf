import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { AppError, documentListSchema, summarySchema } from "@pdf-summary/shared";
import type { Request } from "express";
import type { DocumentRecord } from "@pdf-summary/database";
import { readPageCount, removeDocument, newDocumentId, sha256, storageKeyFor } from "@pdf-summary/document-processing";
import { summarizeChunks } from "@pdf-summary/generation";
import { countTokens } from "@pdf-summary/document-processing";
import type { AppContext } from "./context.js";
import { asyncHandler } from "./http.js";
import { requireMembership, requireUser, type AuthedRequest } from "./session.js";

const upload = multer({
  dest: path.join(os.tmpdir(), "pdf-summary-uploads"),
  limits: { fileSize: 52_428_800, files: 1 },
});

export function documentRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireUser(ctx));

  router.post("/", upload.single("file"), asyncHandler(async (req, res) => {
    const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "";
    await requireMembership(ctx, req, workspaceId);
    const file = req.file;
    if (!file) throw new AppError("VALIDATION", "A PDF file is required", 400);
    try {
      const bytes = await readFile(file.path);
      if (!bytes.subarray(0, 5).toString("latin1").startsWith("%PDF")) {
        throw new AppError("INVALID_PDF", "Only PDF files can be uploaded", 400);
      }
      if (bytes.length > ctx.env.MAX_UPLOAD_BYTES) {
        throw new AppError("LIMIT", "The file exceeds the upload size limit", 413);
      }
      const pageCount = await readPageCount(new Uint8Array(bytes));
      if (pageCount > ctx.env.MAX_PDF_PAGES) {
        throw new AppError("LIMIT", `PDFs are limited to ${ctx.env.MAX_PDF_PAGES} pages`, 413);
      }
      const id = newDocumentId();
      const version = 1;
      const record: DocumentRecord = {
        _id: id,
        workspaceId,
        ownerId: (req as AuthedRequest).userId,
        filename: sanitizeFilename(file.originalname),
        storageKey: storageKeyFor({ workspaceId, _id: id, version }),
        mimeType: "application/pdf",
        size: bytes.length,
        pageCount,
        status: "queued",
        progress: { stage: "queued", percent: 0 },
        error: null,
        version,
        readyVersion: null,
        contentHash: sha256(bytes),
        chunkCount: 0,
        embeddingModelVersion: null,
        ocrPageCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ctx.store.put(record.storageKey, bytes);
      await ctx.db.insertDocument(record);
      await ctx.db.upsertJob({
        _id: `${id}:${version}`,
        documentId: id,
        workspaceId,
        version,
        status: "queued",
        attempt: 0,
        stage: "queued",
        error: null,
        retryable: false,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await ctx.queue.enqueue({ documentId: id, workspaceId, version });
      await ctx.db.addAudit({
        actorId: (req as AuthedRequest).userId,
        action: "document.upload",
        workspaceId,
        targetId: id,
      });
      res.status(202).json({ document: publicDocument(record) });
    } finally {
      if (file) await unlink(file.path).catch(() => undefined);
    }
  }));

  router.get("/", asyncHandler(async (req, res) => {
    const query = documentListSchema.parse(req.query);
    await requireMembership(ctx, req, query.workspaceId);
    const result = await ctx.db.listDocuments(query);
    res.json({ items: result.items.map(publicDocument), total: result.total });
  }));

  router.get("/:id", asyncHandler(async (req, res) => {
    const document = await loadAuthorizedDocument(ctx, req, param(req.params.id));
    res.json({ document: publicDocument(document) });
  }));

  router.get("/:id/progress", asyncHandler(async (req, res) => {
    const document = await loadAuthorizedDocument(ctx, req, param(req.params.id));
    const job = await ctx.db.getJob(document._id, document.version);
    res.json({
      documentId: document._id,
      status: document.status,
      progress: document.progress,
      error: document.error,
      version: document.version,
      readyVersion: document.readyVersion,
      job: job ? { status: job.status, stage: job.stage, attempt: job.attempt, error: job.error, retryable: job.retryable } : null,
    });
  }));

  router.get("/:id/file", asyncHandler(async (req, res) => {
    const document = await loadAuthorizedDocument(ctx, req, param(req.params.id));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(document.filename)}"`);
    const stream = await ctx.store.open(document.storageKey);
    stream.pipe(res);
  }));

  router.post("/:id/retry", asyncHandler(async (req, res) => {
    const document = await loadAuthorizedDocument(ctx, req, param(req.params.id));
    if (document.status !== "failed") throw new AppError("CONFLICT", "Only failed documents can be retried", 409);
    await ctx.db.updateDocument(document._id, { status: "queued", error: null, progress: { stage: "queued", percent: 0 } });
    await ctx.queue.enqueue({ documentId: document._id, workspaceId: document.workspaceId, version: document.version });
    await ctx.db.addAudit({ actorId: (req as AuthedRequest).userId, action: "document.retry", workspaceId: document.workspaceId, targetId: document._id });
    res.json({ documentId: document._id, status: "queued", version: document.version });
  }));

  router.post("/:id/reprocess", asyncHandler(async (req, res) => {
    const document = await loadAuthorizedDocument(ctx, req, param(req.params.id));
    if (document.status === "processing" || document.status === "queued" || document.status === "deleting") {
      throw new AppError("CONFLICT", "This document is already being processed", 409);
    }
    const version = document.version + 1;
    await ctx.db.updateDocument(document._id, {
      version,
      status: "queued",
      error: null,
      progress: { stage: "queued", percent: 0 },
    });
    await ctx.queue.enqueue({ documentId: document._id, workspaceId: document.workspaceId, version });
    await ctx.db.addAudit({ actorId: (req as AuthedRequest).userId, action: "document.reprocess", workspaceId: document.workspaceId, targetId: document._id });
    res.status(202).json({ documentId: document._id, status: "queued", version, readyVersion: document.readyVersion });
  }));

  router.delete("/:id", asyncHandler(async (req, res) => {
    const document = await loadAuthorizedDocument(ctx, req, param(req.params.id));
    const userId = (req as AuthedRequest).userId;
    const membership = await ctx.db.getMembership(document.workspaceId, userId);
    if (!membership) throw new AppError("FORBIDDEN", "You do not have access to this workspace", 403);
    if (membership.role !== "admin" && document.ownerId !== userId) {
      throw new AppError("FORBIDDEN", "Only an administrator or the uploader can delete this document", 403);
    }
    await removeDocument({ db: ctx.db, store: ctx.store, vectors: ctx.vectors, document });
    await ctx.db.addAudit({ actorId: userId, action: "document.delete", workspaceId: document.workspaceId, targetId: document._id });
    res.status(204).end();
  }));

  router.post("/:id/summarize", asyncHandler(async (req, res) => {
    const document = await loadAuthorizedDocument(ctx, req, param(req.params.id));
    if (!document.readyVersion) throw new AppError("CONFLICT", "The document is not ready to summarize", 409);
    const input = summarySchema.parse(req.body ?? {});
    const existing = await ctx.db.getSummary(document._id, document.readyVersion, input.style, input.length);
    if (existing) {
      res.json({ summary: existing });
      return;
    }
    const chunks = await ctx.db.getChunks(document._id, document.readyVersion);
    const started = Date.now();
    const draft = await summarizeChunks({
      chunks,
      style: input.style,
      length: input.length,
      generation: ctx.generation,
      countTokens,
      contextBudget: ctx.env.CONTEXT_TOKEN_BUDGET,
      maxOutputTokens: ctx.env.GENERATION_MAX_OUTPUT_TOKENS,
      signal: AbortSignal.timeout(ctx.env.JOB_TIMEOUT_MS),
    });
    await ctx.db.addUsage({
      workspaceId: document.workspaceId,
      kind: "generation",
      model: draft.model,
      latencyMs: Date.now() - started,
      units: draft.content.length,
    });
    const summary = {
      _id: randomUUID(),
      documentId: document._id,
      workspaceId: document.workspaceId,
      version: document.readyVersion,
      style: input.style,
      length: input.length,
      content: draft.content,
      model: draft.model,
      claims: draft.claims.map((claim) => ({
        text: claim.text,
        evidenceId: claim.evidenceId,
        chunkId: claim.chunkId,
        pageStart: claim.pageStart,
        pageEnd: claim.pageEnd,
        excerpt: claim.excerpt,
      })),
      createdAt: new Date(),
    };
    await ctx.db.saveSummary(summary);
    res.json({ summary });
  }));

  router.get("/:id/summary", asyncHandler(async (req, res) => {
    const document = await loadAuthorizedDocument(ctx, req, param(req.params.id));
    const query = z.object({
      style: z.string().default("executive"),
      length: z.string().default("medium"),
    }).parse(req.query);
    if (!document.readyVersion) {
      res.json({ summary: null });
      return;
    }
    const summary = await ctx.db.getSummary(document._id, document.readyVersion, query.style, query.length);
    res.json({ summary });
  }));

  return router;
}

async function loadAuthorizedDocument(ctx: AppContext, req: Request, id: string): Promise<DocumentRecord> {
  const document = await ctx.db.getDocument(id);
  if (!document) throw new AppError("NOT_FOUND", "Document not found", 404);
  try {
    await requireMembership(ctx, req, document.workspaceId);
  } catch (error) {
    if (error instanceof AppError && (error.status === 403 || error.status === 404)) {
      throw new AppError("NOT_FOUND", "Document not found", 404);
    }
    throw error;
  }
  return document;
}

function publicDocument(document: DocumentRecord) {
  return {
    id: document._id,
    workspaceId: document.workspaceId,
    filename: document.filename,
    size: document.size,
    pageCount: document.pageCount,
    status: document.status,
    progress: document.progress,
    error: document.error,
    version: document.version,
    readyVersion: document.readyVersion,
    chunkCount: document.chunkCount,
    embeddingModelVersion: document.embeddingModelVersion,
    ocrPageCount: document.ocrPageCount,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[\r\n"]/g, "").slice(0, 180);
  return base || "document.pdf";
}

function param(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw new AppError("VALIDATION", "Missing id", 400);
  return id;
}
