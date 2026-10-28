# Datasets

Training scripts look for these files and exit without training when they are absent:

- `pairs.jsonl` for `ml/training/contrastive.py`
- `rerank.jsonl` for `ml/training/reranker.py`

Each line is JSON with a `documentId`. A usable split needs at least two document ids so evaluation rows can come from a document that was not used for training. This directory does not ship a labeled corpus, and the application does not train a model at startup.
