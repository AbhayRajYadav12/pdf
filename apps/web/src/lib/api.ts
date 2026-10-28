export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "REQUEST",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Workspace {
  id: string;
  name: string;
  role: "admin" | "member";
  retentionDays: number;
}

export interface DocumentItem {
  id: string;
  workspaceId: string;
  filename: string;
  size: number;
  pageCount: number;
  status: "queued" | "processing" | "ready" | "failed" | "deleting";
  progress: { stage: string; percent: number };
  error: string | null;
  version: number;
  readyVersion: number | null;
  chunkCount: number;
  embeddingModelVersion: string | null;
  ocrPageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Citation {
  evidenceId: string;
  documentId: string;
  documentName: string;
  documentVersion: number;
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  excerpt: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string;
  documentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: string;
  model: string | null;
  abstained: boolean;
  conflict: boolean;
  error: string | null;
  createdAt: string;
  citations: Citation[];
}

export interface SummaryRecord {
  _id: string;
  style: string;
  length: string;
  content: string;
  model: string;
  claims: Array<{ text: string; pageStart: number; pageEnd: number; excerpt: string; chunkId: string }>;
  createdAt: string;
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
  if (!response.ok) {
    throw new ApiError(body.error?.message ?? "Request failed", response.status, body.error?.code);
  }
  return body as T;
}

export function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(path, { ...init, headers, credentials: "include" });
}

export const client = {
  async me() {
    return parse<{ user: User; workspaces: Workspace[] }>(await api("/api/auth/me"));
  },
  async register(input: { email: string; password: string; name: string }) {
    return parse<{ user: User; workspace: { id: string; name: string; role: "admin" } }>(
      await api("/api/auth/register", { method: "POST", body: JSON.stringify(input) }),
    );
  },
  async login(input: { email: string; password: string }) {
    return parse<{ user: User | null }>(await api("/api/auth/login", { method: "POST", body: JSON.stringify(input) }));
  },
  async logout() {
    return parse<void>(await api("/api/auth/logout", { method: "POST" }));
  },
  async updateProfile(name: string) {
    return parse<{ user: User }>(await api("/api/auth/me", { method: "PATCH", body: JSON.stringify({ name }) }));
  },
  async workspace(id: string) {
    return parse<{
      workspace: Workspace & { counts: Record<DocumentItem["status"], number> };
      members: Array<{ userId: string; role: "admin" | "member" }>;
    }>(await api(`/api/workspaces/${id}`));
  },
  async createWorkspace(name: string) {
    return parse<{ workspace: Workspace }>(await api("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) }));
  },
  async updateWorkspace(id: string, input: { name?: string; retentionDays?: number }) {
    return parse<{ workspace: { id: string; name: string; retentionDays: number } }>(
      await api(`/api/workspaces/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    );
  },
  async addMember(id: string, input: { email: string; role: "admin" | "member" }) {
    return parse<{ member: { userId: string; role: string; email: string; name: string } }>(
      await api(`/api/workspaces/${id}/members`, { method: "POST", body: JSON.stringify(input) }),
    );
  },
  async removeMember(id: string, userId: string) {
    return parse<void>(await api(`/api/workspaces/${id}/members/${userId}`, { method: "DELETE" }));
  },
  async documents(query: { workspaceId: string; q?: string; status?: string; limit?: number; offset?: number }) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    return parse<{ items: DocumentItem[]; total: number }>(await api(`/api/documents?${params}`));
  },
  async document(id: string) {
    return parse<{ document: DocumentItem }>(await api(`/api/documents/${id}`));
  },
  async upload(workspaceId: string, file: File) {
    const body = new FormData();
    body.set("workspaceId", workspaceId);
    body.set("file", file);
    return parse<{ document: DocumentItem }>(await api("/api/documents", { method: "POST", body }));
  },
  async retryDocument(id: string) {
    return parse<{ status: string }>(await api(`/api/documents/${id}/retry`, { method: "POST" }));
  },
  async reprocessDocument(id: string) {
    return parse<{ status: string }>(await api(`/api/documents/${id}/reprocess`, { method: "POST" }));
  },
  async deleteDocument(id: string) {
    return parse<void>(await api(`/api/documents/${id}`, { method: "DELETE" }));
  },
  async summarize(id: string, style: string, length: string) {
    return parse<{ summary: SummaryRecord }>(
      await api(`/api/documents/${id}/summarize`, { method: "POST", body: JSON.stringify({ style, length }) }),
    );
  },
  async summary(id: string, style: string, length: string) {
    return parse<{ summary: SummaryRecord | null }>(await api(`/api/documents/${id}/summary?style=${style}&length=${length}`));
  },
  async conversations(workspaceId: string) {
    return parse<{ conversations: Conversation[] }>(await api(`/api/chat/conversations?workspaceId=${workspaceId}`));
  },
  async conversation(id: string) {
    return parse<{ conversation: Conversation; messages: ChatMessage[] }>(await api(`/api/chat/conversations/${id}`));
  },
  async renameConversation(id: string, title: string) {
    return parse<{ conversation: Conversation }>(
      await api(`/api/chat/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
    );
  },
  async deleteConversation(id: string) {
    return parse<void>(await api(`/api/chat/conversations/${id}`, { method: "DELETE" }));
  },
  async ask(input: { workspaceId: string; conversationId?: string; documentIds?: string[]; question: string }) {
    return parse<{ conversationId: string; messageId: string; streamPath: string }>(
      await api("/api/chat", { method: "POST", body: JSON.stringify(input) }),
    );
  },
  async cancel(conversationId: string, messageId: string) {
    return parse<{ status: string }>(
      await api(`/api/chat/${conversationId}/cancel`, { method: "POST", body: JSON.stringify({ messageId }) }),
    );
  },
  async retryMessage(conversationId: string, messageId: string) {
    return parse<{ conversationId: string; messageId: string }>(
      await api(`/api/chat/${conversationId}/retry`, { method: "POST", body: JSON.stringify({ messageId }) }),
    );
  },
  async ops(workspaceId: string) {
    return parse<{
      documents: Record<DocumentItem["status"], number>;
      storageBytes: number;
      failedJobs: number;
      usage: {
        embeddingCalls: number;
        generationCalls: number;
        rerankCalls: number;
        embeddingLatencyMsAvg: number | null;
        generationLatencyMsAvg: number | null;
        citationValidationFailures: number;
      };
      activity: Array<{ action: string; createdAt: string; targetId: string | null }>;
    }>(await api(`/api/ops/summary`, { headers: { "x-workspace-id": workspaceId } }));
  },
};
