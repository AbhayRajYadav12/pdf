import type { Db } from "mongodb";

export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection("workspaces").createIndex({ ownerId: 1 });
  await db.collection("memberships").createIndex({ workspaceId: 1, userId: 1 }, { unique: true });
  await db.collection("memberships").createIndex({ userId: 1 });
  await db.collection("documents").createIndex({ workspaceId: 1, createdAt: -1 });
  await db.collection("documents").createIndex({ workspaceId: 1, status: 1 });
  await db.collection("documents").createIndex({ status: 1, updatedAt: 1 });
  await db.collection("chunks").createIndex({ documentId: 1, version: 1 });
  await db.collection("chunks").createIndex({ workspaceId: 1, documentId: 1 });
  await db.collection("conversations").createIndex({ workspaceId: 1, ownerId: 1, updatedAt: -1 });
  await db.collection("messages").createIndex({ conversationId: 1, createdAt: 1 });
  await db.collection("messages").createIndex({ status: 1, updatedAt: 1 });
  await db.collection("citations").createIndex({ messageId: 1 });
  await db.collection("processingJobs").createIndex({ documentId: 1, version: 1 });
  await db.collection("processingJobs").createIndex({ status: 1, updatedAt: -1 });
  await db.collection("summaries").createIndex({ documentId: 1, version: 1, style: 1, length: 1 });
  await db.collection("auditEvents").createIndex({ workspaceId: 1, createdAt: -1 });
  await db.collection("usageEvents").createIndex({ workspaceId: 1, kind: 1, createdAt: -1 });
}
