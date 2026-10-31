"""Render the same bounded preference passages as Rails' catalogue projection.

This is an ephemeral read projection. UTF-8 truncation, paragraph labels and
fingerprints must match PreferenceListingSources before a queued check can run.
"""
import hashlib
import json
import re
from html.entities import name2codepoint

import regex
from bs4 import BeautifulSoup, NavigableString

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
    label = label.strip()
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


def _decode_html4_entities(text):
    """Match Nokogiri's established HTML4 entity decoding, without HTML5 aliases.

    Named entities require their semicolon. Numeric references keep their actual
    Unicode code point; invalid values disappear instead of becoming replacements
    or Windows-1252 characters. Decode once, so escaped entities stay escaped.
    """
    def decode(match):
        value = match.group(0)
        if not value.startswith("&#"):
            name = value[1:-1]
            number = 39 if name == "apos" else name2codepoint.get(name)
            return chr(number) if number is not None else value
        number_text = value[2:].removesuffix(";")
        hexadecimal = number_text.startswith(("x", "X"))
        digits = number_text[1:] if hexadecimal else number_text
        digits = digits.lstrip("0")
        if len(digits) > (6 if hexadecimal else 7):
            return ""
        number = int(digits, 16 if hexadecimal else 10) if digits else 0
        if number not in (9, 10, 13) and not (0x20 <= number <= 0xD7FF or 0xE000 <= number <= 0xFFFD or 0x10000 <= number <= 0x10FFFF):
            return ""
        return chr(number)

    return re.sub(r"&#(?:[xX][0-9a-fA-F]*|[0-9]*);?|&[A-Za-z][A-Za-z0-9]*;", decode, text)


def description_text(html):
    # Match the established Rails projection, including its treatment of hidden markup.
    # Newer parsers decode HTML5 aliases that Rails preserves. Shield references
    # during parsing, then apply the established HTML4 rules to text nodes only.
    # Rails treats a raw carriage return as whitespace, not a new paragraph line.
    protected = html.replace("&", "&amp;").replace("\r", "&amp;#13;")
    # Rails' HTML4 parser parses children inside these containers as markup.
    # Newer libxml treats them as RCDATA/raw text. Neutralize only their names;
    # their attributes, children and closing boundaries remain in the input.
    protected = re.sub(
        r"(</?)(textarea|title|xmp|iframe|noembed|noframes|plaintext)(?=[\s/>])",
        lambda match: f"{match[1]}cg-html4-{match[2].lower()}",
        protected, flags=re.IGNORECASE,
    )
    soup = BeautifulSoup(protected, "lxml")
    for node in soup.select("script, style"):
        node.decompose()
    for node in list(soup.find_all(string=True)):
        # Keep comments, doctypes and other non-text node kinds excluded.
        if type(node) is NavigableString:
            node.replace_with(NavigableString(_decode_html4_entities(str(node))))
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
