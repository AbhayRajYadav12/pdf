import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashEmbed } from "@pdf-summary/embeddings";
import {
  applyRelevanceGate,
  createLexicalReranker,
  MemoryVectorStore,
  reciprocalRankFusion,
  sparseVector,
  type VectorPoint,
} from "@pdf-summary/retrieval";
import { meanReciprocalRank, ndcgAtK, precision, recallAtK } from "./metrics.js";

export interface EvalQuestion {
  id: string;
  question: string;
  relevant: string[];
  answerable: boolean;
}

export interface EvalPassage {
  id: string;
  title: string;
  text: string;
}

export const passages: EvalPassage[] = [
  { id: "p1", title: "Contract", text: "The contract reference is ZX-4419 and the renewal date is 12 March 2026." },
  { id: "p2", title: "Billing", text: "Invoice terms require payment within 30 days of the billing date." },
  { id: "p3", title: "Support", text: "Priority support covers severity 1 incidents with a four hour response target." },
  { id: "p4", title: "Decoy", text: "The warehouse aisle code ZX-100 is unrelated to the customer contract." },
];

export const questions: EvalQuestion[] = [
  { id: "q1", question: "What is the contract reference?", relevant: ["p1"], answerable: true },
  { id: "q2", question: "What is the payment window?", relevant: ["p2"], answerable: true },
  { id: "q3", question: "What is the severity 1 response target?", relevant: ["p3"], answerable: true },
  { id: "q4", question: "What is the mascot color?", relevant: [], answerable: false },
];

export async function evaluateFixture(dimensions = 128) {
  const store = new MemoryVectorStore();
  await store.ensureCollection(dimensions);
  const points: VectorPoint[] = passages.map((passage) => ({
    id: passage.id,
    dense: hashEmbed(`title: ${passage.title} | text: ${passage.text}`, dimensions),
    sparse: sparseVector(passage.text),
    payload: {
      tenantId: "ws",
      workspaceId: "ws",
      documentId: "doc",
      documentVersion: 1,
      chunkId: passage.id,
      pageStart: 1,
      pageEnd: 1,
      sectionTitle: passage.title,
      documentName: "fixture.pdf",
      contentHash: passage.id,
      text: passage.text,
      embeddingModelVersion: "deterministic-feature-hash",
    },
  }));
  await store.upsert(points);
  const scope = { workspaceId: "ws", documents: [{ documentId: "doc", version: 1 }] };
  const reranker = createLexicalReranker();
  const modes = ["dense", "sparse", "hybrid", "hybrid_rerank", "hybrid_rerank_gate"] as const;
  const totals = Object.fromEntries(modes.map((mode) => [mode, { recallAt5: 0, mrr: 0, ndcgAt5: 0, abstained: 0 }])) as Record<
    (typeof modes)[number],
    { recallAt5: number; mrr: number; ndcgAt5: number; abstained: number }
  >;
  const perQuestion = [];
  for (const question of questions) {
    const denseVector = hashEmbed(`task: search result | query: ${question.question}`, dimensions);
    const denseHits = await store.searchDense(denseVector, scope, 5);
    const sparseHits = await store.searchSparse(sparseVector(question.question), scope, 5);
    const fused = reciprocalRankFusion(denseHits, sparseHits);
    const reranked = (await reranker.rerank(question.question, fused, 5)).hits;
    const gated = applyRelevanceGate(reranked, { minScore: 0.35, rerankerEnabled: true });
    const lists = {
      dense: denseHits.map((hit) => hit.chunkId),
      sparse: sparseHits.map((hit) => hit.chunkId),
      hybrid: fused.map((hit) => hit.chunkId),
      hybrid_rerank: reranked.map((hit) => hit.chunkId),
      hybrid_rerank_gate: gated.abstain ? [] : gated.accepted.map((hit) => hit.chunkId),
    };
    const row: Record<string, unknown> = { id: question.id, answerable: question.answerable };
    for (const mode of modes) {
      const retrieved = lists[mode];
      const metrics = {
        recallAt5: recallAtK(question.relevant, retrieved, 5),
        mrr: meanReciprocalRank(question.relevant, retrieved),
        ndcgAt5: ndcgAtK(new Set(question.relevant), retrieved, 5),
        abstained: retrieved.length === 0,
      };
      totals[mode].recallAt5 += metrics.recallAt5;
      totals[mode].mrr += metrics.mrr;
      totals[mode].ndcgAt5 += metrics.ndcgAt5;
      totals[mode].abstained += metrics.abstained ? 1 : 0;
      row[mode] = { retrieved, ...metrics };
    }
    perQuestion.push(row);
  }
  const count = questions.length;
  const summary = Object.fromEntries(
    modes.map((mode) => [
      mode,
      {
        recallAt5: totals[mode].recallAt5 / count,
        mrr: totals[mode].mrr / count,
        ndcgAt5: totals[mode].ndcgAt5 / count,
        abstained: totals[mode].abstained,
      },
    ]),
  );
  const answerable = questions.filter((question) => question.answerable);
  const unanswerable = questions.filter((question) => !question.answerable);
  const gateRows = perQuestion.filter((row) => unanswerable.some((question) => question.id === row.id));
  const abstention = {
    note: "Abstention here means the relevance gate returned no passages. It is not a calibrated production threshold.",
    unanswerableAbstentions: gateRows.filter((row) => {
      const gate = row.hybrid_rerank_gate as { abstained: boolean };
      return gate.abstained;
    }).length,
    unanswerableCount: unanswerable.length,
    answerableCount: answerable.length,
  };
  return {
    generatedAt: new Date().toISOString(),
    embedding: "deterministic-feature-hash",
    reranker: "lexical-overlap",
    disclaimer: "These figures describe this fixture only. They are not a claim about Gemini, BGE, or production accuracy.",
    summary,
    abstention,
    citationPrecisionOnTopHybrid: averageCitationPrecision(perQuestion),
    perQuestion,
  };
}

function averageCitationPrecision(rows: Array<Record<string, unknown>>): number {
  const scores = rows.map((row) => {
    const question = questions.find((item) => item.id === row.id);
    const hybrid = row.hybrid as { retrieved: string[] };
    if (!question || question.relevant.length === 0) return null;
    return precision(hybrid.retrieved.slice(0, 1), question.relevant);
  }).filter((score): score is number => score !== null);
  if (scores.length === 0) return 0;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export async function writeEvaluationReport(destination = path.resolve("ml/experiments/latest.json")): Promise<string> {
  const report = await evaluateFixture();
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(report, null, 2));
  return destination;
}
