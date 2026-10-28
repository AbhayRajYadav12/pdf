import { GoogleGenAI } from "@google/genai";
import { AppError, isRetryable } from "@pdf-summary/shared";
import type { AppEnv } from "@pdf-summary/shared/env";
import { tokenize } from "@pdf-summary/retrieval";

export interface GenerationRequest {
  system: string;
  user: string;
  maxOutputTokens: number;
}

export interface GenerationProvider {
  readonly id: string;
  readonly model: string;
  stream(input: GenerationRequest, signal: AbortSignal): AsyncGenerator<string, { outputTokens?: number } | void>;
}

export function createGenerationProvider(env: AppEnv): GenerationProvider {
  if (env.GENERATION_PROVIDER === "fixture") {
    if (env.NODE_ENV === "production") {
      throw new AppError("CONFIGURATION", "Fixture generation is not available in production", 500);
    }
    return new FixtureGeneration();
  }
  return new GeminiGeneration(env);
}

class GeminiGeneration implements GenerationProvider {
  readonly id: string;
  readonly model: string;
  private readonly client: GoogleGenAI | null;

  constructor(env: AppEnv) {
    this.model = env.GEMINI_GENERATION_MODEL;
    this.id = env.GEMINI_GENERATION_MODEL;
    this.client = env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) : null;
  }

  async *stream(input: GenerationRequest, signal: AbortSignal): AsyncGenerator<string, { outputTokens?: number } | void> {
    if (!this.client) {
      throw new AppError(
        "CONFIGURATION",
        "GEMINI_API_KEY is not set. Add it to the server environment before asking questions or generating summaries.",
        503,
      );
    }
    let outputTokens: number | undefined;
    try {
      const stream = await this.client.interactions.create({
        model: this.model,
        input: input.user,
        system_instruction: input.system,
        stream: true,
        store: false,
        generation_config: { max_output_tokens: input.maxOutputTokens },
      });
      for await (const event of stream) {
        if (signal.aborted) return { outputTokens };
        if (event.event_type === "step.delta" && event.delta.type === "text") {
          yield event.delta.text;
        }
        if (event.event_type === "interaction.completed") {
          const usage = event.interaction.steps?.find((step) => "usage" in step);
          if (usage && "usage" in usage && usage.usage && typeof usage.usage === "object" && "output_tokens" in usage.usage) {
            const tokens = usage.usage.output_tokens;
            if (typeof tokens === "number") outputTokens = tokens;
          }
        }
      }
    } catch (error) {
      if (signal.aborted) return { outputTokens };
      if (error instanceof AppError) throw error;
      throw providerError(error);
    }
    return { outputTokens };
  }
}

class FixtureGeneration implements GenerationProvider {
  readonly id = "fixture";
  readonly model = "fixture-overlap";

  async *stream(input: GenerationRequest, signal: AbortSignal): AsyncGenerator<string, { outputTokens?: number } | void> {
    const question = input.user.split("User question:").at(-1) ?? input.user;
    const queryTokens = new Set(tokenize(question));
    const blocks = [...input.user.matchAll(/\[(E\d+)\][\s\S]*?<<<\n([\s\S]*?)\n>>>/g)];
    let bestId = "";
    let bestText = "";
    let bestScore = 0;
    for (const block of blocks) {
      const id = block[1] ?? "";
      const text = block[2] ?? "";
      let score = 0;
      for (const token of tokenize(text)) if (queryTokens.has(token)) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
        bestText = text;
      }
    }
    const response = bestScore === 0 || !bestId
      ? "INSUFFICIENT_EVIDENCE"
      : `${bestText.replace(/\s+/g, " ").trim().slice(0, 280)} [${bestId}]`;
    const parts = response.split(/(\s+)/);
    for (const part of parts) {
      if (signal.aborted) return { outputTokens: parts.length };
      if (part) yield part;
    }
    return { outputTokens: parts.length };
  }
}

function providerError(error: unknown): AppError {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 0;
  const message = error instanceof Error ? error.message : "";
  if (/api key|API key|permission|unauthenticated/i.test(message) || status === 401 || status === 403) {
    return new AppError("CONFIGURATION", "GEMINI_API_KEY is missing or was rejected by the Gemini API.", 503);
  }
  return new AppError("PROVIDER", "Answer generation failed", 502, undefined, status === 429 || status >= 500 || isRetryable(error));
}
