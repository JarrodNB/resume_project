"""Run the optional local Llama prompt-injection classifier without discarding input.

The model is loaded lazily from a local cache or Hugging Face. Its gated artifact must
be provisioned before selecting this mode; load and inference errors fail closed upstream.
"""

from functools import lru_cache
from time import monotonic
from types import SimpleNamespace

MODEL = "meta-llama/Llama-Prompt-Guard-2-22M"
MAX_TOKENS = 512
TARGET_CHARACTERS = 1700
OVERLAP = 300


@lru_cache(maxsize=1)
def _model_pair():
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL)
    labels = {int(key): value.upper() for key, value in model.config.id2label.items()}
    if labels != {0: "LABEL_0", 1: "LABEL_1"}:
        raise ValueError("Unexpected Llama Prompt Guard label mapping")
    model.eval()
    return tokenizer, model


def iter_chunks(text):
    """Yield overlapping exact substrings that fit both character and token limits."""
    tokenizer, _ = _model_pair()
    start = 0
    while start < len(text):
        end = min(start + TARGET_CHARACTERS, len(text))
        encoded = tokenizer(text[start:end], add_special_tokens=True, truncation=False)
        while len(encoded["input_ids"]) > MAX_TOKENS:
            end = start + max(1, (end - start) // 2)
            encoded = tokenizer(text[start:end], add_special_tokens=True, truncation=False)
            if end == start + 1 and len(encoded["input_ids"]) > MAX_TOKENS:
                raise ValueError("A character exceeds the model token limit")
        yield text[start:end], len(encoded["input_ids"])
        if end == len(text):
            break
        start = max(start + 1, end - min(OVERLAP, (end - start) // 2))


def classify_chunk(chunk, model_name, timeout):
    """Classify one complete chunk; only the exact positive label blocks."""
    import torch

    if model_name != MODEL:
        raise ValueError("Unknown local screening model")
    started = monotonic()
    tokenizer, model = _model_pair()
    tokens = tokenizer(chunk, return_tensors="pt", truncation=False)
    if len(tokens["input_ids"][0]) > MAX_TOKENS:
        raise ValueError("Chunk exceeds model token limit")
    with torch.no_grad():
        scores = model(**tokens).logits
    if monotonic() - started > timeout:
        raise TimeoutError("Local screening deadline exceeded")
    if scores.shape[-1] != 2 or not torch.isfinite(scores).all():
        raise ValueError("Invalid local screening output")
    predicted = int(scores.argmax(dim=-1).item())
    if predicted not in (0, 1):
        raise ValueError("Unknown local screening label")
    return SimpleNamespace(blocked=predicted == 1, tokens=len(tokens["input_ids"][0]),
                           duration=monotonic() - started)
