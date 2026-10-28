import { QdrantClient } from "@qdrant/js-client-rest";
import { AppError } from "@pdf-summary/shared";
import { buildAccessFilter, matchesScope } from "./filter.js";
import type { AccessScope, ChunkPayload, SearchHit, SparseVector, VectorPoint, VectorStore } from "./types.js";

export class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;

  constructor(
    url: string,
    private readonly collection: string,
  ) {
    this.client = new QdrantClient({ url, checkCompatibility: false });
  }

  async ensureCollection(dimensions: number): Promise<void> {
    const existing = await this.client.collectionExists(this.collection);
    if (!existing.exists) {
      await this.client.createCollection(this.collection, {
        vectors: { text: { size: dimensions, distance: "Cosine" } },
        sparse_vectors: { text_sparse: { modifier: "idf" } },
      });
      await this.client.createPayloadIndex(this.collection, { field_name: "workspaceId", field_schema: "keyword" });
      await this.client.createPayloadIndex(this.collection, { field_name: "documentId", field_schema: "keyword" });
      await this.client.createPayloadIndex(this.collection, { field_name: "documentVersion", field_schema: "integer" });
      return;
    }
    const info = await this.client.getCollection(this.collection);
    const vectors = info.config?.params?.vectors;
    const size = namedSize(vectors, "text");
    if (size !== dimensions) {
      throw new AppError(
        "INDEX_MISMATCH",
        `Qdrant collection ${this.collection} has ${size ?? "unknown"} dimensions and the embedding model is configured for ${dimensions}. Use a new QDRANT_COLLECTION and reindex.`,
        500,
      );
    }
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.client.upsert(this.collection, {
      wait: true,
      points: points.map((point) => ({
        id: point.id,
        vector: {
          text: point.dense,
          text_sparse: point.sparse,
        },
        payload: { ...point.payload },
      })),
    });
  }

  async deleteByDocument(documentId: string): Promise<void> {
    await this.client.delete(this.collection, {
      wait: true,
      filter: { must: [{ key: "documentId", match: { value: documentId } }] },
    });
  }

  async deleteOtherVersions(documentId: string, keepVersion: number): Promise<void> {
    await this.client.delete(this.collection, {
      wait: true,
      filter: {
        must: [{ key: "documentId", match: { value: documentId } }],
        must_not: [{ key: "documentVersion", match: { value: keepVersion } }],
      },
    });
  }

  async count(filter: { documentId: string; documentVersion: number }): Promise<number> {
    const result = await this.client.count(this.collection, {
      exact: true,
      filter: {
        must: [
          { key: "documentId", match: { value: filter.documentId } },
          { key: "documentVersion", match: { value: filter.documentVersion } },
        ],
      },
    });
    return result.count;
  }

  async searchDense(vector: number[], scope: AccessScope, limit: number): Promise<SearchHit[]> {
    if (scope.documents.length === 0) return [];
    const result = await this.client.query(this.collection, {
      query: vector,
      using: "text",
      filter: buildAccessFilter(scope),
      limit,
      with_payload: true,
    });
    return readHits(result, scope);
  }

  async searchSparse(vector: SparseVector, scope: AccessScope, limit: number): Promise<SearchHit[]> {
    if (scope.documents.length === 0) return [];
    const result = await this.client.query(this.collection, {
      query: vector,
      using: "text_sparse",
      filter: buildAccessFilter(scope),
      limit,
      with_payload: true,
    });
    return readHits(result, scope);
  }

  async health(): Promise<boolean> {
    await this.client.getCollections();
    return true;
  }
}

function namedSize(vectors: unknown, name: string): number | null {
  if (!vectors || typeof vectors !== "object") return null;
  const named = (vectors as Record<string, { size?: number }>)[name];
  if (named && typeof named.size === "number") return named.size;
  if ("size" in vectors && typeof (vectors as { size?: number }).size === "number") {
    return (vectors as { size: number }).size;
  }
  return null;
}

function readHits(result: { points?: Array<{ id: string | number; score?: number; payload?: Record<string, unknown> | null }> }, scope: AccessScope): SearchHit[] {
  const points = result.points ?? [];
  const hits: SearchHit[] = [];
  for (const point of points) {
    const payload = asPayload(point.payload);
    if (!payload || !matchesScope(payload, scope)) continue;
    hits.push({ chunkId: payload.chunkId, score: point.score ?? 0, payload });
  }
  return hits;
}

function asPayload(value: Record<string, unknown> | null | undefined): ChunkPayload | null {
  if (!value) return null;
  if (typeof value.workspaceId !== "string" || typeof value.documentId !== "string" || typeof value.chunkId !== "string") {
    return null;
  }
  if (typeof value.text !== "string" || typeof value.documentName !== "string") return null;
  return {
    tenantId: String(value.tenantId ?? value.workspaceId),
    workspaceId: value.workspaceId,
    documentId: value.documentId,
    documentVersion: Number(value.documentVersion),
    chunkId: value.chunkId,
    pageStart: Number(value.pageStart),
    pageEnd: Number(value.pageEnd),
    sectionTitle: typeof value.sectionTitle === "string" ? value.sectionTitle : null,
    documentName: value.documentName,
    contentHash: String(value.contentHash ?? ""),
    text: value.text,
    embeddingModelVersion: String(value.embeddingModelVersion ?? ""),
  };
}
