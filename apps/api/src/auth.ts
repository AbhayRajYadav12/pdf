import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import type { Response } from "express";
import type { Database } from "@pdf-summary/database";
import type { AppEnv } from "@pdf-summary/shared/env";

export function createAuth(database: Database, env: AppEnv) {
  return betterAuth({
    database: mongodbAdapter(database.db, { client: database.client, transaction: false }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.APP_ORIGIN, env.BETTER_AUTH_URL],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      useSecureCookies: env.NODE_ENV === "production",
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export async function forwardAuthResponse(authResponse: globalThis.Response, res: Response): Promise<unknown> {
  const cookies = typeof authResponse.headers.getSetCookie === "function" ? authResponse.headers.getSetCookie() : [];
  for (const cookie of cookies) res.append("Set-Cookie", cookie);
  const text = await authResponse.text();
  return text ? JSON.parse(text) as unknown : {};
}

export function requestHeaders(headers: IncomingHttpHeaders): Headers {
  return fromNodeHeaders(headers);
}
