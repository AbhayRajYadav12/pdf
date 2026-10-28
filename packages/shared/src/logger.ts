import pino from "pino";

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? "info") {
  return pino({
    name,
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "password",
        "token",
        "apiKey",
        "GEMINI_API_KEY",
        "*.password",
        "*.token",
        "*.apiKey",
      ],
      censor: "[redacted]",
    },
  });
}
