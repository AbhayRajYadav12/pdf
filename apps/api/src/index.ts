import { loadEnv } from "@pdf-summary/shared/env";
import { createLogger } from "@pdf-summary/shared";
import { createApp } from "./app.js";
import { createContext } from "./context.js";

const logger = createLogger("api");

const env = loadEnv();
const ctx = await createContext(env);
const app = createApp(ctx);
const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, "api listening");
});
server.requestTimeout = 0;

async function shutdown() {
  server.close();
  await ctx.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
