# Engineering report

This report records commands run in this workspace on 23 and 26 October 2026. Figures below are copied from those commands. They are not Gemini accuracy, BGE quality, or Qdrant latency.

## Verified

`pnpm typecheck` completed with exit code 0.

`pnpm lint` completed with exit code 0 after three lint errors were fixed (`no-useless-assignment` in chat, an unused membership binding, and an empty interface in the memory vector store).

`pnpm test:unit` — 1 file, 14 tests passed. Coverage includes chunk bounds and stable ids, the OCR decision and an injected OCR engine, RRF provenance, the relevance gate, workspace filtering in the memory store, citation rejection of unknown evidence ids, the grounded system instruction, Recall@K and MRR, production refusal of deterministic embeddings, and a missing `GEMINI_API_KEY` configuration error for both embeddings and generation.

`pnpm test:e2e` — 1 test passed. It registers a user, uploads a PDF built with `pdf-lib`, waits until the document is `ready`, asks for the contract reference, checks that the citation page is 1, asks an unrelated question and receives the abstention text with no sources, confirms a second workspace gets 404, and deletes the document. The process uses `mongodb-memory-server`, `QDRANT_URL=memory`, `EMBEDDING_PROVIDER=deterministic`, `GENERATION_PROVIDER=fixture`, and inline ingestion. It does not call Gemini.

`pnpm test:integration` — 1 test skipped. MongoDB port 27017, Redis port 6379, and Qdrant port 6333 were not listening, so no external service was checked.

`pnpm eval` wrote `ml/experiments/latest.json` at `2026-10-23T12:37:00.566Z`. The file's disclaimer says the figures describe that fixture only. Embedding was `deterministic-feature-hash` and the reranker was `lexical-overlap`, not BGE. On the four-question fixture, Recall@5 was 0.75 for dense, sparse, hybrid, and hybrid-plus-lexical-rerank. The gated hybrid mode dropped Recall@5 to 0.5 and abstained on 2 of 4 questions. The one unanswerable question abstained under sparse retrieval and under the gated hybrid mode. Hybrid retrieval did not beat dense retrieval on this fixture, so this run is not evidence of a hybrid improvement.

`pnpm perf` measured the in-process memory store: 200 points, 768 dimensions, upsert 71 ms, search 45 ms, 10 hits. That is not a Qdrant measurement.

`python ml/training/contrastive.py` and `python ml/training/reranker.py` both exited 2 because PyTorch is not installed. No checkpoint was written.

Browser check against `http://localhost:5173`, with `scripts/memory-api.ts` on port 4000. That process uses in-memory MongoDB, the memory vector store, deterministic embeddings, and fixture answers. It is not the Compose stack.

- Landing page rendered the workflow, security controls, and technology list.
- Registration created the Personal workspace and opened an empty dashboard (0 total, 0 ready, 0 processing, 0 failed, empty document and conversation lists).
- The library empty state, search, status filter, and upload control rendered. A later visit showed `1 document` after indexing.
- A one-page PDF was uploaded through `POST /api/documents` as the signed-in user. The file picker in the browser was not used. The document reached `ready` with `readyVersion` 1.
- Chat returned: "The contract reference is ZX-4419 and the renewal date is 12 March 2026." with citation `E1 · contract.pdf · page 1` and the source excerpt separated from the answer.
- The citation opened the PDF viewer on page 1 of 1. The canvas was 773 by 1094 pixels and showed no error.
- Executive summary for that document returned the same sentence and a page-1 claim. The button then read "Saved for this style".
- Operations, as admin, showed 924 stored bytes, 0 failed jobs, 0 citation validation failures, 1 ready document, 1 embedding call, 2 generation calls, and 0 rerank calls. Average latencies stored for this demo were 1 ms (embedding) and 10 ms (generation). Those calls were the deterministic embedder and the fixture generator, not Gemini.
- Settings showed the profile, workspace retention, the admin member, and the new-workspace form.
- Sign-out returned to the login page. Signing in again restored the dashboard with the same document and conversation.
- At a 390-pixel width the sidebar was hidden and "Open navigation" revealed the workspace switcher and links.

## Not verified here

Docker is not part of this run, so Compose, the BullMQ worker, Redis, and Qdrant were not started. The worker code typechecks; it was not executed against those services.

`GEMINI_API_KEY` was left empty for the browser API and the end-to-end test. The unit test asserts that a missing key raises `CONFIGURATION` and does not invent vectors or answer text. No live Gemini embedding or Interactions API call was made.

The BGE reranker image was not built and its weights were not downloaded. `RERANKER_PROVIDER=none` was used. The lexical reranker in the evaluation file is a token-overlap stand-in.

No labeled training set was present, and PyTorch was not installed, so the training stubs did not train.

The default relevance threshold of 0.35 remains uncalibrated. On the fixture, applying the gate reduced recall.
