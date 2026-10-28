# Troubleshooting

## Indexing or chat returns CONFIGURATION

`GEMINI_API_KEY` is empty or was rejected. The server does not invent embeddings or answers. Set the key and retry the document or the question.

## A document stays queued

The API is in `INGESTION_MODE=queue` and the worker is not running, or Redis is down. Start the worker with the same `.env`. `GET /api/documents/:id/progress` shows the job stage. A failed job can be retried from the library when its status is `failed`.

## Ready never arrives

The worker marks a document ready only after the Qdrant point count for that version matches the chunk count. Check `QDRANT_URL`, the collection name, and the worker log. An embedding dimension mismatch throws before upsert.

## OCR pages look wrong

Tesseract.js runs only when extracted text is shorter than `OCR_MIN_CHARS`. It is a local fallback. Low-contrast scans and complex tables can be misread. The document record stores `ocrPageCount`.

## Chat says there is not enough evidence

The relevance gate rejected the hits, or citation validation found no evidence id that was actually retrieved. That is an abstention. Raising recall by lowering `RELEVANCE_MIN_SCORE` is a product decision. The default 0.35 is uncalibrated.

## The reranker returns 503

`RERANKER_PROVIDER=bge` but the FastAPI process is not up or is still loading weights. Start it with `docker compose --profile reranker up`. `RERANKER_PROVIDER=none` skips it.

## Another workspace can see a document

That would be a defect. Retrieval filters on `workspaceId`, and the document routes check membership. The end-to-end test registers a second user and expects 404 for the first user's document.

## Cookies are missing in development

Use the Vite origin `http://localhost:5173`. The dev server proxies `/api`, so the session cookie is set on that origin. Calling port 4000 directly from a browser page on 5173 is a different site.
