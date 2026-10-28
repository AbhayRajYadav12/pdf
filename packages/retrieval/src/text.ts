import type { SparseVector } from "./types.js";

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "at", "by", "is", "it", "be", "as",
  "with", "that", "this", "from", "are", "was", "were", "be", "been",
]);

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
  const tokens: string[] = [];
  for (const match of matches) {
    if (keepToken(match)) tokens.push(match);
    if (match.includes("-")) {
      for (const part of match.split("-")) {
        if (keepToken(part)) tokens.push(part);
      }
    }
  }
  return tokens;
}

function keepToken(token: string): boolean {
  if (/\d/.test(token)) return token.length > 0;
  return token.length > 1 && !STOP.has(token);
}

export function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = hash >>> 0;
  return unsigned === 0 ? 1 : unsigned;
}

export function sparseVector(text: string): SparseVector {
  const frequencies = new Map<number, number>();
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const [token, count] of counts) {
    const index = fnv1a(token);
    frequencies.set(index, (frequencies.get(index) ?? 0) + count);
  }
  const entries = [...frequencies.entries()].sort((left, right) => left[0] - right[0]);
  return {
    indices: entries.map(([index]) => index),
    values: entries.map(([, value]) => value),
  };
}

export function sparseDot(left: SparseVector, right: SparseVector, idf: Map<number, number>): number {
  const rightValues = new Map<number, number>();
  right.indices.forEach((index, position) => rightValues.set(index, right.values[position] ?? 0));
  let score = 0;
  left.indices.forEach((index, position) => {
    const other = rightValues.get(index);
    if (other === undefined) return;
    score += (left.values[position] ?? 0) * other * (idf.get(index) ?? 1);
  });
  return score;
}
