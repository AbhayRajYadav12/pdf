#!/usr/bin/env python3
"""Optional contrastive training stub. It is not on the request path and does not fine-tune Gemini."""

from __future__ import annotations

import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "datasets" / "pairs.jsonl"


def main() -> int:
    try:
        import torch
    except ImportError:
        print("PyTorch is not installed. No training was run.", file=sys.stderr)
        return 2
    if not DATA.exists():
        print(f"{DATA} is missing. No training was run.", file=sys.stderr)
        return 2
    random.seed(7)
    torch.manual_seed(7)
    rows = [line for line in DATA.read_text(encoding="utf-8").splitlines() if line.strip()]
    by_document: dict[str, list[str]] = {}
    for line in rows:
        document_id = "unknown"
        if '"documentId"' in line:
            document_id = line.split('"documentId"', 1)[1].split('"', 2)[1]
        by_document.setdefault(document_id, []).append(line)
    if len(by_document) < 2:
        print("The dataset needs rows from at least two documents so the split can block same-document leakage.", file=sys.stderr)
        return 2
    print(f"Dataset has {len(rows)} rows across {len(by_document)} documents. This stub does not write a checkpoint.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
