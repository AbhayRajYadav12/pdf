import type { FusedHit } from "./types.js";

export interface GateResult {
  accepted: FusedHit[];
  abstain: boolean;
  reason: string | null;
}

export function applyRelevanceGate(
  hits: FusedHit[],
  options: { minScore: number; rerankerEnabled: boolean },
): GateResult {
  if (hits.length === 0) return { accepted: [], abstain: true, reason: "no_evidence" };
  if (options.rerankerEnabled) {
    const accepted = hits.filter((hit) => (hit.rerankScore ?? Number.NEGATIVE_INFINITY) >= options.minScore);
    if (accepted.length === 0) return { accepted: [], abstain: true, reason: "below_rerank_threshold" };
    return { accepted, abstain: false, reason: null };
  }
  const accepted = hits.filter(
    (hit) => hit.sparseRank !== undefined || (hit.denseScore ?? 0) >= options.minScore,
  );
  if (accepted.length === 0) return { accepted: [], abstain: true, reason: "weak_evidence" };
  return { accepted, abstain: false, reason: null };
}
