import { describe, expect, it } from "vitest";
import net from "node:net";

async function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

describe("external services", () => {
  it("checks MongoDB, Redis, and Qdrant on localhost", async (ctx) => {
    const [mongo, redis, qdrant] = await Promise.all([portOpen(27017), portOpen(6379), portOpen(6333)]);
    if (!mongo || !redis || !qdrant) {
      ctx.skip();
      return;
    }
    const response = await fetch("http://127.0.0.1:6333/healthz");
    expect(response.ok).toBe(true);
  });
});
