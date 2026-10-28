# Evaluation

`pnpm eval` runs `packages/evaluation/src/cli.ts`.

The fixture has four passages and four questions, including one question with no relevant passage. Modes are dense, sparse, hybrid, hybrid plus the lexical reranker, and that combination plus the relevance gate. Embeddings are the deterministic feature hash at 128 dimensions inside this script. The lexical reranker is overlap of tokens. It is not `BAAI/bge-reranker-v2-m3`.

Metrics implemented in `packages/evaluation/src/metrics.ts` are Recall@K, MRR, nDCG, precision, and a binary recall for answerable questions. The report file is created only by running the script. It includes a disclaimer that the numbers are not a Gemini or production measurement.

Hybrid-versus-dense improvement is not a product claim until you run the script on a dataset that represents your documents and record that run separately. The checked-in docs do not contain those figures.

The end-to-end test uses the same deterministic embeddings and the fixture answer generator so citation and abstention behavior can run without a Gemini key. That test is not an accuracy benchmark.
