import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { AppError, chatSchema, renameSchema } from "@pdf-summary/shared";
import type { CitationRecord, ConversationRecord, DocumentRecord, MessageRecord } from "@pdf-summary/database";
import { countTokens } from "@pdf-summary/document-processing";
import { runGroundedAnswer, type AnswerEvent, type VerifiedCitation } from "@pdf-summary/generation";
import type { AppContext } from "./context.js";
import { asyncHandler } from "./http.js";
import { requireMembership, requireUser, type AuthedRequest } from "./session.js";

interface LiveGeneration {
  abort: AbortController;
  events: EventEmitter;
}

const live = new Map<string, LiveGeneration>();

export function chatRouter(ctx: AppContext): Router {
  const router = createRouter();
  router.use(requireUser(ctx));

  router.post("/conversations", asyncHandler(async (req, res) => {
    const workspaceId = stringField(req.body, "workspaceId");
    await requireMembership(ctx, req, workspaceId);
    const documentIds = Array.isArray(req.body?.documentIds) ? req.body.documentIds.map(String) : [];
    await assertDocuments(ctx, workspaceId, documentIds);
    const conversation = await ctx.db.createConversation({
      workspaceId,
      ownerId: (req as AuthedRequest).userId,
      title: "New conversation",
      documentIds,
    });
    res.status(201).json({ conversation: publicConversation(conversation) });
  }));

  router.get("/conversations", asyncHandler(async (req, res) => {
    const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "";
    await requireMembership(ctx, req, workspaceId);
    const conversations = await ctx.db.listConversations(workspaceId, (req as AuthedRequest).userId);
    res.json({ conversations: conversations.map(publicConversation) });
  }));

  router.get("/conversations/:id", asyncHandler(async (req, res) => {
    const conversation = await loadConversation(ctx, req, single(req.params.id));
    const messages = await ctx.db.listMessages(conversation._id);
    const citations = await Promise.all(messages.map((message) => ctx.db.listCitations(message._id)));
    res.json({
      conversation: publicConversation(conversation),
      messages: messages.map((message, index) => publicMessage(message, citations[index] ?? [])),
    });
  }));

  router.patch("/conversations/:id", asyncHandler(async (req, res) => {
    const conversation = await loadConversation(ctx, req, single(req.params.id));
    const input = renameSchema.parse(req.body);
    await ctx.db.updateConversation(conversation._id, { title: input.title });
    res.json({ conversation: publicConversation({ ...conversation, title: input.title }) });
  }));

  router.delete("/conversations/:id", asyncHandler(async (req, res) => {
    const conversation = await loadConversation(ctx, req, single(req.params.id));
    await ctx.db.deleteConversation(conversation._id);
    await ctx.db.addAudit({
      actorId: (req as AuthedRequest).userId,
      action: "conversation.delete",
      workspaceId: conversation.workspaceId,
      targetId: conversation._id,
    });
    res.status(204).end();
  }));

  router.post("/", asyncHandler(async (req, res) => {
    const input = chatSchema.parse(req.body);
    await requireMembership(ctx, req, input.workspaceId);
    const documents = await resolveDocuments(ctx, input.workspaceId, input.documentIds);
    let conversation: ConversationRecord;
    if (input.conversationId) {
      conversation = await loadConversation(ctx, req, input.conversationId);
      if (conversation.workspaceId !== input.workspaceId) throw new AppError("FORBIDDEN", "Conversation is in another workspace", 403);
      await ctx.db.updateConversation(conversation._id, { documentIds: documents.map((document) => document._id) });
    } else {
      conversation = await ctx.db.createConversation({
        workspaceId: input.workspaceId,
        ownerId: (req as AuthedRequest).userId,
        title: input.question.slice(0, 80),
        documentIds: documents.map((document) => document._id),
      });
    }
    const now = new Date();
    const userMessage: MessageRecord = {
      _id: randomUUID(),
      conversationId: conversation._id,
      workspaceId: input.workspaceId,
      role: "user",
      content: input.question,
      status: "completed",
      model: null,
      usage: null,
      error: null,
      abstained: false,
      conflict: false,
      validationFailures: [],
      createdAt: now,
      updatedAt: now,
    };
    const assistant: MessageRecord = {
      ...userMessage,
      _id: randomUUID(),
      role: "assistant",
      content: "",
      status: "pending",
      createdAt: new Date(now.getTime() + 1),
      updatedAt: new Date(now.getTime() + 1),
    };
    await ctx.db.insertMessage(userMessage);
    await ctx.db.insertMessage(assistant);
    await ctx.db.updateConversation(conversation._id, { updatedAt: new Date() });
    res.status(202).json({
      conversationId: conversation._id,
      messageId: assistant._id,
      streamPath: `/api/chat/${conversation._id}/stream?messageId=${assistant._id}`,
    });
  }));

  router.get("/:id/stream", asyncHandler(async (req, res) => {
    const conversation = await loadConversation(ctx, req, single(req.params.id));
    const messageId = typeof req.query.messageId === "string" ? req.query.messageId : undefined;
    const message = messageId
      ? await ctx.db.getMessage(messageId)
      : await ctx.db.latestAssistantMessage(conversation._id);
    if (!message || message.conversationId !== conversation._id) throw new AppError("NOT_FOUND", "Message not found", 404);
    await streamAnswer(ctx, req, res, conversation, message);
  }));

  router.post("/:id/cancel", asyncHandler(async (req, res) => {
    const conversation = await loadConversation(ctx, req, single(req.params.id));
    const messageId = typeof req.body?.messageId === "string" ? req.body.messageId : undefined;
    const message = messageId ? await ctx.db.getMessage(messageId) : await ctx.db.latestAssistantMessage(conversation._id);
    if (!message || message.conversationId !== conversation._id) throw new AppError("NOT_FOUND", "Message not found", 404);
    live.get(message._id)?.abort.abort();
    if (message.status === "pending" || message.status === "streaming") {
      await ctx.db.updateMessage(message._id, { status: "cancelled", error: "Generation cancelled" });
    }
    res.json({ messageId: message._id, status: "cancelled" });
  }));

  router.post("/:id/retry", asyncHandler(async (req, res) => {
    const conversation = await loadConversation(ctx, req, single(req.params.id));
    const messageId = typeof req.body?.messageId === "string" ? req.body.messageId : "";
    const message = await ctx.db.getMessage(messageId);
    if (!message || message.conversationId !== conversation._id || message.role !== "assistant") {
      throw new AppError("NOT_FOUND", "Message not found", 404);
    }
    if (message.status !== "failed" && message.status !== "cancelled") {
      throw new AppError("CONFLICT", "Only failed or cancelled responses can be retried", 409);
    }
    await ctx.db.updateMessage(message._id, {
      status: "pending",
      content: "",
      error: null,
      abstained: false,
      validationFailures: [],
    });
    await ctx.db.replaceCitations(message._id, []);
    res.json({ conversationId: conversation._id, messageId: message._id });
  }));

  router.get("/:id/sources", asyncHandler(async (req, res) => {
    const conversation = await loadConversation(ctx, req, single(req.params.id));
    const messageId = typeof req.query.messageId === "string" ? req.query.messageId : "";
    const message = await ctx.db.getMessage(messageId);
    if (!message || message.conversationId !== conversation._id) throw new AppError("NOT_FOUND", "Message not found", 404);
    const citations = await ctx.db.listCitations(message._id);
    res.json({ sources: citations.map(publicCitation) });
  }));

  return router;
}

