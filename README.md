# PDF-Summary AI

PDF-Summary AI is a workspace application for uploading PDFs and asking questions about them. Answers cite the document and page they came from. If the selected documents do not support an answer, the application says so instead of guessing.

## Problem and objectives

People need to ask questions of long PDFs without losing the page the answer came from, and without mixing documents from another workspace. This application:

- Keeps each workspace’s documents, conversations, and files separate.
- Prepares an uploaded PDF before it can be questioned.
- Answers from the selected documents and shows the source page.
- Lets a member summarize a ready document and open the page behind a claim.
- Lets an administrator add members and set how long documents are kept.

## Features that are implemented

- Email and password registration, sign-in, sign-out, and profile name updates. Registration creates a Personal workspace and makes the creator an administrator.
- Workspaces with `admin` and `member` roles. Administrators can rename a workspace, set retention, and add or remove members. The owner cannot be removed. A member must already have an account.
- PDF upload with a file-type check, size limit, and page limit. The library supports filename search and status filters.
- Document states: queued, processing, ready, failed, and deleting. Failed documents can be retried. Ready or failed documents can be processed again. Members can delete their own uploads. Administrators can delete any document in the workspace.
- A PDF viewer that opens the page named by a citation.
- Chat with streaming answers, citations, copy, rename, delete, and cancel. Reconnecting shows the stored answer. It does not continue a half-finished model call.
- Summaries in the styles executive, section, findings, dates, actions, and questions, at short, medium, or long length. A saved summary is returned again for the same document version, style, and length.
- An operations page for administrators with stored document counts, storage size, failed processing, rejected citations, and recent activity.

## Architecture

The browser talks to one HTTP API. A separate worker prepares documents. Shared TypeScript packages hold the database, PDF processing, retrieval, and answer logic. An optional Python service can reorder retrieved passages. It is not required to run the application.

```
Browser --> API --> MongoDB
              | --> Redis --> worker --> files, MongoDB, vector index
              --> vector index
              --> answer provider
```

The workspace is the boundary. Document queries and search filters include the workspace and the document version that is ready.

| Path | Role |
| --- | --- |
| `apps/web` | Browser application |
| `apps/api` | HTTP API, sessions, uploads, chat streaming |
| `apps/worker` | Background preparation of uploaded PDFs |
| `apps/reranker` | Optional passage reordering service |
| `packages/shared` | Environment validation, request schemas, errors |
| `packages/database` | MongoDB collections, indexes, repositories |
| `packages/document-processing` | Text extraction, scanned-page fallback, chunking, files |
| `packages/embeddings` | Query and document vectors |
| `packages/retrieval` | Dense and sparse search, fusion, relevance gate |
| `packages/generation` | Grounded answers, citation checks, summaries |
| `packages/evaluation` | Fixture metrics script |
| `infrastructure` | Container build files and nginx |
| `docs` | Architecture, API, security, deployment, and the engineering report |
| `tests` | Unit, integration, and end-to-end tests |
| `ml` | Model notes and training scripts that exit when data or PyTorch is missing |

There is no separate migration tool. On startup the API and worker connect to MongoDB and create the indexes in `packages/database/src/indexes.ts`. Collections are created when the first record is written.

## Technologies in this repository

- Node.js 22 or newer, pnpm 10.18.3, TypeScript
- React, Vite, and Tailwind CSS for the browser
- Express for the API
- Better Auth with the MongoDB adapter for email and password sessions
- MongoDB for application records
- Redis and BullMQ for the preparation queue
- Qdrant for document search
- Google Gemini for embeddings and answers when `GEMINI_API_KEY` is set
- `unpdf` for PDF text, and Tesseract.js when a page has too little extracted text
- Local disk for PDF bytes in development

Python is used only by the optional reranker.

## Prerequisites

- Node.js 22 or newer
- pnpm 10.18.3
- MongoDB, Redis, and Qdrant for the normal local run
- A Gemini API key, stored in `.env` as `GEMINI_API_KEY`, for real indexing and answers

Docker Compose is the supported way to start MongoDB, Redis, and Qdrant:

```bash
docker compose up mongo redis qdrant
```

That publishes them on `127.0.0.1` only. Ports are 27017, 6379, and 6333.

## Configuration

Copy the example environment file and edit the secret and API key locally. Do not commit `.env` or paste secrets into chat or tickets.

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Set `BETTER_AUTH_SECRET` to at least 32 characters. Put the Gemini key in `GEMINI_API_KEY`. Leave the key empty only when you want indexing and answers to fail with a configuration error.

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Browser origin allowed to call the API. Development default `http://localhost:5173`. |
| `API_PORT` | API port. Default `4000`. |
| `BETTER_AUTH_URL` | Auth base URL. Development default `http://localhost:4000`. |
| `MONGODB_URI` | MongoDB connection string. |
| `REDIS_URL` | Redis connection string used by the queue. |
| `QDRANT_URL` | Vector index URL. The value `memory` is an in-process test store and is refused in production. |
| `STORAGE_DIR` | Directory for PDF bytes. Default `./data/documents`. |
| `GEMINI_API_KEY` | Required for real embeddings and answers. |
| `GEMINI_EMBEDDING_MODEL` | Default `gemini-embedding-2`. |
| `GEMINI_GENERATION_MODEL` | Default `gemini-3.8-flash`. |
| `EMBEDDING_PROVIDER` | `gemini` in normal use. `deterministic` is for tests and is refused in production. |
| `GENERATION_PROVIDER` | `gemini` in normal use. `fixture` is for tests and is refused in production. |
| `RERANKER_PROVIDER` | `none` or `bge`. |
| `INGESTION_MODE` | `queue` for the worker. `inline` is for tests and is refused in production. |
| `MAX_UPLOAD_BYTES` | Default 25 MB. |
| `MAX_PDF_PAGES` | Default 200. |
| `RELEVANCE_MIN_SCORE` | Default `0.35`. This threshold is not calibrated. |

