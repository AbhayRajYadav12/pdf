import { Router } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { loginSchema, profileSchema, registerSchema } from "@pdf-summary/shared";
import { forwardAuthResponse, requestHeaders } from "./auth.js";
import type { AppContext } from "./context.js";
import { asyncHandler } from "./http.js";
import { requireUser, type AuthedRequest } from "./session.js";

export function authRouter(ctx: AppContext): Router {
  const router = Router();

  router.post("/register", asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const response = await ctx.auth.api.signUpEmail({
      body: { email: input.email, password: input.password, name: input.name },
      headers: requestHeaders(req.headers),
      asResponse: true,
    });
    const body = await forwardAuthResponse(response, res);
    const session = await ctx.auth.api.getSession({ headers: requestHeaders(mergeCookies(req.headers, response)) });
    if (!session?.user) {
      res.status(response.status).json(body);
      return;
    }
    const workspace = await ctx.db.createWorkspace({ name: "Personal", ownerId: session.user.id });
    await ctx.db.addAudit({ actorId: session.user.id, action: "auth.register", workspaceId: workspace._id, targetId: session.user.id });
    res.status(201).json({
      user: publicUser(session.user),
      workspace: { id: workspace._id, name: workspace.name, role: "admin" },
    });
  }));

  router.post("/login", asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const response = await ctx.auth.api.signInEmail({
      body: { email: input.email, password: input.password },
      headers: requestHeaders(req.headers),
      asResponse: true,
    });
    const body = await forwardAuthResponse(response, res);
    if (!response.ok) {
      res.status(response.status).json(body);
      return;
    }
    const session = await ctx.auth.api.getSession({ headers: requestHeaders(mergeCookies(req.headers, response)) });
    if (session?.user) {
      await ctx.db.addAudit({ actorId: session.user.id, action: "auth.login", workspaceId: null, targetId: session.user.id });
    }
    res.json({ user: session?.user ? publicUser(session.user) : null });
  }));

  router.post("/logout", asyncHandler(async (req, res) => {
    const session = await ctx.auth.api.getSession({ headers: requestHeaders(req.headers) });
    const response = await ctx.auth.api.signOut({
      headers: requestHeaders(req.headers),
      asResponse: true,
    });
    await forwardAuthResponse(response, res);
    if (session?.user) {
      await ctx.db.addAudit({ actorId: session.user.id, action: "auth.logout", workspaceId: null, targetId: session.user.id });
    }
    res.status(204).end();
  }));

  router.get("/me", requireUser(ctx), asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const workspaces = await ctx.db.listWorkspaces(authed.userId);
    res.json({
      user: { id: authed.userId, email: authed.userEmail, name: authed.userName },
      workspaces: workspaces.map((workspace) => ({
        id: workspace._id,
        name: workspace.name,
        role: workspace.role,
        retentionDays: workspace.retentionDays,
      })),
    });
  }));

  router.patch("/me", requireUser(ctx), asyncHandler(async (req, res) => {
    const authed = req as AuthedRequest;
    const input = profileSchema.parse(req.body);
    await ctx.auth.api.updateUser({
      body: { name: input.name },
      headers: requestHeaders(req.headers),
    });
    res.json({ user: { id: authed.userId, email: authed.userEmail, name: input.name } });
  }));

  return router;
}

function publicUser(user: { id: string; email: string; name: string }) {
  return { id: user.id, email: user.email, name: user.name };
}

function mergeCookies(headers: IncomingHttpHeaders, response: globalThis.Response): IncomingHttpHeaders {
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const baked = setCookies.map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ");
  const existing = headers.cookie ? `${headers.cookie}; ${baked}` : baked;
  return { ...headers, cookie: existing };
}
