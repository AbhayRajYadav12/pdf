# PDF-Summary AI

PDF-Summary AI is a workspace application for uploading PDFs, indexing their text, and answering questions with citations that come from retrieved pages.

The web app runs at `http://localhost:5173` in development. The API runs at `http://localhost:4000`. In the Compose stack, nginx serves the web app and the API on `http://localhost:8080`.

## What you need

- Node.js 22 or newer
- pnpm 10.18.3 (`packageManager` in the root `package.json`)
- MongoDB, Redis, and Qdrant for the queued ingestion path
- `GEMINI_API_KEY` for real embeddings and answers

Docker is the intended way to start MongoDB, Redis, and Qdrant. This repository includes Compose files. A machine without Docker can still run unit tests and the in-memory end-to-end test.

Copy `.env.example` to `.env` and set `BETTER_AUTH_SECRET` to at least 32 characters. Leave `GEMINI_API_KEY` empty only when you want indexing and answers to fail with a configuration error. Production refuses deterministic embeddings, fixture generation, the in-memory vector store, and inline ingestion.

## Local development

```bash
pnpm install
docker compose up mongo redis qdrant
pnpm dev
```

`pnpm dev` starts the API, the worker, and the web app. Upload a PDF from the library, wait until its status is `ready`, then ask a question in chat. Open a citation to land on that page in the PDF viewer.

Set `RERANKER_PROVIDER=bge` and `docker compose --profile reranker up` only when you want the optional cross-encoder. The first start downloads `BAAI/bge-reranker-v2-m3`. The app boots with `RERANKER_PROVIDER=none`.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm eval
```

`pnpm test:integration` checks local MongoDB, Redis, and Qdrant ports and skips when those ports are closed. `pnpm eval` writes `ml/experiments/latest.json`. Those numbers describe the fixture retriever, not Gemini and not the BGE reranker. The latest local run is summarized in [docs/ENGINEERING_REPORT.md](docs/ENGINEERING_REPORT.md).

## Layout

- `apps/web` — React interface
- `apps/api` — Express API
- `apps/worker` — BullMQ ingestion worker
- `apps/reranker` — optional FastAPI cross-encoder
- `packages/*` — shared libraries
- `infrastructure` — Dockerfiles, Compose, nginx
- `ml` — model card and training stubs that exit without data
- `docs` — architecture, API, operations, and security notes

Further reading starts with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