async function streamAnswer(
  ctx: AppContext,
  req: Request,
  res: Response,
  conversation: ConversationRecord,
  message: MessageRecord,
): Promise<void> {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  let sequence = 0;
  let closed = false;
  req.on("close", () => {
    closed = true;
  });
  const send = (event: string, data: unknown) => {
    if (closed || res.writableEnded) return;
    sequence += 1;
    res.write(`id: ${sequence}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => {
    if (!closed && !res.writableEnded) res.write(`: heartbeat\n\n`);
  }, 15_000);
  try {
    if (message.status === "completed" || message.status === "abstained" || message.status === "failed" || message.status === "cancelled") {
      const citations = await ctx.db.listCitations(message._id);
      send("status", { stage: message.status });
      send("completed", {
        content: message.content,
        citations: citations.map(publicCitation),
        abstained: message.abstained,
        conflict: message.conflict,
        model: message.model,
        error: message.error,
      });
      return;
    }
    const existing = live.get(message._id);
    if (message.status === "streaming" && existing) {
      await attach(existing, send);
      return;
    }
    if (message.status === "streaming" && !existing) {
      await ctx.db.updateMessage(message._id, { status: "failed", error: "Generation was interrupted. Retry the question." });
      send("error", { code: "INTERRUPTED", message: "Generation was interrupted. Retry the question." });
      return;
    }
    const claimed = await ctx.db.claimMessage(message._id, "pending", "streaming");
    if (!claimed) {
      send("error", { code: "CONFLICT", message: "This response is already being generated." });
      return;
    }
    const generation = begin(message._id);
    req.on("close", () => {
      if (!res.writableEnded) generation.abort.abort();
    });
    const history = (await ctx.db.listMessages(conversation._id))
      .filter((item) => item._id !== message._id && item.createdAt < message.createdAt)
      .map((item) => ({ role: item.role, content: item.content }));
    const question = [...history].reverse().find((item) => item.role === "user")?.content ?? "";
    const documents = await resolveDocuments(ctx, conversation.workspaceId, conversation.documentIds);
    let buffer = "";
    let completedEvent: AnswerEvent | null = null;
    try {
      const result = await runGroundedAnswer({
        question,
        history: history.filter((item) => item.role !== "user" || item.content !== question),
        scope: {
          workspaceId: conversation.workspaceId,
          documents: documents.map((document) => ({ documentId: document._id, version: document.readyVersion ?? document.version })),
        },
        store: ctx.vectors,
        embeddings: ctx.embeddings,
        reranker: ctx.reranker,
        generation: ctx.generation,
        denseK: ctx.env.RETRIEVAL_DENSE_K,
        sparseK: ctx.env.RETRIEVAL_SPARSE_K,
        candidateLimit: ctx.env.RERANK_CANDIDATES,
        minScore: ctx.env.RELEVANCE_MIN_SCORE,
        rerankerEnabled: ctx.env.RERANKER_PROVIDER !== "none",
        contextBudget: ctx.env.CONTEXT_TOKEN_BUDGET,
        maxOutputTokens: ctx.env.GENERATION_MAX_OUTPUT_TOKENS,
        countTokens,
        signal: generation.abort.signal,
        onEvent: (event) => {
          if (event.type === "completed") {
            completedEvent = event;
            return;
          }
          generation.events.emit("event", event);
          send(event.type, event);
          if (event.type === "token" && event.text) buffer += event.text;
        },
      });
      if (generation.abort.signal.aborted) {
        await ctx.db.updateMessage(message._id, { status: "cancelled", content: buffer || result.content, error: "Generation cancelled" });
        send("error", { code: "CANCELLED", message: "Generation cancelled" });
      } else {
        await persistResult(ctx, message, result.content, result.citations, result);
        await ctx.db.addUsage({
          workspaceId: conversation.workspaceId,
          kind: "generation",
          model: result.model,
          latencyMs: result.latencyMs,
          units: result.outputTokens ?? result.content.length,
        });
        if (completedEvent) {
          generation.events.emit("event", completedEvent);
          send("completed", completedEvent);
        }
      }
    } catch (error) {
      const appError = error instanceof AppError
        ? error
        : new AppError("CHAT", "The answer could not be generated", 500);
      if (generation.abort.signal.aborted) {
        await ctx.db.updateMessage(message._id, { status: "cancelled", content: buffer, error: "Generation cancelled" });
        send("error", { code: "CANCELLED", message: "Generation cancelled" });
      } else {
        await ctx.db.updateMessage(message._id, { status: "failed", content: buffer, error: appError.message });
        send("error", { code: appError.code, message: appError.message });
      }
    } finally {
      generation.events.emit("done");
      live.delete(message._id);
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
}

function begin(messageId: string): LiveGeneration {
  const generation: LiveGeneration = { abort: new AbortController(), events: new EventEmitter() };
  generation.events.setMaxListeners(20);
  live.set(messageId, generation);
  return generation;
}

async function attach(generation: LiveGeneration, send: (event: string, data: unknown) => void): Promise<void> {
  const onEvent = (event: AnswerEvent) => send(event.type, event);
  generation.events.on("event", onEvent);
  await new Promise<void>((resolve) => generation.events.once("done", () => resolve()));
}

async function persistResult(
  ctx: AppContext,
  message: MessageRecord,
  content: string,
  citations: VerifiedCitation[],
  result: { abstained: boolean; conflict: boolean; validationFailures: string[]; model: string; latencyMs: number; outputTokens?: number },
): Promise<void> {
  await ctx.db.updateMessage(message._id, {
    status: result.abstained ? "abstained" : "completed",
    content,
    model: result.model,
    abstained: result.abstained,
    conflict: result.conflict,
    validationFailures: result.validationFailures,
    error: null,
    usage: { outputTokens: result.outputTokens, latencyMs: result.latencyMs },
  });
  const records: CitationRecord[] = citations.map((citation) => ({
    _id: randomUUID(),
    messageId: message._id,
    workspaceId: message.workspaceId,
    documentId: citation.documentId,
    documentName: citation.documentName,
    documentVersion: citation.documentVersion,
    chunkId: citation.chunkId,
    pageStart: citation.pageStart,
    pageEnd: citation.pageEnd,
    evidenceId: citation.evidenceId,
    excerpt: citation.excerpt,
    createdAt: new Date(),
  }));
  await ctx.db.replaceCitations(message._id, records);
}

async function resolveDocuments(ctx: AppContext, workspaceId: string, documentIds?: string[]): Promise<DocumentRecord[]> {
  if (!documentIds || documentIds.length === 0) {
    const listed = await ctx.db.listDocuments({ workspaceId, limit: 50, offset: 0 });
    const ready = listed.items.filter((document) => document.readyVersion !== null && document.status !== "deleting");
    if (ready.length === 0) throw new AppError("CONFLICT", "This workspace has no documents ready for questions", 409);
    return ready;
  }
  return assertDocuments(ctx, workspaceId, documentIds);
}

async function assertDocuments(ctx: AppContext, workspaceId: string, documentIds: string[]): Promise<DocumentRecord[]> {
  if (documentIds.length === 0) return [];
  const documents: DocumentRecord[] = [];
  for (const id of documentIds) {
    const document = await ctx.db.getDocument(id);
    if (!document || document.workspaceId !== workspaceId || document.readyVersion === null) {
      throw new AppError("NOT_FOUND", "One or more documents are not available in this workspace", 404);
    }
    documents.push(document);
  }
  return documents;
}

async function loadConversation(ctx: AppContext, req: Request, id: string): Promise<ConversationRecord> {
  const conversation = await ctx.db.getConversation(id);
  if (!conversation || conversation.ownerId !== (req as AuthedRequest).userId) {
    throw new AppError("NOT_FOUND", "Conversation not found", 404);
  }
  await requireMembership(ctx, req, conversation.workspaceId);
  return conversation;
}

function publicConversation(conversation: ConversationRecord) {
  return {
    id: conversation._id,
    workspaceId: conversation.workspaceId,
    title: conversation.title,
    documentIds: conversation.documentIds,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function publicMessage(message: MessageRecord, citations: CitationRecord[]) {
  return {
    id: message._id,
    role: message.role,
    content: message.content,
    status: message.status,
    model: message.model,
    abstained: message.abstained,
    conflict: message.conflict,
    error: message.error,
    createdAt: message.createdAt,
    citations: citations.map(publicCitation),
  };
}

function publicCitation(citation: CitationRecord) {
  return {
    evidenceId: citation.evidenceId,
    documentId: citation.documentId,
    documentName: citation.documentName,
    documentVersion: citation.documentVersion,
    chunkId: citation.chunkId,
    pageStart: citation.pageStart,
    pageEnd: citation.pageEnd,
    excerpt: citation.excerpt,
  };
}

function single(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw new AppError("VALIDATION", "Missing id", 400);
  return id;
}

function stringField(body: unknown, key: string): string {
  if (!body || typeof body !== "object" || !(key in body)) return "";
  return String((body as Record<string, unknown>)[key] ?? "");
}
