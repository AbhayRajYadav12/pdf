import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { AppError, publicError } from "@pdf-summary/shared";
import { createLogger } from "@pdf-summary/shared";
import type { AppContext } from "./context.js";

const logger = createLogger("api");

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.header("x-request-id") || randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
}

export function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const ctx = res.app.locals.ctx as AppContext;
  const origin = req.header("origin");
  if (!origin) {
    if (ctx.env.NODE_ENV === "production") {
      next(new AppError("CSRF", "Origin header is required", 403));
      return;
    }
    next();
    return;
  }
  const allowed = new Set([ctx.env.APP_ORIGIN, ctx.env.BETTER_AUTH_URL]);
  if (!allowed.has(origin)) {
    next(new AppError("CSRF", "Origin is not allowed", 403));
    return;
  }
  next();
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = res.locals.requestId as string | undefined;
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: "VALIDATION", message: error.issues[0]?.message ?? "Invalid request" } });
    return;
  }
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: { code: "LIMIT", message: "The file exceeds the upload size limit" } });
    return;
  }
  if (!(error instanceof AppError)) {
    logger.error({ err: error, requestId, path: req.path }, "request failed");
  }
  const payload = publicError(error);
  if (!res.headersSent) res.status(payload.status).json(payload.body);
}

export function workspaceIdOf(req: Request): string | undefined {
  const header = req.header("x-workspace-id");
  const query = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;
  const body = req.body && typeof req.body === "object" && "workspaceId" in req.body ? String(req.body.workspaceId) : undefined;
  return header || query || body;
}
