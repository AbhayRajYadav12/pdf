export type Role = "admin" | "member";
export type DocumentStatus = "queued" | "processing" | "ready" | "failed" | "deleting";
export type MessageStatus = "pending" | "streaming" | "completed" | "failed" | "cancelled" | "abstained";
export type MessageRole = "user" | "assistant";

export interface WorkspaceRecord {
  _id: string;
  name: string;
  ownerId: string;
  retentionDays: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipRecord {
  _id: string;
  workspaceId: string;
  userId: string;
  role: Role;
  createdAt: Date;
}

export interface DocumentProgress {
  stage: string;
  percent: number;
}

export interface DocumentRecord {
  _id: string;
  workspaceId: string;
  ownerId: string;
  filename: string;
  storageKey: string;
  mimeType: string;
  size: number;
  pageCount: number | null;
  status: DocumentStatus;
  progress: DocumentProgress;
  error: string | null;
  version: number;
  readyVersion: number | null;
  contentHash: string;
  chunkCount: number;
  embeddingModelVersion: string | null;
  ocrPageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChunkRecord {
  _id: string;
  workspaceId: string;
  documentId: string;
  documentName: string;
  version: number;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  text: string;
  contentHash: string;
  tokenCount: number;
  createdAt: Date;
}

export interface ConversationRecord {
  _id: string;
  workspaceId: string;
  ownerId: string;
  title: string;
  documentIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageUsage {
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

export interface MessageRecord {
  _id: string;
  conversationId: string;
  workspaceId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  model: string | null;
  usage: MessageUsage | null;
  error: string | null;
  abstained: boolean;
  conflict: boolean;
  validationFailures: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CitationRecord {
  _id: string;
  messageId: string;
  workspaceId: string;
  documentId: string;
  documentName: string;
  documentVersion: number;
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  evidenceId: string;
  excerpt: string;
  createdAt: Date;
}

export interface ProcessingJobRecord {
  _id: string;
  documentId: string;
  workspaceId: string;
  version: number;
  status: "queued" | "processing" | "ready" | "failed";
  attempt: number;
  stage: string;
  error: string | null;
  retryable: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SummaryClaim {
  text: string;
  evidenceId: string;
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  excerpt: string;
}

export interface SummaryRecord {
  _id: string;
  documentId: string;
  workspaceId: string;
  version: number;
  style: string;
  length: string;
  content: string;
  model: string;
  claims: SummaryClaim[];
  createdAt: Date;
}

export interface AuditEventRecord {
  _id: string;
  actorId: string;
  action: string;
  workspaceId: string | null;
  targetId: string | null;
  createdAt: Date;
}

export interface UsageEventRecord {
  _id: string;
  workspaceId: string | null;
  kind: "embedding" | "generation" | "rerank";
  model: string;
  latencyMs: number;
  units: number;
  createdAt: Date;
}

export interface AuthUserRecord {
  _id: string;
  email: string;
  name: string;
}
