import type { FusedHit, SearchHit } from "./types.js";

export const RRF_K = 60;

export function reciprocalRankFusion(dense: SearchHit[], sparse: SearchHit[], k = RRF_K): FusedHit[] {
  const byId = new Map<string, FusedHit>();
  const add = (hits: SearchHit[], field: "dense" | "sparse") => {
    hits.forEach((hit, index) => {
      const rank = index + 1;
      const current = byId.get(hit.chunkId) ?? {
        chunkId: hit.chunkId,
        payload: hit.payload,
        rrfScore: 0,
      };
      current.rrfScore += 1 / (k + rank);
      if (field === "dense") {
        current.denseRank = rank;
        current.denseScore = hit.score;
      } else {
        current.sparseRank = rank;
        current.sparseScore = hit.score;
      }
      byId.set(hit.chunkId, current);
    });
  };
  add(dense, "dense");
  add(sparse, "sparse");
  return [...byId.values()].sort((left, right) => {
    if (right.rrfScore !== left.rrfScore) return right.rrfScore - left.rrfScore;
    return left.chunkId.localeCompare(right.chunkId);
  });
}