The full list is in `.env.example` and is validated when the API or worker starts.

## Run it locally

1. Install dependencies: `pnpm install`
2. Start MongoDB, Redis, and Qdrant: `docker compose up mongo redis qdrant`
3. Configure `.env` as above.
4. Start the API, worker, and browser app: `pnpm dev`

Open `http://localhost:5173`. The browser dev server proxies `/api` to port 4000, so the sign-in cookie stays on the same origin. Create an account, upload a PDF, wait until its status is ready, then ask a question and open the cited page.

`pnpm dev` runs:

- `@pdf-summary/api` on port 4000
- `@pdf-summary/worker`, which requires `INGESTION_MODE=queue` and a real vector index URL
- `@pdf-summary/web` on port 5173

To include optional passage reordering, start that service and set `RERANKER_PROVIDER=bge`:

```bash
docker compose --profile reranker up
```

The first start downloads a large model. The application runs with `RERANKER_PROVIDER=none` without it. Scores from that service are not calibrated probabilities.

## Authentication

- `POST /api/auth/register` with JSON `email`, `password` (at least 10 characters), and `name`. Returns the user and the new workspace. Sets the session cookie.
- `POST /api/auth/login` with `email` and `password`.
- `POST /api/auth/logout`.
- `GET /api/auth/me` returns the user and workspace memberships.
- `PATCH /api/auth/me` with `name`.

Other routes require the session cookie. Document and chat routes also require membership in the workspace. A document id from another workspace returns 404. Production requests that change data must send an `Origin` of `APP_ORIGIN` or `BETTER_AUTH_URL`.

Roles are `admin` and `member`, stored in this application’s membership records.

## API

Errors use `{ "error": { "code": "...", "message": "..." } }`.

Documents:

- `POST /api/documents` as multipart form data with `workspaceId` and `file`. Returns 202 and a queued document.
- `GET /api/documents?workspaceId=&q=&status=&limit=&offset=`
- `GET /api/documents/:id`
- `GET /api/documents/:id/progress`
- `GET /api/documents/:id/file` streams the PDF after a membership check
- `POST /api/documents/:id/retry` for a failed document
- `POST /api/documents/:id/reprocess` queues a new version and keeps the previous ready version until the new one is verified
- `DELETE /api/documents/:id`
- `POST /api/documents/:id/summarize` with `style` and `length`
- `GET /api/documents/:id/summary?style=&length=`

Chat:

- `POST /api/chat` with `workspaceId`, `question`, optional `conversationId`, and optional `documentIds`. Returns 202 with `conversationId`, `messageId`, and `streamPath`.
- `GET /api/chat/:conversationId/stream?messageId=` streams events named `status`, `retrieval`, `sources`, `token`, `completed`, and `error`.
- `POST /api/chat/:conversationId/cancel` with `messageId`
- `POST /api/chat/:conversationId/retry` with `messageId` for a failed or cancelled answer
- Conversation list, rename, and delete routes are under `/api/chat/conversations`.

Health:

- `GET /api/health` reports that the process is up.
- `GET /api/ready` checks MongoDB, the vector index, and Redis when Redis is required. It returns 503 when a required check fails.
- `GET /api/ops/summary` requires an administrator and the `x-workspace-id` header.

Request and response fields are also described in [docs/API.md](docs/API.md). Collection fields are in [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md).

## Tests

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm test:integration
pnpm eval
```

Unit tests do not need MongoDB, Redis, or Qdrant. The end-to-end test starts an in-memory MongoDB, uses an in-process vector store, and does not call Gemini. `pnpm test:integration` skips unless MongoDB, Redis, and Qdrant are listening on localhost. `pnpm eval` writes `ml/experiments/latest.json` for a small fixture. Those numbers are not a measurement of Gemini or of the optional reranker.

The last recorded run is in [docs/ENGINEERING_REPORT.md](docs/ENGINEERING_REPORT.md).

## Build and deployment

```bash
pnpm build
```

Container images and nginx are under `infrastructure/`. From a configured environment:

```bash
docker compose up --build
```

The composed browser and API are served at `http://localhost:8080`. `BETTER_AUTH_SECRET` must be set in the environment. PDF bytes in that stack use a local volume, which is not a multi-machine object store. Deployment limits are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Troubleshooting

- **Indexing or chat returns a configuration error.** `GEMINI_API_KEY` is missing or was rejected. The server does not invent an answer. Set the key in `.env` and retry.
- **A document stays queued.** The worker is not running, or Redis is down. `pnpm dev` starts the worker. Check `GET /api/documents/:id/progress`.
- **The document never becomes ready.** The worker marks it ready only after the vector index contains the expected number of sections. Check `QDRANT_URL` and the worker log.
- **Sign-in works in the API but not in the browser.** Use `http://localhost:5173`, which proxies `/api`. Calling port 4000 from a page on another origin will not send the session cookie.
- **Another workspace can open a document.** That is a defect. The end-to-end test expects 404 for a second workspace.

More cases are in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Limitations

- Without `GEMINI_API_KEY`, indexing and answers fail with a configuration error.
- The default relevance threshold is not calibrated.
- Scanned pages use a local text-recognition fallback. Complex scans can be wrong.
- Development file storage is a local directory, not a private object store.
- The optional reranker is large, slow on CPU, and not required.
- Training scripts under `ml/training` exit unless PyTorch and a local dataset exist. They are not used when someone asks a question.
- `scripts/memory-api.ts` can boot the API without Docker for interface checks. It keeps data in memory, uses test embeddings, and does not persist after the process stops. It is not the supported way to run the application.
