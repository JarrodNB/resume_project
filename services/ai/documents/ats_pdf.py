"""Inspect exported PDF bytes locally against immutable saved resume sections.

No model receives these files. Comparisons tolerate Unicode ligatures, punctuation,
case and ordinary whitespace wrapping, but preserve word and section order.
"""

import re
import unicodedata
from collections import Counter
from io import BytesIO
from itertools import pairwise

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from text_limits import MAX_PDF_PAGES, MAX_RESUME_TEXT

MONTHS = ("", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def _date(value, exact=False):
    value = _text(value)
    match = re.fullmatch(r"(\d{4})-(\d{2})(?:-(\d{2}))?", value)
    if not match or not 1 <= int(match[2]) <= 12:
        return value
    return (
        f"{MONTHS[int(match[2])]} {int(match[3])}, {match[1]}"
        if exact and match[3]
        else f"{MONTHS[int(match[2])]} {match[1]}"
    )


def expected_chunks(sections):
    """Mirror visible resume-pdf-v1 fields, never client-supplied expected text."""
    chunks = []
    contact = next(
        (s.get("content", {}) for s in sections if s.get("section_type") == "contact"), {}
    )
    chunks.extend(_text(contact.get(key)) for key in ("full_name", "email", "phone", "location"))
    for link in contact.get("links", []) or []:
        if isinstance(link, str):
            chunks.append(link)
        elif (
            isinstance(link, dict)
            and isinstance(link.get("label"), str)
            and isinstance(link.get("url"), str)
        ):
            chunks.append(_text(link.get("label")))
    for section in sections:
        kind, content = section.get("section_type"), section.get("content") or {}
        if kind == "contact":
            continue
        body = []
        items = [i for i in content.get("items", []) if isinstance(i, dict)]
        if kind == "summary":
            body.append(_text(content.get("text")))
        elif kind == "skills":
            groups = {}
            for item in items:
                if name := _text(item.get("name")):
                    groups.setdefault(_text(item.get("category")), []).append(name)
            body.extend(
                (category + ": " if category else "") + ", ".join(names)
                for category, names in groups.items()
            )
        else:
            for item in items:
                if kind == "experience":
                    heading = _text(item.get("title")) or _text(item.get("company"))
                    meta = [
                        _text(item.get("company")) if _text(item.get("title")) else "",
                        _text(item.get("location")),
                    ]
                elif kind == "projects":
                    heading = _text(item.get("name"))
                    meta = [_text(item.get(key)) for key in ("role", "url")]
                elif kind == "education":
                    heading = _text(item.get("institution"))
                    meta = [_text(item.get(key)) for key in ("degree", "field_of_study")]
                elif kind == "certifications":
                    heading = _text(item.get("name"))
                    meta = [
                        _text(item.get(key))
                        for key in ("issuer", "credential_id", "credential_url")
                    ]
                else:
                    continue
                if kind == "certifications":
                    dates = [
                        (label + " " + _date(item.get(key), exact=True))
                        for key, label in (("issued_date", "Issued"), ("expiry_date", "Expires"))
                        if _text(item.get(key))
                    ]
                else:
                    dates = [_date(item.get("start_date")), _date(item.get("end_date"))]
                    if (
                        kind == "experience"
                        and item.get("is_current")
                        and dates[0]
                        and not dates[1]
                    ):
                        dates[1] = "Present"
                bullets = (
                    [_text(v) for v in item.get("highlights", []) if isinstance(v, str)]
                    if kind == "experience"
                    else []
                )
                entry = [heading, *dates, *meta, _text(item.get("description")), *bullets]
                if any(entry):
                    fallback = {
                        "experience": "Role",
                        "projects": "Project",
                        "education": "Education",
                        "certifications": "Certification",
                    }[kind]
                    body.extend([heading or fallback, *entry[1:]])
        body = [value for value in body if value]
        if body:
            chunks.extend([_text(section.get("title")), *body])
    return [chunk for chunk in chunks if chunk]


def _tokens(text):
    text = unicodedata.normalize("NFKC", text).casefold().replace("\u00ad", "")
    # A line-end hyphen can be a renderer wrap, so it is joined before tokenization.
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", text)
    return re.findall(r"[^\W_]+", text, flags=re.UNICODE)


def _coverage(expected, actual):
    return sum((Counter(expected) & Counter(actual)).values()) / len(expected) if expected else 1.0


def _extract_page(page, number):
    fragments = []

    def remember(text, cm, tm, font, size):
        if text.strip():
            x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
            y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
            fragments.append(
                {
                    "page": number,
                    "excerpt": text.strip()[:240],
                    "x": round(x, 2),
                    "y": round(y, 2),
                    "font_size": size,
                }
            )

    return page.extract_text(visitor_text=remember) or "", fragments


def inspect_pdf(file_bytes, sections):
    """Return checks with ratios and page/excerpt evidence; unreadable files raise ValueError."""
    if len(file_bytes) > 5 * 1024 * 1024 or not file_bytes.startswith(b"%PDF-"):
        raise ValueError("Export must be a PDF no larger than 5 MB.")
    try:
        reader = PdfReader(BytesIO(file_bytes), strict=True)
        if reader.is_encrypted or not 0 < len(reader.pages) <= MAX_PDF_PAGES:
            raise ValueError("PDF is encrypted, empty or has too many pages.")
        extracted = [_extract_page(page, index + 1) for index, page in enumerate(reader.pages)]
        pages = [text for text, fragments in extracted]
    except (PdfReadError, KeyError, TypeError, IndexError, NotImplementedError) as error:
        raise ValueError("PDF could not be inspected. Export again to retry.") from error
    actual = "\n".join(pages)
    if not actual.strip() or len(actual) > MAX_RESUME_TEXT:
        raise ValueError("PDF has no usable text layer or exceeds the text limit.")
    chunks = expected_chunks(sections)
    expected_tokens = _tokens("\n".join(chunks))
    if not expected_tokens:
        raise ValueError("Saved resume has no exportable content.")
    actual_tokens = _tokens(actual)
    joined = " " + " ".join(actual_tokens) + " "
    positions = []
    missing = []
    occurrences = {}
    found = 0
    for chunk in chunks:
        needle = " " + " ".join(_tokens(chunk)) + " "
        # Prefer a later occurrence: a year such as 2022 can also appear in
        # an earlier role or project. Fall back to an earlier occurrence only
        # when none follows, so genuinely reversed chunks still reduce order.
        used_start = occurrences.get(needle, 0)
        forward_start = max(used_start, positions[-1] + 1 if positions else 0)
        pos = joined.find(needle, forward_start)
        if pos < 0:
            pos = joined.find(needle, used_start)
        if pos >= 0:
            occurrences[needle] = pos + len(needle) - 1
        if pos >= 0:
            found += 1
            positions.append(pos)
        else:
            missing.append(chunk)
    # Adjacent matching chunks must retain their source order, including section/entry boundaries.
    order = (
        sum(left <= right for left, right in pairwise(positions)) / (len(positions) - 1)
        if len(positions) > 1
        else 1.0
    )
    fragments = [fragment for text, items in extracted for fragment in items]
    physical_pairs = [
        (left, right) for left, right in pairwise(fragments) if left["page"] == right["page"]
    ]
    reversed_pairs = [
        (left, right)
        for left, right in physical_pairs
        if right["y"] > left["y"] + max(left["font_size"], right["font_size"]) * 1.5
    ]
    physical_order = 1 - len(reversed_pairs) / len(physical_pairs) if physical_pairs else 1.0
    order = min(order, physical_order)
    chars_expected = list("".join(expected_tokens))
    chars_actual = list("".join(actual_tokens))
    ratios = {
        "text_extraction": 1.0,
        "coverage": _coverage(expected_tokens, actual_tokens),
        "reading_order": order,
        "characters": _coverage(chars_expected, chars_actual),
        "boundaries": found / len(chunks),
    }
    evidence = []
    for page_index, text in enumerate(pages):
        if text.strip():
            first = next(
                (fragment for fragment in fragments if fragment["page"] == page_index + 1), None
            )
            evidence.append(first or {"page": page_index + 1, "excerpt": text.strip()[:240]})
    evidence = evidence[:3]
    checks = []
    for key, ratio in ratios.items():
        check_evidence = evidence
        if key == "reading_order" and reversed_pairs:
            check_evidence = [fragment for pair in reversed_pairs[:2] for fragment in pair]
        elif ratio < 0.98 and missing:
            # Point to a nearby extracted page and name the absent saved text explicitly.
            target = Counter(_tokens(missing[0]))
            best_page = max(
                range(len(pages)), key=lambda i: sum((target & Counter(_tokens(pages[i]))).values())
            )
            nearby = next(
                (fragment for fragment in fragments if fragment["page"] == best_page + 1), None
            )
            if nearby:
                check_evidence = [nearby]
        checks.append(
            {
                "key": key,
                "ratio": round(ratio, 6),
                "evidence": check_evidence,
                "absence_reason": (
                    "Expected saved text was not recovered: " + "; ".join(missing[:3])[:600]
                )
                if ratio < 0.98 and missing
                else None,
                "explanation": f"{key.replace(chr(95), chr(32)).capitalize()}: {ratio:.1%} of the saved export structure was retained.",
                "suggested_action": ""
                if ratio >= 0.98
                else "Review the exported PDF and its extracted reading order; simplify the affected formatting and export again.",
                "severity": "info" if ratio >= 0.98 else "warning" if ratio >= 0.9 else "error",
            }
        )
    return {"checks": checks, "page_count": len(pages)}
