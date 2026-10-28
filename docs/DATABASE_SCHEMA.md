# Database schema

MongoDB collections are created by the repositories. Indexes are created at startup in `packages/database/src/indexes.ts`.

Better Auth owns `user`, `session`, `account`, and `verification`. The adapter maps the user id to `_id`.

| Collection | Important fields |
| --- | --- |
| `workspaces` | `name`, `ownerId`, `retentionDays` |
| `memberships` | `workspaceId`, `userId`, `role` (`admin` or `member`), unique on the pair |
| `documents` | `workspaceId`, `ownerId`, `filename`, `storageKey`, `status`, `progress`, `version`, `readyVersion`, `contentHash`, `chunkCount`, `embeddingModelVersion`, `ocrPageCount` |
| `chunks` | chunk id, `documentId`, `version`, `pageStart`, `pageEnd`, `sectionTitle`, `text`, `contentHash`, `tokenCount` |
| `conversations` | `workspaceId`, `ownerId`, `title`, `documentIds` |
| `messages` | `conversationId`, `role`, `content`, `status`, `abstained`, `conflict`, `validationFailures` |
| `citations` | `messageId`, `chunkId`, `evidenceId`, `pageStart`, `pageEnd`, `excerpt`, `documentVersion` |
| `processingJobs` | job id `documentId:version`, `stage`, `attempt`, `error`, timings |
| `summaries` | `documentId`, `version`, `style`, `length`, `content`, `claims` |
| `auditEvents` | `actorId`, `action`, `workspaceId`, `targetId`, timestamp. No document body. |
| `usageEvents` | embedding and generation counts and latency when the caller records them |

Document status is `queued`, `processing`, `ready`, `failed`, or `deleting`. Message status is `pending`, `streaming`, `completed`, `failed`, `cancelled`, or `abstained`.

PDF bytes are not stored in MongoDB. `storageKey` points at the file store.

Qdrant collection `document_chunks` uses named vectors `text` (768-dimensional cosine, unless `EMBEDDING_DIMENSIONS` changes) and sparse `text_sparse` with the IDF modifier. The point id is the chunk id. Payload indexes are `workspaceId`, `documentId`, and `documentVersion`. The same tokenizer builds sparse vectors at index time and query time.
