# ML model guide

Read [../ml/MODEL_CARD.md](../ml/MODEL_CARD.md) for the model ids this application calls.

`packages/evaluation` can score a four-passage fixture with deterministic hashing, sparse term frequency, reciprocal rank fusion, and a lexical overlap reranker. Run:

```bash
pnpm eval
```

The script writes `ml/experiments/latest.json`. The file says the numbers are fixture-only. Do not copy them into documentation as Gemini or BGE accuracy.

`ml/training/contrastive.py` and `ml/training/reranker.py` exit with status 2 when PyTorch is missing or the JSONL dataset is missing. They refuse a dataset that does not contain two document ids, so a split cannot accidentally train and evaluate on the same document only. They do not fine-tune Gemini.

The BGE service is optional. Its sigmoid scores are not calibrated. `RELEVANCE_MIN_SCORE` defaults to 0.35 and is uncalibrated for that model. With `RERANKER_PROVIDER=none`, the gate keeps a hit that has a sparse rank or a dense cosine at or above the threshold. It does not invent a neural score.
