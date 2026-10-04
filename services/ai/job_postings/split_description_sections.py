"""
Description: Splits a job description's HTML into requirement and nice-to-have bullets using the
posting's own headings ("Requirements", "Nice to have", ...). Deterministic; no LLM.
Index:
    - DescriptionSections: bullets under requirement headings, nice-to-have headings, and all bullets
    - classify_heading: "requirements", "nice_to_haves", or "other" for a heading's text
    - split_description_sections: walks the HTML in order and files each bullet under its heading
"""

import re
from dataclasses import dataclass, field
from typing import Literal

from bs4 import BeautifulSoup, Tag

HeadingKind = Literal["requirements", "nice_to_haves", "other"]

# Checked first, so "Preferred qualifications" is a nice-to-have, not a requirement.
NICE_TO_HAVE_HEADING = re.compile(
    r"\b(nice[\s-]to[\s-]haves?|bonus|preferred|pluses|plus|extra credit|desirable|ideally"
    r"|stand out|would be great|added advantage)\b"
)
REQUIREMENT_HEADING = re.compile(
    r"\b(requirements?|qualifications?|what you('ll| will)? bring|you bring|you have|about you"
    r"|who you are|must[\s-]haves?|look(ing)? for|you('ll| will)? need|you should have"
    r"|skills|experience|expertise|essential|competenc(y|ies)|ideal candidate|what it takes"
    r"|what we expect|your background|your profile|is this you)\b"
)
HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
BLOCK_HEADING_CANDIDATES = {"p", "div"}
NESTED_BLOCK_TAGS = ["p", "div", "ul", "ol", "li", "table", *HEADING_TAGS]
MAX_HEADING_LENGTH = 80
WHITESPACE = re.compile(r"\s+")


@dataclass
class DescriptionSections:
    """Bullets found in a description, in document order."""

    requirements: list[str] = field(default_factory=list)
    nice_to_haves: list[str] = field(default_factory=list)
    all_bullets: list[str] = field(default_factory=list)


def classify_heading(heading_text: str) -> HeadingKind:
    """Matches a heading against known requirement and nice-to-have wordings."""
    text = _clean(heading_text).lower().replace("’", "'")
    if NICE_TO_HAVE_HEADING.search(text):
        return "nice_to_haves"
    if REQUIREMENT_HEADING.search(text):
        return "requirements"
    return "other"


def split_description_sections(description_html: str) -> DescriptionSections:
    """Each <li> belongs to the nearest heading above it. Headings are <h1>-<h6>, a paragraph
    that is entirely bold, or a short paragraph ending in a colon."""
    sections = DescriptionSections()
    current_kind: HeadingKind = "other"
    soup = BeautifulSoup(description_html, "html.parser")
    for element in soup.find_all(True):
        heading_text = _heading_text(element)
        if heading_text is not None:
            current_kind = classify_heading(heading_text)
        elif element.name == "li" and (bullet := _list_item_text(element)):
            sections.all_bullets.append(bullet)
            if current_kind == "requirements":
                sections.requirements.append(bullet)
            elif current_kind == "nice_to_haves":
                sections.nice_to_haves.append(bullet)
    return sections


def _heading_text(element: Tag) -> str | None:
    """The element's text if it looks like a section heading, else None."""
    if element.find_parent("li") is not None:
        return None
    text = _clean(element.get_text(" "))
    if not text or len(text) > MAX_HEADING_LENGTH:
        return None
    if element.name in HEADING_TAGS:
        return text
    if element.name not in BLOCK_HEADING_CANDIDATES or element.find(NESTED_BLOCK_TAGS):
        return None
    bold_text = _clean(" ".join(bold.get_text(" ") for bold in element.find_all(["strong", "b"])))
    if bold_text and bold_text.rstrip(":") == text.rstrip(":"):
        return text
    return text if text.endswith(":") else None


def _list_item_text(item: Tag) -> str:
    """The item's own text, without the text of lists nested inside it."""
    own_list = item.find_parent(["ul", "ol"])
    parts = [
        text for text in item.find_all(string=True) if text.find_parent(["ul", "ol"]) is own_list
    ]
    return _clean("".join(parts))


def _clean(text: str) -> str:
    """Collapses whitespace (including non-breaking spaces) and trims."""
    return WHITESPACE.sub(" ", text).strip()
