export class AppError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
    retryable = false,
  ) {
    super(message);
    this.name = "AppError";
    this.retryable = retryable;
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof AppError) return error.retryable;
  if (!(error instanceof Error)) return false;
  return /429|502|503|504|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timeout|rate limit/i.test(error.message);
}

export function publicError(error: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (error instanceof AppError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  return { status: 500, body: { error: { code: "INTERNAL", message: "Something went wrong" } } };
}
