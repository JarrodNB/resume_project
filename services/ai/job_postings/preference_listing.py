"""Render the same bounded preference passages as Rails' catalogue projection.

This is an ephemeral read projection. UTF-8 truncation, paragraph labels and
fingerprints must match PreferenceListingSnapshot before a queued check can run.
"""
import hashlib
import json
import re

import regex
from bs4 import BeautifulSoup

from job_postings.split_description_sections import classify_heading

BLOCKS = ["p", "div", "section", "article", "blockquote", "table", "tr", "h1", "h2", "h3", "h4", "h5", "h6"]
ABBREVIATIONS = {"e.g", "i.e", "etc", "vs", "ex", "inc", "ltd", "co", "corp", "dr", "mr", "mrs", "ms", "jr", "sr", "st", "no", "approx", "dept"}


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def _clean(text):
    return re.sub(r"\s+", " ", text).strip()


def _sentences(text):
    result = [""]
    for piece in re.split(r"(?<=[.!?])\s+", text):
        result[-1] += (" " if result[-1] else "") + piece
        word = piece.split()[-1].lower().removesuffix(".") if piece.split() else ""
        if re.search(r"[.!?]$", piece) and word.replace("(", "") not in ABBREVIATIONS and not re.fullmatch(r"\(?([a-z]\.)*[a-z]", word):
            result.append("")
    return [part.strip() for part in result if part.strip()]


def _format(line):
    if line.startswith("- "):
        return [line]
    match = regex.match(r"^([A-Z][^:,.!?;\d]{0,58}):\s+([^\s\p{Ll}].*)$", line)
    if not match:
        return [line]
    label, body = match.groups()
    if len(label.split()) > 6 or label.count("(") != label.count(")"):
        return [line]
    items = _sentences(body)
    if len(items) < 3:
        clauses = re.split(r";\s+", body)
        if len(clauses) >= 3:
            items = [item for clause in clauses for item in _sentences(clause)]
    if classify_heading(label) != "other" and len(items) >= 3:
        return [label + ":", *["- " + item for item in items]]
    return [label + ":", body] if len(body) > 200 else [line]


def description_text(html):
    # Match the established Rails projection, including its treatment of hidden markup.
    soup = BeautifulSoup(html, "html.parser")
    for node in soup.select("script, style"):
        node.decompose()
    for node in soup.find_all("br"):
        node.replace_with("\n")
    for node in soup.find_all(["ul", "ol"]):
        node.insert_before("\n")
        node.insert_after("\n")
    for node in soup.find_all("li"):
        node.insert(0, "- ")
        node.append("\n")
    for node in soup.find_all(BLOCKS):
        separator = " " if node.find_parent("li") else "\n\n"
        node.insert_before(separator)
        node.insert_after(separator)
    lines = []
    for raw in soup.get_text().split("\n"):
        line = _clean(raw)
        if line in ("", "-"):
            if lines and lines[-1] != "":
                lines.append("")
        else:
            formatted = _format(line)
            if lines and lines[-1].startswith("- ") and not formatted[0].startswith("- "):
                lines.append("")
            lines.extend(formatted)
    return "\n".join(lines).strip()


def listing_source(listing_id, payload, count):
    company = payload.get("company")
    remote = payload.get("has_remote")
    option = ("Provider lists a remote option; location restrictions or office days may apply." if remote is True
              else "Provider lists no remote option." if remote is False else None)
    values = [("Job", payload.get("title")), ("Company", company.get("name") if isinstance(company, dict) else None),
              ("Location", payload.get("location")), ("Remote arrangement", payload.get("remote_type")),
              ("Remote option", option), ("Employment", payload.get("employment_type")),
              ("Salary", payload.get("salary_text")), ("Salary currency", payload.get("salary_currency")),
              ("Description", description_text(str(payload.get("description") or "")))]
    text = "\n".join(f"{label}: {value}" for label, value in values if isinstance(value, str) and value.strip())
    budget = min(8000, 100000 // count)
    # Rails truncate_bytes stops at a grapheme boundary, rather than splitting combining marks.
    excerpt = ""
    used = 0
    for cluster in regex.findall(r"\X", text):
        if used + len(cluster.encode()) > budget:
            break
        excerpt += cluster
        used += len(cluster.encode())
    pieces = [line[start:start + 500] for line in excerpt.split("\n") if line.strip() for start in range(0, len(line), 500)]
    limit = min(64, max(budget // 80, 1))
    return {"id": listing_id, "source_digest": hashlib.sha256(text.encode()).hexdigest(),
            "truncated": excerpt != text or len(pieces) > limit,
            "passages": [{"id": f"P{index + 1}", "text": piece} for index, piece in enumerate(pieces[:limit])]}
