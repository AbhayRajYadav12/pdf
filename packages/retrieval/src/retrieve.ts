import { applyRelevanceGate } from "./gate.js";
import { reciprocalRankFusion } from "./rrf.js";
import type { Reranker as RerankerClient } from "./rerank.js";
import type { AccessScope, FusedHit, VectorStore } from "./types.js";

export interface RetrieveInput {
  dense: number[];
  sparseText: string;
  scope: AccessScope;
  denseK: number;
  sparseK: number;
  candidateLimit: number;
  minScore: number;
  rerankerEnabled: boolean;
}

export interface RetrieveOutput {
  hits: FusedHit[];
  abstain: boolean;
  reason: string | null;
  denseCount: number;
  sparseCount: number;
  fusedCount: number;
  rerankModel: string | null;
}

export async function retrieve(
  store: VectorStore,
  reranker: RerankerClient,
  sparseOf: (text: string) => { indices: number[]; values: number[] },
  input: RetrieveInput,
): Promise<RetrieveOutput> {
  if (!input.scope.workspaceId || input.scope.documents.length === 0) {
    return empty("no_evidence");
  }
  const [denseHits, sparseHits] = await Promise.all([
    store.searchDense(input.dense, input.scope, input.denseK),
    store.searchSparse(sparseOf(input.sparseText), input.scope, input.sparseK),
  ]);
  const fused = reciprocalRankFusion(denseHits, sparseHits).slice(0, input.candidateLimit);
  let rerankModel: string | null = null;
  let ranked = fused;
  if (input.rerankerEnabled) {
    const reranked = await reranker.rerank(input.sparseText, fused, input.candidateLimit);
    ranked = reranked.hits;
    rerankModel = reranked.model;
  }
  const gate = applyRelevanceGate(ranked, { minScore: input.minScore, rerankerEnabled: input.rerankerEnabled });
  return {
    hits: gate.accepted,
    abstain: gate.abstain,
    reason: gate.reason,
    denseCount: denseHits.length,
    sparseCount: sparseHits.length,
    fusedCount: fused.length,
    rerankModel,
  };
}

function empty(reason: string): RetrieveOutput {
  return { hits: [], abstain: true, reason, denseCount: 0, sparseCount: 0, fusedCount: 0, rerankModel: null };
}
