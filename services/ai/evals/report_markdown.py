"""
Description: Renders native eval reports as readable Markdown with aligned comparisons.
Index:
    - render_report: configuration, aggregates, aligned scores and full case details
    - report_errors: counts task and evaluator failures without treating scores as gates
"""

import dataclasses
import json
from html import escape

from pydantic import BaseModel


def _json_default(value):
    """Serializes structured agent outputs and native report dataclasses faithfully."""
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if dataclasses.is_dataclass(value):
        return dataclasses.asdict(value)
    return str(value)


def _json(value):
    """Formats structured data as literal JSON without terminal markup."""
    return json.dumps(value, default=_json_default, ensure_ascii=False, indent=2)


def _cell(value):
    """Escapes text for a Markdown table cell."""
    return str(value).replace("|", "\\|").replace("\n", "<br>")


def report_errors(report):
    """Counts failures even when no successful case remains to aggregate."""
    if report is None:
        return 1
    return (len(report.failures) + len(report.report_evaluator_failures)
            + sum(len(case.evaluator_failures) for case in report.cases))


def _scores(case):
    """Shows score values and failed assertions for a comparison cell."""
    values = {name: result.value for name, result in case.scores.items()}
    values.update({name: result.value for name, result in case.assertions.items()})
    return "; ".join(f"{key}={value}" for key, value in values.items()) or "No scores"


def _detail_cell(case):
    """Keeps outputs, reasons and failures readable in aligned comparison columns."""
    if case is None:
        return "Missing case"
    if hasattr(case, "error_message"):
        detail = {"failure": case.error_message, "stacktrace": case.error_stacktrace}
    else:
        detail = {"output": case.output, "scores": case.scores,
                  "assertions": case.assertions, "labels": case.labels,
                  "evaluator_failures": case.evaluator_failures,
                  "task_duration": case.task_duration, "total_duration": case.total_duration}
    return "<pre>" + escape(_json(detail)).replace("|", "&#124;").replace("\n", "<br>") + "</pre>"


def render_report(suite, runs, created):
    """Renders one or two runs, aligning cases by name including failed cases."""
    lines = [f"# {suite} evaluation", "", f"Created: {created}", ""]
    for index, run in enumerate(runs, 1):
        report = run["report"]
        lines += [f"## Run {index}: {run['model']}", "", "Configuration:", "",
                  "```json", _json(run["configuration"]), "```", ""]
        if run["error"]:
            lines += ["Run error:", "", "```text", run["error"], "```", ""]
        if report is None:
            continue
        average = report.averages()
        lines += [f"Task/evaluator failures: {report_errors(report)}", "",
                  "Aggregate scores:", "", "```json",
                  _json(average), "```", ""]
    lines += ["## Case comparison", "",
              "| Case | " + " | ".join(_cell(run["model"]) for run in runs) + " |",
              "| --- | " + " | ".join("---" for _ in runs) + " |"]
    mappings = []
    for run in runs:
        report = run["report"]
        mappings.append({case.name: case for case in report.cases + report.failures}
                        if report else {})
    names = dict.fromkeys(name for mapping in mappings for name in mapping)
    for name in names:
        cells = []
        for mapping in mappings:
            case = mapping.get(name)
            if case is None:
                cells.append("Missing case")
            elif hasattr(case, "error_message"):
                cells.append("FAILED: " + case.error_message)
            else:
                cells.append(_scores(case) + f"; duration={case.total_duration:.3f}s")
        lines.append("| " + _cell(name) + " | " + " | ".join(map(_cell, cells)) + " |")
    lines += ["", "## Aligned outputs and evaluator reasons", "",
              "| Case | " + " | ".join(_cell(run["model"]) for run in runs) + " |",
              "| --- | " + " | ".join("---" for _ in runs) + " |"]
    for name in names:
        lines.append("| " + _cell(name) + " | "
                     + " | ".join(_detail_cell(mapping.get(name)) for mapping in mappings) + " |")
    for index, run in enumerate(runs, 1):
        report = run["report"]
        lines += ["", f"## Run {index} details", ""]
        if report is None:
            continue
        for case in report.cases + report.failures:
            lines += [f"### {_cell(case.name)}", "", "```json", _json(case), "```", ""]
        if report.report_evaluator_failures:
            lines += ["### Report evaluator failures", "", "```json",
                      _json(report.report_evaluator_failures), "```", ""]
    return "\n".join(lines)
