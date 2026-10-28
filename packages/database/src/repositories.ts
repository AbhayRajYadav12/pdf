import { randomUUID } from "node:crypto";
import { MongoClient, type Db, type Filter } from "mongodb";
import { ensureIndexes } from "./indexes.js";
import type {
  AuditEventRecord,
  AuthUserRecord,
  ChunkRecord,
  CitationRecord,
  ConversationRecord,
  DocumentRecord,
  DocumentStatus,
  MembershipRecord,
  MessageRecord,
  MessageStatus,
  ProcessingJobRecord,
  Role,
  SummaryRecord,
  UsageEventRecord,
  WorkspaceRecord,
} from "./types.js";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class Database {
  constructor(readonly client: MongoClient, readonly db: Db) {}

  async ping(): Promise<void> {
    await this.db.command({ ping: 1 });
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  workspaces() {
    return this.db.collection<WorkspaceRecord>("workspaces");
  }

  memberships() {
    return this.db.collection<MembershipRecord>("memberships");
  }

  documents() {
    return this.db.collection<DocumentRecord>("documents");
  }

  chunks() {
    return this.db.collection<ChunkRecord>("chunks");
  }

  conversations() {
    return this.db.collection<ConversationRecord>("conversations");
  }

  messages() {
    return this.db.collection<MessageRecord>("messages");
  }

  citations() {
    return this.db.collection<CitationRecord>("citations");
  }

  jobs() {
    return this.db.collection<ProcessingJobRecord>("processingJobs");
  }

  summaries() {
    return this.db.collection<SummaryRecord>("summaries");
  }

  audits() {
    return this.db.collection<AuditEventRecord>("auditEvents");
  }

  usage() {
    return this.db.collection<UsageEventRecord>("usageEvents");
  }

  async createWorkspace(input: { name: string; ownerId: string }): Promise<WorkspaceRecord> {
    const now = new Date();
    const workspace: WorkspaceRecord = {
      _id: randomUUID(),
      name: input.name,
      ownerId: input.ownerId,
      retentionDays: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.workspaces().insertOne(workspace);
    await this.memberships().insertOne({
      _id: randomUUID(),
      workspaceId: workspace._id,
      userId: input.ownerId,
      role: "admin",
      createdAt: now,
    });
    return workspace;
  }

  async listWorkspaces(userId: string): Promise<Array<WorkspaceRecord & { role: Role }>> {
    const memberships = await this.memberships().find({ userId }).toArray();
    if (memberships.length === 0) return [];
    const ids = memberships.map((membership) => membership.workspaceId);
    const workspaces = await this.workspaces().find({ _id: { $in: ids } }).toArray();
    return workspaces.map((workspace) => ({
      ...workspace,
      role: memberships.find((membership) => membership.workspaceId === workspace._id)?.role ?? "member",
    }));
  }

  async getMembership(workspaceId: string, userId: string): Promise<MembershipRecord | null> {
    return this.memberships().findOne({ workspaceId, userId });
  }

  async listMembers(workspaceId: string): Promise<MembershipRecord[]> {
    return this.memberships().find({ workspaceId }).toArray();
  }

  async addMember(input: { workspaceId: string; userId: string; role: Role }): Promise<MembershipRecord> {
    const existing = await this.getMembership(input.workspaceId, input.userId);
    if (existing) {
      await this.memberships().updateOne({ _id: existing._id }, { $set: { role: input.role } });
      return { ...existing, role: input.role };
    }
    const record: MembershipRecord = {
      _id: randomUUID(),
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
      createdAt: new Date(),
    };
    await this.memberships().insertOne(record);
    return record;
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await this.memberships().deleteOne({ workspaceId, userId });
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const normalized = email.trim().toLowerCase();
    const user = await this.db.collection<{ _id?: unknown; email?: string; name?: string }>("user").findOne({
      email: normalized,
    });
    const fallback = user ?? await this.db.collection<{ _id?: unknown; email?: string; name?: string }>("user").findOne({
      email: email.trim(),
    });
    const found = user ?? fallback;
    if (!found?.email || found._id === undefined || found._id === null) return null;
    return { _id: String(found._id), email: found.email, name: found.name ?? found.email };
  }

  async updateWorkspace(id: string, patch: { name?: string; retentionDays?: number }): Promise<WorkspaceRecord | null> {
    const $set: Partial<WorkspaceRecord> = { updatedAt: new Date() };
    if (patch.name !== undefined) $set.name = patch.name;
    if (patch.retentionDays !== undefined) $set.retentionDays = patch.retentionDays;
    await this.workspaces().updateOne({ _id: id }, { $set });
    return this.workspaces().findOne({ _id: id });
  }

  async insertDocument(record: DocumentRecord): Promise<void> {
    await this.documents().insertOne(record);
  }

  async getDocument(id: string): Promise<DocumentRecord | null> {
    return this.documents().findOne({ _id: id });
  }

  async listDocuments(input: {
    workspaceId: string;
    q?: string;
    status?: DocumentStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: DocumentRecord[]; total: number }> {
    const filter: Filter<DocumentRecord> = { workspaceId: input.workspaceId };
    if (input.status) filter.status = input.status;
    if (input.q) filter.filename = { $regex: escapeRegex(input.q), $options: "i" };
    const total = await this.documents().countDocuments(filter);
    const items = await this.documents()
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(input.offset)
      .limit(input.limit)
      .toArray();
    return { items, total };
  }

  async documentCounts(workspaceId: string): Promise<Record<DocumentStatus, number>> {
    const rows = await this.documents()
      .aggregate<{ _id: DocumentStatus; count: number }>([
        { $match: { workspaceId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
      .toArray();
    const counts: Record<DocumentStatus, number> = {
      queued: 0,
      processing: 0,
      ready: 0,
      failed: 0,
      deleting: 0,
    };
    for (const row of rows) counts[row._id] = row.count;
    return counts;
  }

  async storageBytes(workspaceId: string): Promise<number> {
    const rows = await this.documents()
      .aggregate<{ total: number }>([
        { $match: { workspaceId } },
        { $group: { _id: null, total: { $sum: "$size" } } },
      ])
      .toArray();
    return rows[0]?.total ?? 0;
  }

  async updateDocument(id: string, patch: Partial<DocumentRecord>): Promise<void> {
    await this.documents().updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date() } });
  }

  async deleteDocumentRecord(id: string): Promise<void> {
    await this.documents().deleteOne({ _id: id });
  }

  async replaceChunks(documentId: string, version: number, chunks: ChunkRecord[]): Promise<void> {
    await this.chunks().deleteMany({ documentId, version });
    if (chunks.length > 0) await this.chunks().insertMany(chunks);
  }

  async deleteChunks(documentId: string, version?: number): Promise<void> {
    await this.chunks().deleteMany(version === undefined ? { documentId } : { documentId, version });
  }

  async getChunks(documentId: string, version: number): Promise<ChunkRecord[]> {
    return this.chunks().find({ documentId, version }).toArray();
  }

  async getChunk(id: string): Promise<ChunkRecord | null> {
    return this.chunks().findOne({ _id: id });
  }

  async upsertJob(record: ProcessingJobRecord): Promise<void> {
    await this.jobs().updateOne({ _id: record._id }, { $set: record }, { upsert: true });
  }

  async updateJob(id: string, patch: Partial<ProcessingJobRecord>): Promise<void> {
    await this.jobs().updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date() } });
  }

  async getJob(documentId: string, version: number): Promise<ProcessingJobRecord | null> {
    return this.jobs().findOne({ documentId, version });
  }

  async failedJobCount(workspaceId: string): Promise<number> {
    return this.jobs().countDocuments({ workspaceId, status: "failed" });
  }

  async createConversation(input: {
    workspaceId: string;
    ownerId: string;
    title: string;
    documentIds: string[];
  }): Promise<ConversationRecord> {
    const now = new Date();
    const record: ConversationRecord = {
      _id: randomUUID(),
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      title: input.title,
      documentIds: input.documentIds,
      createdAt: now,
      updatedAt: now,
    };
    await this.conversations().insertOne(record);
    return record;
  }

  async listConversations(workspaceId: string, ownerId: string, limit = 20): Promise<ConversationRecord[]> {
    return this.conversations().find({ workspaceId, ownerId }).sort({ updatedAt: -1 }).limit(limit).toArray();
  }

  async getConversation(id: string): Promise<ConversationRecord | null> {
    return this.conversations().findOne({ _id: id });
  }

  async updateConversation(id: string, patch: Partial<ConversationRecord>): Promise<void> {
    await this.conversations().updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date() } });
  }

  async deleteConversation(id: string): Promise<void> {
    const messages = await this.messages().find({ conversationId: id }).project<{ _id: string }>({ _id: 1 }).toArray();
    const ids = messages.map((message) => message._id);
    if (ids.length > 0) await this.citations().deleteMany({ messageId: { $in: ids } });
    await this.messages().deleteMany({ conversationId: id });
    await this.conversations().deleteOne({ _id: id });
  }

  async detachDocumentFromConversations(documentId: string): Promise<void> {
    await this.conversations().updateMany({ documentIds: documentId }, { $pull: { documentIds: documentId } });
  }

  async insertMessage(record: MessageRecord): Promise<void> {
    await this.messages().insertOne(record);
  }

  async getMessage(id: string): Promise<MessageRecord | null> {
    return this.messages().findOne({ _id: id });
  }

  async listMessages(conversationId: string): Promise<MessageRecord[]> {
    return this.messages().find({ conversationId }).sort({ createdAt: 1 }).toArray();
  }

  async claimMessage(id: string, from: MessageStatus, to: MessageStatus): Promise<MessageRecord | null> {
    return this.messages().findOneAndUpdate(
      { _id: id, status: from },
      { $set: { status: to, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
  }

  async updateMessage(id: string, patch: Partial<MessageRecord>): Promise<void> {
    await this.messages().updateOne({ _id: id }, { $set: { ...patch, updatedAt: new Date() } });
  }

  async latestAssistantMessage(conversationId: string): Promise<MessageRecord | null> {
    return this.messages().find({ conversationId, role: "assistant" }).sort({ createdAt: -1 }).limit(1).next();
  }

  async replaceCitations(messageId: string, records: CitationRecord[]): Promise<void> {
    await this.citations().deleteMany({ messageId });
    if (records.length > 0) await this.citations().insertMany(records);
  }

  async listCitations(messageId: string): Promise<CitationRecord[]> {
    return this.citations().find({ messageId }).toArray();
  }

  async saveSummary(record: SummaryRecord): Promise<void> {
    await this.summaries().deleteMany({
      documentId: record.documentId,
      version: record.version,
      style: record.style,
      length: record.length,
    });
    await this.summaries().insertOne(record);
  }

  async getSummary(documentId: string, version: number, style: string, length: string): Promise<SummaryRecord | null> {
    return this.summaries().findOne({ documentId, version, style, length });
  }

  async deleteSummaries(documentId: string): Promise<void> {
    await this.summaries().deleteMany({ documentId });
  }

  async addAudit(input: Omit<AuditEventRecord, "_id" | "createdAt">): Promise<void> {
    await this.audits().insertOne({ _id: randomUUID(), createdAt: new Date(), ...input });
  }

  async recentAudits(workspaceId: string, limit = 10): Promise<AuditEventRecord[]> {
    return this.audits().find({ workspaceId }).sort({ createdAt: -1 }).limit(limit).toArray();
  }

  async addUsage(input: Omit<UsageEventRecord, "_id" | "createdAt">): Promise<void> {
    await this.usage().insertOne({ _id: randomUUID(), createdAt: new Date(), ...input });
  }

  async usageSummary(workspaceId: string): Promise<{
    embeddingCalls: number;
    generationCalls: number;
    rerankCalls: number;
    embeddingLatencyMsAvg: number | null;
    generationLatencyMsAvg: number | null;
    citationValidationFailures: number;
  }> {
    const rows = await this.usage()
      .aggregate<{ _id: UsageEventRecord["kind"]; calls: number; latency: number }>([
        { $match: { workspaceId } },
        { $group: { _id: "$kind", calls: { $sum: 1 }, latency: { $avg: "$latencyMs" } } },
      ])
      .toArray();
    const byKind = new Map(rows.map((row) => [row._id, row]));
    const failures = await this.messages().countDocuments({
      workspaceId,
      validationFailures: { $exists: true, $ne: [] },
    });
    return {
      embeddingCalls: byKind.get("embedding")?.calls ?? 0,
      generationCalls: byKind.get("generation")?.calls ?? 0,
      rerankCalls: byKind.get("rerank")?.calls ?? 0,
      embeddingLatencyMsAvg: byKind.get("embedding")?.latency ?? null,
      generationLatencyMsAvg: byKind.get("generation")?.latency ?? null,
      citationValidationFailures: failures,
    };
  }

  async listStuckDocuments(olderThan: Date): Promise<DocumentRecord[]> {
    return this.documents()
      .find({ status: { $in: ["processing", "deleting"] }, updatedAt: { $lt: olderThan } })
      .toArray();
  }

  async listExpiredDocuments(workspaceId: string, olderThan: Date): Promise<DocumentRecord[]> {
    return this.documents().find({ workspaceId, createdAt: { $lt: olderThan } }).toArray();
  }
}

export async function connectDatabase(uri: string): Promise<Database> {
  const client = new MongoClient(uri);
  await client.connect();
  const database = new Database(client, client.db());
  await ensureIndexes(database.db);
  return database;
}
