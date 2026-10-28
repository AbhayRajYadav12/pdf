import { GoogleGenAI } from "@google/genai";
import { AppError, isRetryable } from "@pdf-summary/shared";
import type { AppEnv } from "@pdf-summary/shared/env";
import { fnv1a, tokenize } from "@pdf-summary/retrieval";

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embedDocuments(inputs: Array<{ title: string; text: string }>): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export function normalizeForEmbedding(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function documentEmbeddingInput(title: string, text: string): string {
  const safeTitle = title.replace(/[|\n]/g, " ").trim() || "none";
  return `title: ${safeTitle} | text: ${normalizeForEmbedding(text)}`;
}

export function queryEmbeddingInput(query: string): string {
  return `task: search result | query: ${normalizeForEmbedding(query)}`;
}

export function createEmbeddingProvider(env: AppEnv): EmbeddingProvider {
  if (env.EMBEDDING_PROVIDER === "deterministic") {
    if (env.NODE_ENV === "production") {
      throw new AppError("CONFIGURATION", "Deterministic embeddings are not available in production", 500);
    }
    return new DeterministicEmbeddings(env.EMBEDDING_DIMENSIONS);
  }
  return new GeminiEmbeddings(env);
}

class GeminiEmbeddings implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  private readonly client: GoogleGenAI | null;

  constructor(private readonly env: AppEnv) {
    this.id = env.GEMINI_EMBEDDING_MODEL;
    this.dimensions = env.EMBEDDING_DIMENSIONS;
    this.client = env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) : null;
  }

  async embedDocuments(inputs: Array<{ title: string; text: string }>): Promise<number[][]> {
    return mapPool(inputs, 4, (input) => this.embed(documentEmbeddingInput(input.title, input.text)));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(queryEmbeddingInput(text));
  }

  private async embed(text: string): Promise<number[]> {
    if (!this.client) {
      throw new AppError(
        "CONFIGURATION",
        "GEMINI_API_KEY is not set. Add it to the server environment before indexing or asking questions.",
        503,
      );
    }
    return withRetry(async () => {
      try {
        const response = await this.client!.models.embedContent({
          model: this.env.GEMINI_EMBEDDING_MODEL,
          contents: text,
          config: { outputDimensionality: this.dimensions },
        });
        const values = response.embeddings?.[0]?.values;
        if (!values || values.length !== this.dimensions) {
          throw new AppError(
            "EMBEDDING",
            `Embedding model ${this.env.GEMINI_EMBEDDING_MODEL} returned ${values?.length ?? 0} dimensions, expected ${this.dimensions}`,
            502,
          );
        }
        return values;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw providerError(error, "Embedding");
      }
    });
  }
}

class DeterministicEmbeddings implements EmbeddingProvider {
  readonly id = "deterministic-feature-hash";
  constructor(readonly dimensions: number) {}

  async embedDocuments(inputs: Array<{ title: string; text: string }>): Promise<number[][]> {
    return inputs.map((input) => hashEmbed(documentEmbeddingInput(input.title, input.text), this.dimensions));
  }

  async embedQuery(text: string): Promise<number[]> {
    return hashEmbed(queryEmbeddingInput(text), this.dimensions);
  }
}

export function hashEmbed(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const token of tokenize(text)) {
    const hash = fnv1a(token);
    const index = hash % dimensions;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (!isRetryable(error) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw last;
}

function providerError(error: unknown, action: string): AppError {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 0;
  const message = error instanceof Error ? error.message : "";
  if (/api key|API key|permission|unauthenticated/i.test(message) || status === 401 || status === 403) {
    return new AppError("CONFIGURATION", "GEMINI_API_KEY is missing or was rejected by the Gemini API.", 503);
  }
  const retryable = status === 429 || status >= 500 || isRetryable(error);
  return new AppError("PROVIDER", `${action} request failed`, 502, undefined, retryable);
}
