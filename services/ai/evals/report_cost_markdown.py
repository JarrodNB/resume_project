"""
Description: Renders conservative USD cost summaries and aligned model comparisons.
Index:
    - cost_label: distinguishes an estimated total from an incomplete known subtotal
    - render_costs: per-model usage and estimate coverage for one report run
    - render_cost_comparison: aligned whole-run and case cost estimates
"""

from evals.report_costs import ReportCosts


def cost_label(summary):
    """Labels missing usage and partial estimates without presenting unknown calls as free."""
    if not summary["calls"]:
        return "Unavailable (no provider usage captured)"
    amount = f"${summary['known_cost_microdollars'] / 1_000_000:.6f}"
    return (f"Estimated USD {amount}" if summary["complete"]
            else f"Known USD subtotal {amount}; incomplete")


def _cell(value):
    """Escapes model names and native case labels in table cells."""
    return str(value).replace("|", "\\|").replace("\n", "<br>")


def render_costs(costs):
    """Includes auxiliary calls, cached input and explicit unknown-price/usage issues."""
    summary = costs.summary()
    lines = ["Estimated provider cost:", "", cost_label(summary), "",
             "| Provider model | Calls | Input tokens | Cached input tokens | Output tokens | Known USD | Unknown calls |",
             "| --- | --- | --- | --- | --- | --- | --- |"]
    for row in summary["models"]:
        lines.append(f"| {_cell(row['model'])} | {row['calls']} | {row['input_tokens']} | "
                     f"{row['cached_input_tokens']} | {row['output_tokens']} | "
                     f"${row['known_cost_microdollars'] / 1_000_000:.6f} | {row['unknown_calls']} |")
    if summary["issues"]:
        lines += ["", "Coverage: " + "; ".join(summary["issues"])]
    lines += ["", ("Estimates use the local standard-rate price table, rounded up per request. "
              "Includes captured generation, screening, judge and embedding requests, including retries. "
              "Cached input is included in input tokens. Fake models are excluded. "
              "Missing provider usage or instrumentation makes costs unavailable/incomplete; "
              "these are estimates, not provider invoices."), ""]
    return lines


def render_cost_comparison(runs, names):
    """Aligns whole-run and case totals while retaining known partial estimates."""
    costs = [run.get("costs", ReportCosts()) for run in runs]
    lines = ["## Cost comparison", "",
             "| Scope | " + " | ".join(_cell(run["model"]) for run in runs) + " |",
             "| --- | " + " | ".join("---" for _ in runs) + " |",
             "| Whole run | " + " | ".join(cost_label(cost.summary()) for cost in costs) + " |"]
    for name in names:
        lines.append("| " + _cell(name) + " | "
                     + " | ".join(cost_label(cost.summary(case=name)) for cost in costs) + " |")
    return lines + [""]
