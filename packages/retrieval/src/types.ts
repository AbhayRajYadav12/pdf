export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface ChunkPayload {
  tenantId: string;
  workspaceId: string;
  documentId: string;
  documentVersion: number;
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  documentName: string;
  contentHash: string;
  text: string;
  embeddingModelVersion: string;
}

export interface VectorPoint {
  id: string;
  dense: number[];
  sparse: SparseVector;
  payload: ChunkPayload;
}

export interface SearchHit {
  chunkId: string;
  score: number;
  payload: ChunkPayload;
}

export interface DocumentScope {
  documentId: string;
  version: number;
}

export interface AccessScope {
  workspaceId: string;
  documents: DocumentScope[];
}

export interface FusedHit {
  chunkId: string;
  payload: ChunkPayload;
  rrfScore: number;
  denseRank?: number;
  sparseRank?: number;
  denseScore?: number;
  sparseScore?: number;
  rerankScore?: number;
  rerankModel?: string;
}

export interface VectorStore {
  ensureCollection(dimensions: number): Promise<void>;
  upsert(points: VectorPoint[]): Promise<void>;
  deleteByDocument(documentId: string): Promise<void>;
  deleteOtherVersions(documentId: string, keepVersion: number): Promise<void>;
  count(filter: { documentId: string; documentVersion: number }): Promise<number>;
  searchDense(vector: number[], scope: AccessScope, limit: number): Promise<SearchHit[]>;
  searchSparse(vector: SparseVector, scope: AccessScope, limit: number): Promise<SearchHit[]>;
  health(): Promise<boolean>;
}
