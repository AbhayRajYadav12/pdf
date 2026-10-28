import { ABSTENTION_MESSAGE } from "@pdf-summary/shared";
import type { AccessScope, FusedHit, VectorStore } from "@pdf-summary/retrieval";
import { retrieve, type Reranker } from "@pdf-summary/retrieval";
import { sparseVector } from "@pdf-summary/retrieval";
import type { EmbeddingProvider } from "@pdf-summary/embeddings";
import {
  assignEvidence,
  detectVersionConflict,
  selectWithinBudget,
  validateCitations,
  type VerifiedCitation,
} from "./citations.js";
import { buildAnswerPrompt, visibleAnswer } from "./prompt.js";
import type { GenerationProvider } from "./provider.js";

export interface AnswerEvent {
  type: "status" | "retrieval" | "sources" | "token" | "completed" | "error";
  stage?: string;
  dense?: number;
  sparse?: number;
  fused?: number;
  text?: string;
  sources?: Array<{ evidenceId: string; documentName: string; pageStart: number; pageEnd: number; excerpt: string; chunkId: string; documentId: string }>;
  content?: string;
  citations?: VerifiedCitation[];
  abstained?: boolean;
  conflict?: boolean;
  model?: string;
  code?: string;
  message?: string;
}

export interface AnswerResult {
  content: string;
  citations: VerifiedCitation[];
  abstained: boolean;
  conflict: boolean;
  validationFailures: string[];
  model: string;
  outputTokens?: number;
  latencyMs: number;
}

export async function runGroundedAnswer(input: {
  question: string;
  history: Array<{ role: string; content: string }>;
  scope: AccessScope;
  store: VectorStore;
  embeddings: EmbeddingProvider;
  reranker: Reranker;
  generation: GenerationProvider;
  denseK: number;
  sparseK: number;
  candidateLimit: number;
  minScore: number;
  rerankerEnabled: boolean;
  contextBudget: number;
  maxOutputTokens: number;
  countTokens: (text: string) => number;
  signal: AbortSignal;
  onEvent: (event: AnswerEvent) => void;
}): Promise<AnswerResult> {
  const started = Date.now();
  input.onEvent({ type: "status", stage: "embedding_query" });
  const dense = await input.embeddings.embedQuery(input.question);
  input.onEvent({ type: "status", stage: "retrieving" });
  const retrieved = await retrieve(input.store, input.reranker, sparseVector, {
    dense,
    sparseText: input.question,
    scope: input.scope,
    denseK: input.denseK,
    sparseK: input.sparseK,
    candidateLimit: input.candidateLimit,
    minScore: input.minScore,
    rerankerEnabled: input.rerankerEnabled,
  });
  input.onEvent({
    type: "retrieval",
    dense: retrieved.denseCount,
    sparse: retrieved.sparseCount,
    fused: retrieved.fusedCount,
  });
  if (retrieved.abstain) {
    return finishAbstain(input.onEvent, input.generation.model, started, retrieved.reason ?? "no_evidence");
  }
  const budgeted = selectWithinBudget(
    retrieved.hits.map((hit) => ({ ...hit, text: hit.payload.text })),
    input.contextBudget,
    (text) => input.countTokens(text),
  ) as Array<FusedHit & { text: string }>;
  const evidence = assignEvidence(budgeted);
  input.onEvent({
    type: "sources",
    sources: evidence.map((passage) => ({
      evidenceId: passage.id,
      documentId: passage.documentId,
      documentName: passage.documentName,
      pageStart: passage.pageStart,
      pageEnd: passage.pageEnd,
      chunkId: passage.chunkId,
      excerpt: passage.text.replace(/\s+/g, " ").trim().slice(0, 400),
    })),
  });
  input.onEvent({ type: "status", stage: "generating" });
  const prompt = buildAnswerPrompt({ question: input.question, evidence, history: input.history });
  let raw = "";
  let outputTokens: number | undefined;
  const stream = input.generation.stream(
    { system: prompt.system, user: prompt.user, maxOutputTokens: input.maxOutputTokens },
    input.signal,
  );
  while (true) {
    const next = await stream.next();
    if (next.done) {
      outputTokens = next.value?.outputTokens;
      break;
    }
    raw += next.value;
    input.onEvent({ type: "token", text: next.value });
    if (input.signal.aborted) break;
  }
  if (input.signal.aborted) {
    return {
      content: raw,
      citations: [],
      abstained: false,
      conflict: false,
      validationFailures: [],
      model: input.generation.model,
      outputTokens,
      latencyMs: Date.now() - started,
    };
  }
  const validated = validateCitations(raw, evidence);
  const abstained = validated.modelAbstained || validated.citations.length === 0;
  const citations = abstained ? [] : validated.citations;
  const content = visibleAnswer(raw, abstained);
  const conflict = detectVersionConflict(citations);
  const result: AnswerResult = {
    content: content || ABSTENTION_MESSAGE,
    citations,
    abstained,
    conflict,
    validationFailures: validated.failures,
    model: input.generation.model,
    outputTokens,
    latencyMs: Date.now() - started,
  };
  input.onEvent({
    type: "completed",
    content: result.content,
    citations,
    abstained,
    conflict,
    model: result.model,
  });
  return result;
}

function finishAbstain(
  onEvent: (event: AnswerEvent) => void,
  model: string,
  started: number,
  reason: string,
): AnswerResult {
  onEvent({
    type: "completed",
    content: ABSTENTION_MESSAGE,
    citations: [],
    abstained: true,
    conflict: false,
    model,
    stage: reason,
  });
  return {
    content: ABSTENTION_MESSAGE,
    citations: [],
    abstained: true,
    conflict: false,
    validationFailures: [reason],
    model,
    latencyMs: Date.now() - started,
  };
}
