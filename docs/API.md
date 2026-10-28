# API

Session cookies are httpOnly. Browser requests in development go to the Vite server, which proxies `/api` to port 4000. Send `Content-Type: application/json` except for uploads.

Errors use `{ "error": { "code": "...", "message": "..." } }`.

## Auth

- `POST /api/auth/register` with `email`, `password` (at least 10 characters), and `name`. Creates a Personal workspace and returns the user, the workspace, and a session cookie.
- `POST /api/auth/login` with `email` and `password`.
- `POST /api/auth/logout`.
- `GET /api/auth/me` returns the user and workspace memberships.
- `PATCH /api/auth/me` with `name`.

## Workspaces

- `GET /api/workspaces`
- `POST /api/workspaces` with `name`
- `GET /api/workspaces/:id` returns the workspace, document counts, and members
- `PATCH /api/workspaces/:id` with `name` and `retentionDays` (admin)
- `POST /api/workspaces/:id/members` with `email` and `role` of `admin` or `member`
- `DELETE /api/workspaces/:id/members/:userId` (the owner cannot be removed)

## Documents

- `POST /api/documents` multipart fields `workspaceId` and `file`. Returns 202 and a queued document.
- `GET /api/documents?workspaceId=&q=&status=&limit=&offset=`
- `GET /api/documents/:id`
- `GET /api/documents/:id/progress`
- `GET /api/documents/:id/file` streams the PDF after a membership check
- `POST /api/documents/:id/retry` for a failed document, same version
- `POST /api/documents/:id/reprocess` increments the version and keeps the previous ready version until the new one verifies
- `DELETE /api/documents/:id` removes the file, chunks, summaries, and vectors. Members can delete their own uploads. Admins can delete any document in the workspace.
- `POST /api/documents/:id/summarize` with `style` (`executive`, `section`, `findings`, `dates`, `actions`, `questions`) and `length` (`short`, `medium`, `long`)
- `GET /api/documents/:id/summary?style=&length=`

## Chat

- `POST /api/chat` with `workspaceId`, `question`, optional `conversationId`, and optional `documentIds`. Returns 202 with `conversationId`, `messageId`, and `streamPath`.
- `GET /api/chat/:conversationId/stream?messageId=` is an SSE response. Events are `status`, `retrieval`, `sources`, `token`, `completed`, and `error`. Comment lines beginning with `:` are heartbeats. Event ids increase per response.
- `POST /api/chat/:conversationId/cancel` with `messageId`
- `POST /api/chat/:conversationId/retry` with `messageId` for a failed or cancelled assistant message
- `GET /api/chat/:conversationId/sources?messageId=`
- Conversation collection routes live under `/api/chat/conversations`.

`completed` carries `content`, `citations`, `abstained`, and `conflict`. Page numbers on citations are copied from chunk metadata. An excerpt is accepted only when it is text from that chunk.

## Operations

- `GET /api/health` is liveness.
- `GET /api/ready` checks MongoDB, Qdrant, and Redis when Redis is configured. It returns 503 when a required check fails.
- `GET /api/ops/summary` with `x-workspace-id` requires an admin membership and returns stored counts.
- `GET /api/metrics` returns a small text exposition for an admin or for `Authorization: Bearer $METRICS_TOKEN`.

Auth, upload, and chat routes are rate limited.
