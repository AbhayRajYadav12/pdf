# Architecture

One Node process serves HTTP. A second Node process runs the ingestion worker. They share the TypeScript packages. Python exists only in `apps/reranker`, and Compose starts it with the `reranker` profile.

```
React (Vite) --> Express API --> MongoDB
                     |        --> Redis --> BullMQ worker --> MongoDB
                     |                       worker --> private file store
                     |                       worker --> Qdrant
                     |                       worker --> Gemini embeddings
                     --> Qdrant
                     --> Gemini generation
                     --> optional reranker
```

The tenant boundary is the workspace. Documents, chunks, conversations, vector payloads, and file keys include `workspaceId`. Retrieval sends a Qdrant filter for that workspace and the allowed document ids and versions, then checks the payload again in process.

A document becomes `ready` only after Qdrant reports at least as many points as chunks for that version. The previous version's points are deleted after that count succeeds. `readyVersion` is what chat searches. A failed reprocess keeps the previous ready version queryable.

Uploads accept `application/pdf`, check the `%PDF` header, enforce size and page limits, write the file through a local storage interface, and enqueue BullMQ job id `documentId:version`. The worker reconciles documents left in `processing` or `deleting`. Retention runs hourly. `retentionDays` of 0 keeps documents until a person deletes them.

Chat saves the user message and a pending assistant message, then the browser opens `GET /api/chat/:conversationId/stream?messageId=`. The server persists the validated answer before it emits `completed`. Disconnect aborts the provider call. Reconnect replays the stored message or attaches to the in-process generator. It does not resume a Gemini stream.

Local disk is the development file store. It is not a production object store. See [DEPLOYMENT.md](DEPLOYMENT.md).
