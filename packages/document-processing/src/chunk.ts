import { sha256, stableChunkId } from "./hash.js";
import { countTokens, tailTokens } from "./tokens.js";
import type { ExtractedPage, TextItem } from "./extract.js";

export interface ChunkDraft {
  id: string;
  text: string;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  contentHash: string;
  tokenCount: number;
  index: number;
}

interface Line {
  text: string;
  page: number;
  fontSize: number | null;
}

interface Block {
  text: string;
  page: number;
  kind: "heading" | "paragraph" | "table";
  sectionTitle: string | null;
}

export function chunkDocument(input: {
  pages: ExtractedPage[];
  workspaceId: string;
  documentId: string;
  version: number;
  targetTokens: number;
  overlapTokens: number;
}): ChunkDraft[] {
  const blocks = pagesToBlocks(input.pages);
  return packBlocks(blocks, input);
}

export function pagesToBlocks(pages: ExtractedPage[]): Block[] {
  const blocks: Block[] = [];
  let section: string | null = null;
  for (const page of pages) {
    const lines = page.items.length > 0 ? linesFromItems(page.items, page.pageNumber) : linesFromText(page.text, page.pageNumber);
    const sizes = lines.map((line) => line.fontSize).filter((size): size is number => size !== null).sort((a, b) => a - b);
    const median = sizes.length === 0 ? null : sizes[Math.floor(sizes.length / 2)] ?? null;
    let paragraph: string[] = [];
    let table: string[] = [];
    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      blocks.push({ text: paragraph.join(" "), page: page.pageNumber, kind: "paragraph", sectionTitle: section });
      paragraph = [];
    };
    const flushTable = () => {
      if (table.length === 0) return;
      blocks.push({ text: table.join("\n"), page: page.pageNumber, kind: "table", sectionTitle: section });
      table = [];
    };
    for (const line of lines) {
      const kind = classifyLine(line, median);
      if (kind === "heading") {
        flushParagraph();
        flushTable();
        section = line.text;
        blocks.push({ text: line.text, page: page.pageNumber, kind: "heading", sectionTitle: section });
      } else if (kind === "table") {
        flushParagraph();
        table.push(line.text);
      } else {
        flushTable();
        paragraph.push(line.text);
      }
    }
    flushParagraph();
    flushTable();
  }
  return blocks;
}

function linesFromText(text: string, page: number): Line[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ text: line, page, fontSize: null }));
}

function linesFromItems(items: TextItem[], page: number): Line[] {
  const sorted = [...items].filter((item) => item.str.trim()).sort((left, right) => right.y - left.y || left.x - right.x);
  const lines: Array<Line & { y: number }> = [];
  for (const item of sorted) {
    const last = lines.at(-1);
    if (!last || Math.abs(last.y - item.y) > 2) {
      lines.push({ text: item.str.trim(), page, fontSize: item.fontSize, y: item.y });
    } else {
      last.text = `${last.text} ${item.str.trim()}`.replace(/\s+/g, " ");
      last.fontSize = Math.max(last.fontSize ?? 0, item.fontSize);
    }
  }
  return lines.map((line) => ({ text: line.text, page: line.page, fontSize: line.fontSize }));
}

function classifyLine(line: Line, median: number | null): Block["kind"] {
  const text = line.text.trim();
  const headingBySize = median !== null && line.fontSize !== null && line.fontSize >= median * 1.15 && text.length < 120 && !text.endsWith(".");
  const headingByPattern = text.length < 120 && /^(\d+(\.\d+)*)\s+\S+/.test(text) && !text.endsWith(".");
  if (headingBySize || headingByPattern) return "heading";
  if (/\S\s{2,}\S/.test(text) || text.includes("|") || text.includes("\t")) return "table";
  return "paragraph";
}

function packBlocks(blocks: Block[], input: {
  workspaceId: string;
  documentId: string;
  version: number;
  targetTokens: number;
  overlapTokens: number;
}): ChunkDraft[] {
  const drafts: ChunkDraft[] = [];
  let current: Block[] = [];
  let tokens = 0;
  let pendingOverlap = "";
  let pendingPage = 1;
  let section: string | null = null;

  const emit = (parts: Block[]) => {
    const fresh = parts.filter((part, index) => !(index === 0 && pendingOverlap && part.text === pendingOverlap));
    if (fresh.length === 0) return;
    const body = parts.map((part) => part.text).join("\n\n").trim();
    if (!body) return;
    const pageStart = Math.min(...parts.map((part) => part.page));
    const pageEnd = Math.max(...parts.map((part) => part.page));
    const contentHash = sha256(body);
    const index = drafts.length;
    drafts.push({
      id: stableChunkId(`${input.workspaceId}:${input.documentId}:${input.version}:${index}:${contentHash}`),
      text: body,
      pageStart,
      pageEnd,
      sectionTitle: parts[parts.length - 1]?.sectionTitle ?? section,
      contentHash,
      tokenCount: countTokens(body),
      index,
    });
    pendingOverlap = tailTokens(body, input.overlapTokens);
    pendingPage = pageEnd;
  };

  for (const block of blocks) {
    if (block.kind === "heading") section = block.text;
    const annotated = { ...block, sectionTitle: section };
    const pieces = splitBlock(annotated, input.targetTokens);
    for (const piece of pieces) {
      const pieceTokens = countTokens(piece.text);
      if (current.length > 0 && tokens + pieceTokens > input.targetTokens) {
        emit(current);
        current = [];
        tokens = 0;
      }
      if (current.length === 0 && pendingOverlap) {
        current.push({ text: pendingOverlap, page: pendingPage, kind: "paragraph", sectionTitle: section });
        tokens += countTokens(pendingOverlap);
      }
      current.push(piece);
      tokens += pieceTokens;
    }
  }
  if (current.length > 0) emit(current);
  return drafts;
}

function splitBlock(block: Block, targetTokens: number): Block[] {
  if (countTokens(block.text) <= targetTokens) return [block];
  if (block.kind === "table") {
    const rows = block.text.split("\n");
    const grouped: Block[] = [];
    let current: string[] = [];
    for (const row of rows) {
      const next = [...current, row].join("\n");
      if (current.length > 0 && countTokens(next) > targetTokens) {
        grouped.push({ ...block, text: current.join("\n") });
        current = [row];
      } else {
        current.push(row);
      }
    }
    if (current.length > 0) grouped.push({ ...block, text: current.join("\n") });
    return grouped.flatMap((part) => (countTokens(part.text) > targetTokens ? splitWords(part, targetTokens) : [part]));
  }
  return splitWords(block, targetTokens);
}

function splitWords(block: Block, targetTokens: number): Block[] {
  const words = block.text.split(/\s+/);
  const parts: Block[] = [];
  let current: string[] = [];
  for (const word of words) {
    const next = [...current, word].join(" ");
    if (current.length > 0 && countTokens(next) > targetTokens) {
      parts.push({ ...block, text: current.join(" ") });
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length > 0) parts.push({ ...block, text: current.join(" ") });
  return parts;
}
