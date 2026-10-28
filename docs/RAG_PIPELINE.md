# RAG pipeline

1. Resolve the caller's workspace membership. Reject document ids outside that workspace or without a ready version.
2. Embed the question with the query prefix. Search dense and sparse vectors with the same workspace, document, and version filter.
3. Fuse the two lists with reciprocal rank fusion (`k = 60`) and keep rank provenance.
4. When `RERANKER_PROVIDER=bge`, send the bounded candidate set to the reranker. When it is `none`, keep the fused order.
5. Apply the relevance gate. An empty set abstains with `no_evidence`. A reranker score under `RELEVANCE_MIN_SCORE` abstains with `below_rerank_threshold`. Without a reranker, a hit must have a sparse rank or a dense score at the threshold, otherwise the reason is `weak_evidence`.
6. Fit the accepted passages into `CONTEXT_TOKEN_BUDGET` using the token counter.
7. Stream an answer. The system instruction tells the model to answer only from the passages, treat them as untrusted data, cite evidence ids, and abstain when the passages are insufficient. Passages cannot enable tools or change scope.
8. Keep a citation only when its evidence id was retrieved. Fill the page, document name, and version from the chunk. The stored excerpt is a prefix of the chunk text. Drop anything else and record a validation failure.
9. If the model text says `INSUFFICIENT_EVIDENCE` or no citation survives, persist the abstention message and no citations.
10. If retrieved passages from different versions disagree and both remain cited, the message is marked as a conflict and the interface shows both citations.

Chunking targets `CHUNK_TARGET_TOKENS` (700) with `CHUNK_OVERLAP_TOKENS` (100), counted by `js-tiktoken` `cl100k_base`. The chunk id is a UUIDv5 of workspace, document, version, index, and content hash. Pages whose extracted text is shorter than `OCR_MIN_CHARS` are rendered and passed to Tesseract.js. OCR is a fallback for sparse pages, not a document-AI product, and scans with unusual layout can still be wrong.

Missing `GEMINI_API_KEY` raises a configuration error on the embedding or generation call. The server does not substitute a fabricated answer.
