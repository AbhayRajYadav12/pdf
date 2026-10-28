#!/usr/bin/env python3
"""Optional reranker training stub. It is not on the request path and does not download BGE weights."""

from __future__ import annotations

import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "datasets" / "rerank.jsonl"


def main() -> int:
    try:
        import torch
    except ImportError:
        print("PyTorch is not installed. No reranker training was run.", file=sys.stderr)
        return 2
    if not DATA.exists():
        print(f"{DATA} is missing. No reranker training was run.", file=sys.stderr)
        return 2
    random.seed(11)
    torch.manual_seed(11)
    rows = [line for line in DATA.read_text(encoding="utf-8").splitlines() if line.strip()]
    documents = set()
    for line in rows:
        if '"documentId"' in line:
            documents.add(line.split('"documentId"', 1)[1].split('"', 2)[1])
    if len(documents) < 2:
        print("Hold out a different document than the training rows. This file does not have two document ids.", file=sys.stderr)
        return 2
    print(f"Dataset has {len(rows)} rows. This stub does not write a checkpoint.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
