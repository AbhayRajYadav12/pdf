import type { Database, DocumentRecord, WorkspaceRecord } from "@pdf-summary/database";
import type { VectorStore } from "@pdf-summary/retrieval";
import type { ObjectStore } from "./storage.js";

export async function removeDocument(input: {
  db: Database;
  store: ObjectStore;
  vectors: VectorStore;
  document: DocumentRecord;
}): Promise<void> {
  await input.db.updateDocument(input.document._id, { status: "deleting", progress: { stage: "deleting", percent: 50 } });
  await input.vectors.deleteByDocument(input.document._id);
  const remaining = await input.vectors.count({ documentId: input.document._id, documentVersion: input.document.version });
  if (remaining > 0) {
    await input.vectors.deleteByDocument(input.document._id);
  }
  await input.db.deleteChunks(input.document._id);
  await input.db.deleteSummaries(input.document._id);
  await input.store.delete(input.document.storageKey);
  await input.db.detachDocumentFromConversations(input.document._id);
  await input.db.jobs().deleteMany({ documentId: input.document._id });
  await input.db.deleteDocumentRecord(input.document._id);
}

export async function applyRetention(input: {
  db: Database;
  store: ObjectStore;
  vectors: VectorStore;
  workspaces: WorkspaceRecord[];
  now?: Date;
}): Promise<number> {
  const now = input.now ?? new Date();
  let removed = 0;
  for (const workspace of input.workspaces) {
    if (workspace.retentionDays <= 0) continue;
    const cutoff = new Date(now.getTime() - workspace.retentionDays * 24 * 60 * 60 * 1000);
    const expired = await input.db.listExpiredDocuments(workspace._id, cutoff);
    for (const document of expired) {
      await removeDocument({ db: input.db, store: input.store, vectors: input.vectors, document });
      removed += 1;
    }
  }
  return removed;
}
