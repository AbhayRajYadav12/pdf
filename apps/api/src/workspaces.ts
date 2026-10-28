import { Router } from "express";
import { AppError, memberSchema, workspaceCreateSchema, workspaceSettingsSchema } from "@pdf-summary/shared";
import type { AppContext } from "./context.js";
import { asyncHandler } from "./http.js";
import { requireAdmin, requireMembership, requireUser, type AuthedRequest } from "./session.js";

export function workspaceRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireUser(ctx));

  router.post("/", asyncHandler(async (req, res) => {
    const input = workspaceCreateSchema.parse(req.body);
    const workspace = await ctx.db.createWorkspace({ name: input.name, ownerId: (req as AuthedRequest).userId });
    await ctx.db.addAudit({
      actorId: (req as AuthedRequest).userId,
      action: "workspace.create",
      workspaceId: workspace._id,
      targetId: workspace._id,
    });
    res.status(201).json({ workspace: { id: workspace._id, name: workspace.name, role: "admin", retentionDays: 0 } });
  }));

  router.get("/", asyncHandler(async (req, res) => {
    const workspaces = await ctx.db.listWorkspaces((req as AuthedRequest).userId);
    res.json({
      workspaces: workspaces.map((workspace) => ({
        id: workspace._id,
        name: workspace.name,
        role: workspace.role,
        retentionDays: workspace.retentionDays,
      })),
    });
  }));

  router.get("/:id", asyncHandler(async (req, res) => {
    const id = single(req.params.id);
    const membership = await requireMembership(ctx, req, id);
    const workspace = await ctx.db.workspaces().findOne({ _id: id });
    if (!workspace) throw new AppError("NOT_FOUND", "Workspace not found", 404);
    const members = await ctx.db.listMembers(id);
    const counts = await ctx.db.documentCounts(id);
    res.json({
      workspace: {
        id: workspace._id,
        name: workspace.name,
        role: membership.role,
        retentionDays: workspace.retentionDays,
        counts,
      },
      members: members.map((member) => ({ userId: member.userId, role: member.role })),
    });
  }));

  router.patch("/:id", asyncHandler(async (req, res) => {
    const id = single(req.params.id);
    await requireAdmin(ctx, req, id);
    const input = workspaceSettingsSchema.parse(req.body);
    const workspace = await ctx.db.updateWorkspace(id, input);
    if (!workspace) throw new AppError("NOT_FOUND", "Workspace not found", 404);
    res.json({ workspace: { id: workspace._id, name: workspace.name, retentionDays: workspace.retentionDays } });
  }));

  router.post("/:id/members", asyncHandler(async (req, res) => {
    const id = single(req.params.id);
    await requireAdmin(ctx, req, id);
    const input = memberSchema.parse(req.body);
    const user = await ctx.db.findUserByEmail(input.email);
    if (!user) throw new AppError("NOT_FOUND", "No account exists for that email. Ask them to register first.", 404);
    const member = await ctx.db.addMember({ workspaceId: id, userId: user._id, role: input.role });
    await ctx.db.addAudit({
      actorId: (req as AuthedRequest).userId,
      action: "member.add",
      workspaceId: id,
      targetId: user._id,
    });
    res.status(201).json({ member: { userId: member.userId, role: member.role, email: user.email, name: user.name } });
  }));

  router.delete("/:id/members/:userId", asyncHandler(async (req, res) => {
    const id = single(req.params.id);
    const userId = single(req.params.userId);
    await requireAdmin(ctx, req, id);
    const workspace = await ctx.db.workspaces().findOne({ _id: id });
    if (workspace?.ownerId === userId) throw new AppError("CONFLICT", "The workspace owner cannot be removed", 409);
    await ctx.db.removeMember(id, userId);
    await ctx.db.addAudit({ actorId: (req as AuthedRequest).userId, action: "member.remove", workspaceId: id, targetId: userId });
    res.status(204).end();
  }));

  return router;
}

function single(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id) throw new AppError("VALIDATION", "Missing id", 400);
  return id;
}
