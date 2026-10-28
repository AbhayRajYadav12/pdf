import { GROUNDED_SYSTEM_PROMPT } from "@pdf-summary/shared";
import { assignEvidence, selectWithinBudget, validateCitations, verifiedExcerpt, type EvidencePassage, type VerifiedCitation } from "./citations.js";
import type { GenerationProvider } from "./provider.js";

export interface SummaryChunk {
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
}

const STYLE_INSTRUCTIONS: Record<string, string> = {
  executive: "Write an executive summary of the document.",
  section: "Summarize the document section by section.",
  findings: "List the key findings supported by the passages.",
  dates: "List important dates and figures that appear in the passages. Omit any date or figure that is not present.",
  actions: "List action items that the passages explicitly support. If none are present, say so.",
  questions: "List questions that the document answers, and give the supported answer for each.",
};

const LENGTH_WORDS: Record<string, number> = { short: 150, medium: 400, long: 800 };

export interface SummaryDraft {
  content: string;
  model: string;
  claims: Array<VerifiedCitation & { text: string }>;
}

export async function summarizeChunks(input: {
  chunks: SummaryChunk[];
  style: string;
  length: string;
  generation: GenerationProvider;
  countTokens: (text: string) => number;
  contextBudget: number;
  maxOutputTokens: number;
  signal: AbortSignal;
}): Promise<SummaryDraft> {
  if (input.chunks.length === 0) {
    throw new Error("Cannot summarize a document with no chunks");
  }
  const evidence = assignEvidence(
    input.chunks.map((chunk) => ({
      chunkId: chunk._id,
      payload: {
        tenantId: chunk.workspaceId,
        workspaceId: chunk.workspaceId,
        documentId: chunk.documentId,
        documentVersion: chunk.version,
        chunkId: chunk._id,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        sectionTitle: chunk.sectionTitle,
        documentName: chunk.documentName,
        contentHash: chunk.contentHash,
        text: chunk.text,
        embeddingModelVersion: "",
      },
      rrfScore: 0,
    })),
  );
  const groups = groupEvidence(evidence, input.contextBudget, input.countTokens);
  const partials: string[] = [];
  for (const group of groups) {
    partials.push(await collect(input.generation, sectionPrompt(group, input.style), input.maxOutputTokens, input.signal));
  }
  const finalEvidence = evidence;
  const finalRaw = groups.length === 1
    ? partials[0] ?? ""
    : await collect(
        input.generation,
        finalPrompt(partials, finalEvidence, input.style, input.length),
        input.maxOutputTokens,
        input.signal,
      );
  const validated = validateCitations(finalRaw, finalEvidence);
  const claims = validated.citations.map((citation) => ({
    ...citation,
    text: citation.excerpt,
    excerpt: verifiedExcerpt(finalEvidence.find((passage) => passage.id === citation.evidenceId)?.text ?? citation.excerpt),
  }));
  const content = validated.modelAbstained
    ? "The document passages did not support a summary under the requested style."
    : finalRaw.replaceAll("INSUFFICIENT_EVIDENCE", "").trim();
  return { content, model: input.generation.model, claims: validated.modelAbstained ? [] : claims };
}

function groupEvidence(evidence: EvidencePassage[], budget: number, countTokens: (text: string) => number): EvidencePassage[][] {
  const groups: EvidencePassage[][] = [];
  let current: EvidencePassage[] = [];
  let used = 0;
  for (const passage of evidence) {
    const tokens = countTokens(passage.text);
    if (current.length > 0 && used + tokens > budget) {
      groups.push(current);
      current = [];
      used = 0;
    }
    current.push(passage);
    used += tokens;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function sectionPrompt(group: EvidencePassage[], style: string): { system: string; user: string } {
  return {
    system: `${GROUNDED_SYSTEM_PROMPT}\n\n${STYLE_INSTRUCTIONS[style] ?? STYLE_INSTRUCTIONS.executive} Summarize only this group of passages.`,
    user: group.map((passage) => `[${passage.id}]\n<<<\n${passage.text}\n>>>`).join("\n\n"),
  };
}

function finalPrompt(partials: string[], evidence: EvidencePassage[], style: string, length: string): { system: string; user: string } {
  const budgeted = selectWithinBudget(evidence, 6000, (text) => Math.ceil(text.length / 4));
  return {
    system: `${GROUNDED_SYSTEM_PROMPT}\n\n${STYLE_INSTRUCTIONS[style] ?? STYLE_INSTRUCTIONS.executive} Aim for about ${LENGTH_WORDS[length] ?? 400} words. Cite the original evidence ids.`,
    user: [
      "Section notes, which are not evidence:",
      partials.map((partial, index) => `Note ${index + 1}:\n${partial}`).join("\n\n"),
      "Original passages:",
      budgeted.map((passage) => `[${passage.id}]\n<<<\n${passage.text}\n>>>`).join("\n\n"),
    ].join("\n\n"),
  };
}

async function collect(
  generation: GenerationProvider,
  prompt: { system: string; user: string },
  maxOutputTokens: number,
  signal: AbortSignal,
): Promise<string> {
  let text = "";
  const stream = generation.stream({ ...prompt, maxOutputTokens }, signal);
  while (true) {
    const next = await stream.next();
    if (next.done) break;
    text += next.value;
  }
  return text.trim();
}
