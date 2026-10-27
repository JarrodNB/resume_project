"""Compare reviewed billing rates with the current genai-prices provider catalogue.

This makes no paid model calls and never changes prices or historical receipts.
Scheduled CI fails on drift or a failed refresh, so stale prices cannot pass silently.
Run with the AI service's Python environment; --offline checks the bundled catalogue.
"""
import argparse
import ast
import json
from decimal import Decimal
from pathlib import Path

from genai_prices import UpdatePrices, Usage, calc_price
from genai_prices.data_snapshot import set_custom_snapshot

ROOT = Path(__file__).resolve().parents[1]


def reviewed_rates():
    """Read the literal Python table without importing worker runtime dependencies."""
    tree = ast.parse((ROOT / "services/ai/llm/model_prices.py").read_text())
    table = next(node.value for node in tree.body if isinstance(node, ast.AnnAssign)
                 and isinstance(node.target, ast.Name) and node.target.id == "MODEL_PRICES")
    for key, value in zip(table.keys, table.values, strict=True):
        model = ast.literal_eval(key)
        if model.startswith(("openai:", "typesafe:")):
            provider, model = model.split(":", 1)
            yield provider, model, {
                item.arg: Decimal(str(ast.literal_eval(item.value))) for item in value.keywords}
    for model, rate in json.loads((ROOT / "services/api/config/ai_embedding_prices.json").read_text()).items():
        yield "openai", model, {"input": Decimal(rate)}


def check_rates():
    """Return mismatched rates using isolated usage for every priced token category."""
    issues = []
    for provider, model, rates in reviewed_rates():
        for kind, rate in rates.items():
            fields = {"input_tokens": 0, "output_tokens": 0}
            if kind == "output":
                fields["output_tokens"] = 1_000
            else:
                fields["input_tokens"] = 1_000
                if kind in {"cached_input", "cache_write"}:
                    fields["cache_read_tokens" if kind == "cached_input" else "cache_write_tokens"] = 1_000
            try:
                actual = calc_price(Usage(**fields), model, provider_id=provider).total_price * 1_000
                if actual != rate:
                    issues.append(f"{model} {kind}: reviewed ${rate}/M, catalogue ${actual}/M")
            except (LookupError, ValueError) as error:
                issues.append(f"{model} {kind}: catalogue lookup failed ({type(error).__name__})")
    return issues


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    if not args.offline:
        snapshot = UpdatePrices().fetch()
        if snapshot is None:
            raise SystemExit("Price catalogue refresh returned no data")
        set_custom_snapshot(snapshot)
    mismatches = check_rates()
    if mismatches:
        raise SystemExit("\n".join(mismatches))
    print("Reviewed OpenAI and TypeSafe rates match the provider catalogue.")
