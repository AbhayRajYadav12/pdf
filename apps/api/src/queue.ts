import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { createLogger } from "@pdf-summary/shared";

export const INGESTION_QUEUE = "ingestion";

export interface IngestPayload {
  documentId: string;
  workspaceId: string;
  version: number;
}

export interface IngestionQueue {
  enqueue(data: IngestPayload): Promise<void>;
  close(): Promise<void>;
}

const logger = createLogger("queue");

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createBullQueue(connection: Redis): IngestionQueue {
  const queue = new Queue<IngestPayload>(INGESTION_QUEUE, { connection });
  return {
    async enqueue(data) {
      try {
        await queue.add("ingest", data, {
          jobId: `${data.documentId}:${data.version}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: 200,
          removeOnFail: 500,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!/already exists|Job is already/i.test(message)) throw error;
        logger.info({ documentId: data.documentId, version: data.version }, "ingestion job already queued");
      }
    },
    async close() {
      await queue.close();
    },
  };
}

export function createInlineQueue(run: (data: IngestPayload) => Promise<void>): IngestionQueue {
  return {
    async enqueue(data) {
      void run(data).catch((error: unknown) => {
        logger.error({ err: error, documentId: data.documentId }, "inline ingestion failed");
      });
    },
    async close() {},
  };
}
