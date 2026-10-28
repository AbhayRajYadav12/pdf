import { randomUUID } from "node:crypto";
import { AppError, isRetryable } from "@pdf-summary/shared";
import type { AppEnv } from "@pdf-summary/shared/env";
import type { ChunkRecord, Database, DocumentRecord, ProcessingJobRecord } from "@pdf-summary/database";
import type { EmbeddingProvider } from "@pdf-summary/embeddings";
import type { VectorPoint, VectorStore } from "@pdf-summary/retrieval";
import { sparseVector } from "@pdf-summary/retrieval";
import { chunkDocument } from "./chunk.js";
import { extractPdf } from "./extract.js";
import type { OcrEngine } from "./ocr.js";
import type { ObjectStore } from "./storage.js";

export interface IngestJob {
  documentId: string;
  workspaceId: string;
  version: number;
}

export async function ingestDocument(input: {
  env: AppEnv;
  db: Database;
  store: ObjectStore;
  vectors: VectorStore;
  embeddings: EmbeddingProvider;
  ocr: OcrEngine;
  job: IngestJob;
  signal?: AbortSignal;
}): Promise<void> {
  const document = await input.db.getDocument(input.job.documentId);
  if (!document || document.workspaceId !== input.job.workspaceId) {
    throw new AppError("NOT_FOUND", "Document was not found for ingestion", 404);
  }
  if (document.version !== input.job.version) return;
  const jobId = `${document._id}:${input.job.version}`;
  const now = new Date();
  const job: ProcessingJobRecord = {
    _id: jobId,
    documentId: document._id,
    workspaceId: document.workspaceId,
    version: input.job.version,
    status: "processing",
    attempt: (await input.db.getJob(document._id, input.job.version))?.attempt ?? 0,
    stage: "start",
    error: null,
    retryable: false,
    startedAt: now,
    completedAt: null,
    createdAt: (await input.db.getJob(document._id, input.job.version))?.createdAt ?? now,
    updatedAt: now,
  };
  job.attempt += 1;
  await input.db.upsertJob(job);
  await input.db.updateDocument(document._id, { status: "processing", progress: { stage: "extract", percent: 10 }, error: null });
  try {
    throwIfAborted(input.signal);
    const bytes = await input.store.get(document.storageKey);
    const extracted = await extractPdf(new Uint8Array(bytes), { minChars: input.env.OCR_MIN_CHARS, ocr: input.ocr });
    if (extracted.pageCount > input.env.MAX_PDF_PAGES) {
      throw new AppError("LIMIT", `PDFs are limited to ${input.env.MAX_PDF_PAGES} pages`, 413);
    }
    await input.db.updateDocument(document._id, {
      pageCount: extracted.pageCount,
      ocrPageCount: extracted.ocrPageCount,
      progress: { stage: "chunk", percent: 35 },
    });
    await input.db.updateJob(jobId, { stage: "chunk" });
    const drafts = chunkDocument({
      pages: extracted.pages,
      workspaceId: document.workspaceId,
      documentId: document._id,
      version: input.job.version,
      targetTokens: input.env.CHUNK_TARGET_TOKENS,
      overlapTokens: input.env.CHUNK_OVERLAP_TOKENS,
    });
    if (drafts.length === 0) throw new AppError("EMPTY_DOCUMENT", "Chunking produced no text", 422);
    throwIfAborted(input.signal);
    await input.db.updateDocument(document._id, { progress: { stage: "embed", percent: 55 } });
    await input.db.updateJob(jobId, { stage: "embed" });
    const started = Date.now();
    const vectors = await input.embeddings.embedDocuments(drafts.map((draft) => ({ title: document.filename, text: draft.text })));
    await input.db.addUsage({
      workspaceId: document.workspaceId,
      kind: "embedding",
      model: input.embeddings.id,
      latencyMs: Date.now() - started,
      units: drafts.length,
    });
    if (vectors.length !== drafts.length) {
      throw new AppError("EMBEDDING", "The embedding provider returned an unexpected number of vectors", 502, undefined, true);
    }
    await input.vectors.ensureCollection(input.embeddings.dimensions);
    const points: VectorPoint[] = drafts.map((draft, index) => {
      const dense = vectors[index];
      if (!dense || dense.length !== input.embeddings.dimensions) {
        throw new AppError("EMBEDDING", "An embedding had the wrong dimensions", 502, undefined, true);
      }
      return {
        id: draft.id,
        dense,
        sparse: sparseVector(draft.text),
        payload: {
          tenantId: document.workspaceId,
          workspaceId: document.workspaceId,
          documentId: document._id,
          documentVersion: input.job.version,
          chunkId: draft.id,
          pageStart: draft.pageStart,
          pageEnd: draft.pageEnd,
          sectionTitle: draft.sectionTitle,
          documentName: document.filename,
          contentHash: draft.contentHash,
          text: draft.text,
          embeddingModelVersion: input.embeddings.id,
        },
      };
    });
    await input.db.updateDocument(document._id, { progress: { stage: "index", percent: 80 } });
    await input.db.updateJob(jobId, { stage: "index" });
    const chunks: ChunkRecord[] = drafts.map((draft) => ({
      _id: draft.id,
      workspaceId: document.workspaceId,
      documentId: document._id,
      documentName: document.filename,
      version: input.job.version,
      pageStart: draft.pageStart,
      pageEnd: draft.pageEnd,
      sectionTitle: draft.sectionTitle,
      text: draft.text,
      contentHash: draft.contentHash,
      tokenCount: draft.tokenCount,
      createdAt: new Date(),
    }));
    await input.vectors.upsert(points);
    const indexed = await input.vectors.count({ documentId: document._id, documentVersion: input.job.version });
    if (indexed < chunks.length) {
      throw new AppError("INDEX", `Indexed ${indexed} of ${chunks.length} chunks`, 502, undefined, true);
    }
    await input.db.replaceChunks(document._id, input.job.version, chunks);
    await input.vectors.deleteOtherVersions(document._id, input.job.version);
    await input.db.chunks().deleteMany({ documentId: document._id, version: { $ne: input.job.version } });
    await input.db.updateDocument(document._id, {
      status: "ready",
      readyVersion: input.job.version,
      chunkCount: chunks.length,
      embeddingModelVersion: input.embeddings.id,
      progress: { stage: "ready", percent: 100 },
      error: null,
      pageCount: extracted.pageCount,
      ocrPageCount: extracted.ocrPageCount,
    });
    await input.db.updateJob(jobId, { status: "ready", stage: "ready", completedAt: new Date(), error: null });
  } catch (error) {
    const retryable = isRetryable(error);
    const message = error instanceof AppError ? error.message : "Document processing failed";
    const keepReady = document.readyVersion !== null;
    await input.db.updateDocument(document._id, {
      status: keepReady ? "ready" : "failed",
      error: keepReady ? `Reprocessing failed: ${message}` : message,
      progress: { stage: keepReady ? "ready" : "failed", percent: keepReady ? 100 : document.progress.percent },
    });
    await input.db.updateJob(jobId, { status: "failed", error: message, retryable, completedAt: new Date() });
    if (error instanceof AppError) throw error;
    throw new AppError("INGEST", message, 500, undefined, retryable);
  }
}

export function storageKeyFor(document: Pick<DocumentRecord, "workspaceId" | "_id" | "version">): string {
  return `${document.workspaceId}/${document._id}/v${document.version}.pdf`;
}

export function newDocumentId(): string {
  return randomUUID();
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AppError("CANCELLED", "Ingestion was cancelled", 499, undefined, false);
}
