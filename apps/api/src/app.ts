import cors from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { RedisStore } from "rate-limit-redis";
import { AppError } from "@pdf-summary/shared";
import { authRouter } from "./auth-routes.js";
import { chatRouter } from "./chat.js";
import type { AppContext } from "./context.js";
import { documentRouter } from "./documents.js";
import { errorHandler, originGuard, requestContext } from "./http.js";
import { requireAdmin, requireUser } from "./session.js";
import { workspaceRouter } from "./workspaces.js";

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", ctx.env.TRUST_PROXY ? 1 : false);
  app.locals.ctx = ctx;
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({ origin: [ctx.env.APP_ORIGIN, ctx.env.BETTER_AUTH_URL], credentials: true }));
  app.use(originGuard);
  app.use(express.json({ limit: "1mb" }));

  const store = ctx.env.RATE_LIMIT_STORE === "redis" && ctx.redis
    ? new RedisStore({
        prefix: "rl:",
        sendCommand: (...args: string[]) => ctx.redis!.call(args[0] ?? "PING", ...args.slice(1)) as Promise<string | number>,
      })
    : undefined;
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, store });
  const uploadLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, store });
  const chatLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, store });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/api/ready", async (_req, res) => {
    const checks: Record<string, boolean | "not_configured"> = { mongo: false, redis: "not_configured", qdrant: false };
    try {
      await ctx.db.ping();
      checks.mongo = true;
    } catch {
      checks.mongo = false;
    }
    if (ctx.env.INGESTION_MODE === "queue" || ctx.env.RATE_LIMIT_STORE === "redis") {
      try {
        checks.redis = ctx.redis ? (await ctx.redis.ping()) === "PONG" : false;
      } catch {
        checks.redis = false;
      }
    }
    try {
      checks.qdrant = await ctx.vectors.health();
    } catch {
      checks.qdrant = false;
    }
    const ready = checks.mongo === true && checks.qdrant === true && checks.redis !== false;
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", checks });
  });

  app.use("/api/auth", authLimit, authRouter(ctx));
  app.use("/api/workspaces", workspaceRouter(ctx));
  app.use("/api/documents", uploadLimit, documentRouter(ctx));
  app.use("/api/chat", chatLimit, chatRouter(ctx));

  app.get("/api/ops/summary", requireUser(ctx), async (req, res, next) => {
    try {
      const workspaceId = req.header("x-workspace-id") || (typeof req.query.workspaceId === "string" ? req.query.workspaceId : "");
      await requireAdmin(ctx, req, workspaceId);
      const [documents, storageBytes, usage, failedJobs, activity] = await Promise.all([
        ctx.db.documentCounts(workspaceId),
        ctx.db.storageBytes(workspaceId),
        ctx.db.usageSummary(workspaceId),
        ctx.db.failedJobCount(workspaceId),
        ctx.db.recentAudits(workspaceId, 8),
      ]);
      res.json({ documents, storageBytes, usage, failedJobs, activity });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/metrics", requireUser(ctx), async (req, res, next) => {
    try {
      const token = ctx.env.METRICS_TOKEN;
      const bearer = req.header("authorization");
      if (token && bearer === `Bearer ${token}`) {
        res.type("text/plain").send(await renderMetrics(ctx));
        return;
      }
      const workspaceId = req.header("x-workspace-id") || "";
      if (!workspaceId) throw new AppError("FORBIDDEN", "An administrator workspace is required", 403);
      await requireAdmin(ctx, req, workspaceId);
      res.type("text/plain").send(await renderMetrics(ctx));
    } catch (error) {
      next(error);
    }
  });

  app.use(errorHandler);
  return app;
}

async function renderMetrics(ctx: AppContext): Promise<string> {
  const lines = ["# HELP pdf_summary_up Application process is running", "# TYPE pdf_summary_up gauge", "pdf_summary_up 1"];
  const workspaces = await ctx.db.workspaces().countDocuments();
  lines.push("# HELP pdf_summary_workspaces Total workspaces", "# TYPE pdf_summary_workspaces gauge", `pdf_summary_workspaces ${workspaces}`);
  return `${lines.join("\n")}\n`;
}
