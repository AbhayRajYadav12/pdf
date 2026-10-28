import { AppError } from "@pdf-summary/shared";
import { lexicalOverlapScore } from "./memory.js";
import type { FusedHit } from "./types.js";

export interface RerankResult {
  hits: FusedHit[];
  model: string;
}

export interface Reranker {
  readonly id: string;
  rerank(query: string, hits: FusedHit[], limit: number): Promise<RerankResult>;
}

export function createNoopReranker(): Reranker {
  return {
    id: "none",
    async rerank(_query, hits, limit) {
      return { hits: hits.slice(0, limit), model: "none" };
    },
  };
}

export function createLexicalReranker(): Reranker {
  return {
    id: "lexical-overlap",
    async rerank(query, hits, limit) {
      const ranked = hits
        .map((hit) => ({ ...hit, rerankScore: lexicalOverlapScore(query, hit.payload.text), rerankModel: "lexical-overlap" }))
        .sort((left, right) => (right.rerankScore ?? 0) - (left.rerankScore ?? 0));
      return { hits: ranked.slice(0, limit), model: "lexical-overlap" };
    },
  };
}

export function createBgeReranker(url: string, model: string): Reranker {
  return {
    id: "bge",
    async rerank(query, hits, limit) {
      if (hits.length === 0) return { hits: [], model };
      let response: Response;
      try {
        response = await fetch(new URL("/rerank", url), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query,
            model,
            passages: hits.map((hit) => ({ id: hit.chunkId, text: hit.payload.text.slice(0, 4000) })),
          }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "request failed";
        throw new AppError("RERANKER", `The reranker service is unavailable: ${message}`, 503, undefined, true);
      }
      if (!response.ok) {
        throw new AppError("RERANKER", `The reranker service returned ${response.status}`, 502, undefined, response.status >= 500);
      }
      const body = (await response.json()) as { results?: Array<{ id?: string; score?: number; rank?: number; model?: string }> };
      const scores = new Map((body.results ?? []).map((result) => [result.id, result]));
      const ranked = hits
        .map((hit) => {
          const score = scores.get(hit.chunkId);
          return { ...hit, rerankScore: score?.score, rerankModel: score?.model ?? model };
        })
        .filter((hit) => hit.rerankScore !== undefined)
        .sort((left, right) => (right.rerankScore ?? 0) - (left.rerankScore ?? 0));
      if (ranked.length === 0) {
        throw new AppError("RERANKER", "The reranker returned no scores for the candidate passages", 502);
      }
      return { hits: ranked.slice(0, limit), model: ranked[0]?.rerankModel ?? model };
    },
  };
}
