import type { NextFunction, Request, Response } from "express";
import { AppError } from "@pdf-summary/shared";
import type { MembershipRecord } from "@pdf-summary/database";
import { requestHeaders } from "./auth.js";
import type { AppContext } from "./context.js";

export interface AuthedRequest extends Request {
  userId: string;
  userEmail: string;
  userName: string;
}

export function requireUser(ctx: AppContext) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await ctx.auth.api.getSession({ headers: requestHeaders(req.headers) });
      if (!session?.user) {
        next(new AppError("UNAUTHORIZED", "Sign in required", 401));
        return;
      }
      const authed = req as AuthedRequest;
      authed.userId = session.user.id;
      authed.userEmail = session.user.email;
      authed.userName = session.user.name;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function requireMembership(ctx: AppContext, req: Request, workspaceId: string): Promise<MembershipRecord> {
  if (!workspaceId) throw new AppError("VALIDATION", "workspaceId is required", 400);
  const membership = await ctx.db.getMembership(workspaceId, (req as AuthedRequest).userId);
  if (!membership) throw new AppError("FORBIDDEN", "You do not have access to this workspace", 403);
  return membership;
}

export async function requireAdmin(ctx: AppContext, req: Request, workspaceId: string): Promise<MembershipRecord> {
  const membership = await requireMembership(ctx, req, workspaceId);
  if (membership.role !== "admin") throw new AppError("FORBIDDEN", "Administrator role required", 403);
  return membership;
}
