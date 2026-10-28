import type { AccessScope } from "./types.js";

export interface QueryFilter {
  must: Array<Record<string, unknown>>;
}

export function buildAccessFilter(scope: AccessScope): QueryFilter {
  if (!scope.workspaceId) {
    throw new Error("workspaceId is required before retrieval");
  }
  return {
    must: [
      { key: "workspaceId", match: { value: scope.workspaceId } },
      {
        should: scope.documents.map((document) => ({
          must: [
            { key: "documentId", match: { value: document.documentId } },
            { key: "documentVersion", match: { value: document.version } },
          ],
        })),
      },
    ],
  };
}

export function matchesScope(payload: { workspaceId: string; documentId: string; documentVersion: number }, scope: AccessScope): boolean {
  if (payload.workspaceId !== scope.workspaceId) return false;
  return scope.documents.some(
    (document) => document.documentId === payload.documentId && document.version === payload.documentVersion,
  );
}
