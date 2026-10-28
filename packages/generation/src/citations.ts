import type { FusedHit } from "@pdf-summary/retrieval";

export interface EvidencePassage {
  id: string;
  chunkId: string;
  documentId: string;
  documentName: string;
  documentVersion: number;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  text: string;
}

export interface VerifiedCitation {
  evidenceId: string;
  chunkId: string;
  documentId: string;
  documentName: string;
  documentVersion: number;
  pageStart: number;
  pageEnd: number;
  excerpt: string;
}

export function assignEvidence(hits: FusedHit[]): EvidencePassage[] {
  return hits.map((hit, index) => ({
    id: `E${index + 1}`,
    chunkId: hit.chunkId,
    documentId: hit.payload.documentId,
    documentName: hit.payload.documentName,
    documentVersion: hit.payload.documentVersion,
    pageStart: hit.payload.pageStart,
    pageEnd: hit.payload.pageEnd,
    sectionTitle: hit.payload.sectionTitle,
    text: hit.payload.text,
  }));
}

export function validateCitations(answer: string, evidence: EvidencePassage[]): {
  citations: VerifiedCitation[];
  failures: string[];
  modelAbstained: boolean;
} {
  if (answer.includes("INSUFFICIENT_EVIDENCE")) {
    return { citations: [], failures: [], modelAbstained: true };
  }
  const byId = new Map(evidence.map((passage) => [passage.id, passage]));
  const seen = new Set<string>();
  const citations: VerifiedCitation[] = [];
  const failures: string[] = [];
  for (const match of answer.matchAll(/\[(E\d+)\]/g)) {
    const evidenceId = match[1];
    if (!evidenceId || seen.has(evidenceId)) continue;
    seen.add(evidenceId);
    const passage = byId.get(evidenceId);
    if (!passage) {
      failures.push(`rejected_unknown_evidence:${evidenceId}`);
      continue;
    }
    citations.push({
      evidenceId,
      chunkId: passage.chunkId,
      documentId: passage.documentId,
      documentName: passage.documentName,
      documentVersion: passage.documentVersion,
      pageStart: passage.pageStart,
      pageEnd: passage.pageEnd,
      excerpt: verifiedExcerpt(passage.text),
    });
  }
  if (citations.length === 0) failures.push("model_omitted_valid_citations");
  return { citations, failures, modelAbstained: false };
}

export function verifiedExcerpt(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const excerpt = normalized.slice(0, 400);
  if (!normalized.includes(excerpt)) {
    throw new Error("Excerpt is not contained in the source chunk");
  }
  return excerpt;
}

export function detectVersionConflict(citations: VerifiedCitation[]): boolean {
  const versions = new Map<string, Set<number>>();
  for (const citation of citations) {
    const set = versions.get(citation.documentId) ?? new Set<number>();
    set.add(citation.documentVersion);
    versions.set(citation.documentId, set);
    if (set.size > 1) return true;
  }
  return false;
}

export function selectWithinBudget<T extends { text: string }>(
  items: T[],
  budget: number,
  countTokens: (text: string) => number,
): T[] {
  const selected: T[] = [];
  let used = 0;
  for (const item of items) {
    const tokens = Math.max(1, countTokens(item.text));
    if (selected.length > 0 && used + tokens > budget) break;
    selected.push(item);
    used += tokens;
  }
  return selected;
}
