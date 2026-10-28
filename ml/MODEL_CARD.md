# Model card

## What the application calls

- Embeddings: Gemini Embedding 2, model id `gemini-embedding-2`, 768 dimensions, cosine. The id lives in `GEMINI_EMBEDDING_MODEL`. Documents are prefixed with `title: {name} | text: {chunk}`. Queries are prefixed with `task: search result | query: {question}`. One text is sent per embedding request.
- Generation: Gemini Interactions API, default model id `gemini-3.8-flash`, overridable with `GEMINI_GENERATION_MODEL`. Requests set `store: false`, stream text, and do not enable tools.
- Optional reranker: `BAAI/bge-reranker-v2-m3` behind `apps/reranker`. The service applies a sigmoid to the classification logit. Those scores are not calibrated probabilities. The default relevance threshold of 0.35 is uncalibrated until `pnpm eval` is run against a labeled set you trust.

## What this repository does not do

- Gemini embeddings are not fine-tuned.
- The optional training scripts under `ml/training` exit unless PyTorch and a local dataset exist. They do not run during a user request.
- Deterministic feature hashing exists for tests. Production refuses `EMBEDDING_PROVIDER=deterministic` and `GENERATION_PROVIDER=fixture`.
- No accuracy, latency, or quality number in this card is a measured production result. Run `pnpm eval` and read `ml/experiments/latest.json` for the fixture-only report.
