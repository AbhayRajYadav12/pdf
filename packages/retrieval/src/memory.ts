import { sparseDot, sparseVector } from "./text.js";
import { matchesScope } from "./filter.js";
import type { AccessScope, SearchHit, SparseVector, VectorPoint, VectorStore } from "./types.js";

export class MemoryVectorStore implements VectorStore {
  private readonly points = new Map<string, VectorPoint>();
  private dimensions: number | null = null;

  async ensureCollection(dimensions: number): Promise<void> {
    if (this.dimensions !== null && this.dimensions !== dimensions) {
      throw new Error(`Memory collection dimension is ${this.dimensions}, received ${dimensions}`);
    }
    this.dimensions = dimensions;
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    for (const point of points) {
      if (this.dimensions !== null && point.dense.length !== this.dimensions) {
        throw new Error(`Expected ${this.dimensions} dimensions and received ${point.dense.length}`);
      }
      this.points.set(point.id, point);
    }
  }

  async deleteByDocument(documentId: string): Promise<void> {
    for (const [id, point] of this.points) {
      if (point.payload.documentId === documentId) this.points.delete(id);
    }
  }

  async deleteOtherVersions(documentId: string, keepVersion: number): Promise<void> {
    for (const [id, point] of this.points) {
      if (point.payload.documentId === documentId && point.payload.documentVersion !== keepVersion) {
        this.points.delete(id);
      }
    }
  }

  async count(filter: { documentId: string; documentVersion: number }): Promise<number> {
    let count = 0;
    for (const point of this.points.values()) {
      if (point.payload.documentId === filter.documentId && point.payload.documentVersion === filter.documentVersion) {
        count += 1;
      }
    }
    return count;
  }

  async searchDense(vector: number[], scope: AccessScope, limit: number): Promise<SearchHit[]> {
    return this.rank(scope, limit, (point) => cosine(vector, point.dense));
  }

  async searchSparse(vector: SparseVector, scope: AccessScope, limit: number): Promise<SearchHit[]> {
    const candidates = [...this.points.values()].filter((point) => matchesScope(point.payload, scope));
    const documentFrequency = new Map<number, number>();
    for (const point of candidates) {
      for (const index of point.sparse.indices) {
        documentFrequency.set(index, (documentFrequency.get(index) ?? 0) + 1);
      }
    }
    const idf = new Map<number, number>();
    const total = candidates.length || 1;
    for (const [index, frequency] of documentFrequency) {
      idf.set(index, Math.log((total + 1) / (frequency + 0.5)));
    }
    return this.rank(scope, limit, (point) => sparseDot(vector, point.sparse, idf));
  }

  async health(): Promise<boolean> {
    return true;
  }

  private rank(scope: AccessScope, limit: number, scoreOf: (point: VectorPoint) => number): SearchHit[] {
    if (scope.documents.length === 0) return [];
    return [...this.points.values()]
      .filter((point) => matchesScope(point.payload, scope))
      .map((point) => ({ chunkId: point.payload.chunkId, score: scoreOf(point), payload: point.payload }))
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
      .slice(0, limit);
  }
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function lexicalOverlapScore(query: string, text: string): number {
  const queryTokens = new Set(sparseVector(query).indices);
  if (queryTokens.size === 0) return 0;
  const textTokens = new Set(sparseVector(text).indices);
  let overlap = 0;
  for (const token of queryTokens) if (textTokens.has(token)) overlap += 1;
  return overlap / queryTokens.size;
}
