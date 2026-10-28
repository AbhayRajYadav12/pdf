"""Optional cross-encoder. Scores are sigmoid outputs and are not calibrated probabilities."""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

MODEL_ID = os.environ.get("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
app = FastAPI(title="PDF-Summary reranker")
loaded: tuple[Any, Any] | None = None


class Passage(BaseModel):
    id: str
    text: str


class RerankRequest(BaseModel):
    query: str
    model: str | None = None
    passages: list[Passage] = Field(default_factory=list)


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "model": MODEL_ID, "loaded": loaded is not None, "calibrated": False}


@app.post("/rerank")
def rerank(body: RerankRequest) -> dict[str, object]:
    global loaded
    if not body.passages:
        return {"model": MODEL_ID, "calibrated": False, "results": []}
    if loaded is None:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
        encoder = AutoModelForSequenceClassification.from_pretrained(MODEL_ID)
        encoder.eval()
        loaded = (tokenizer, encoder, torch)
    tokenizer, encoder, torch = loaded
    pairs = [[body.query, passage.text] for passage in body.passages]
    tokens = tokenizer(pairs, padding=True, truncation=True, max_length=512, return_tensors="pt")
    with torch.no_grad():
        logits = encoder(**tokens).logits.view(-1)
        scores = torch.sigmoid(logits).tolist()
    return {
        "model": MODEL_ID,
        "calibrated": False,
        "results": [
            {"id": passage.id, "score": float(score), "model": MODEL_ID}
            for passage, score in zip(body.passages, scores, strict=True)
        ],
    }
