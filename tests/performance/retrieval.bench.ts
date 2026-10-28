import { performance } from "node:perf_hooks";
import { hashEmbed } from "@pdf-summary/embeddings";
import { MemoryVectorStore, sparseVector } from "@pdf-summary/retrieval";

const dimensions = 768;
const count = 200;
const store = new MemoryVectorStore();
await store.ensureCollection(dimensions);
const started = performance.now();
await store.upsert(
  Array.from({ length: count }, (_, index) => {
    const text = `passage ${index} contract reference ZX-${index}`;
    return {
      id: `00000000-0000-0000-0000-${index.toString(16).padStart(12, "0")}`,
      dense: hashEmbed(text, dimensions),
      sparse: sparseVector(text),
      payload: {
        tenantId: "ws",
        workspaceId: "ws",
        documentId: "doc",
        documentVersion: 1,
        chunkId: `chunk-${index}`,
        pageStart: 1,
        pageEnd: 1,
        sectionTitle: null,
        documentName: "bench.pdf",
        contentHash: `hash-${index}`,
        text,
        embeddingModelVersion: "deterministic-feature-hash",
      },
    };
  }),
);
const query = hashEmbed("contract reference", dimensions);
const searchStarted = performance.now();
const hits = await store.searchDense(query, { workspaceId: "ws", documents: [{ documentId: "doc", version: 1 }] }, 10);
const elapsedMs = performance.now() - searchStarted;
const result = {
  store: "memory",
  points: count,
  dimensions,
  upsertMs: Math.round(performance.now() - started),
  searchMs: Math.round(elapsedMs),
  hits: hits.length,
  note: "In-process memory store. This is not a Qdrant latency measurement.",
};
console.log(JSON.stringify(result, null, 2));
