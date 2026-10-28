import { getEncoding } from "js-tiktoken";

const encoding = getEncoding("cl100k_base");

export function countTokens(text: string): number {
  return encoding.encode(text).length;
}

export function tailTokens(text: string, count: number): string {
  if (count <= 0) return "";
  const tokens = encoding.encode(text);
  if (tokens.length <= count) return text;
  return encoding.decode(tokens.slice(-count));
}
