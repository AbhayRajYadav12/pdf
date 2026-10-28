import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10).max(200),
  name: z.string().trim().min(1).max(80),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const workspaceSettingsSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  retentionDays: z.number().int().min(0).max(3650).optional(),
});

export const memberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]),
});

export const chatSchema = z.object({
  workspaceId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  documentIds: z.array(z.string().min(1)).max(50).optional(),
  question: z.string().trim().min(1).max(4000),
});

export const renameSchema = z.object({
  title: z.string().trim().min(1).max(120),
});

export const summarySchema = z.object({
  style: z.enum(["executive", "section", "findings", "dates", "actions", "questions"]),
  length: z.enum(["short", "medium", "long"]).default("medium"),
});

export const documentListSchema = z.object({
  workspaceId: z.string().min(1),
  q: z.string().max(200).optional(),
  status: z.enum(["queued", "processing", "ready", "failed", "deleting"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChatInput = z.infer<typeof chatSchema>;
export type SummaryInput = z.infer<typeof summarySchema>;
