"""Split job posting bullets by their nearest section heading without an LLM.

Keep each bullet's own text and rendered word boundaries. Nested lists become
separate bullets, while inline formatting keeps its original punctuation.
Comments and script/style content are not rendered job requirements. Nested bold
wrappers count each heading word once.
"""

import re
from dataclasses import dataclass, field
from typing import Literal

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

HeadingKind = Literal["requirements", "responsibilities", "nice_to_haves", "other"]

# Checked first, so "Preferred qualifications" is a nice-to-have, not a requirement.
NICE_TO_HAVE_HEADING = re.compile(
    r"\b(nice[\s-]to[\s-]haves?|bonus|preferred|pluses|plus|extra credit|desirable|ideally"
    r"|stand out|would be great|added advantage)\b"
)
# Checked before requirements, so "What you'll do" is not "what you'll bring".
RESPONSIBILITY_HEADING = re.compile(
    r"\b(responsibilit(?:y|ies)|dut(?:y|ies)|what you(?:'ll| will) (?:do|be doing)"
    r"|day[\s-]to[\s-]day|in this role|the role|your role)\b"
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
    responsibilities: list[str] = field(default_factory=list)
    nice_to_haves: list[str] = field(default_factory=list)
    all_bullets: list[str] = field(default_factory=list)


def classify_heading(heading_text: str) -> HeadingKind:
    """Matches a heading against known requirement, responsibility, and nice-to-have wordings."""
    text = _clean(heading_text).lower().replace("’", "'")
    if NICE_TO_HAVE_HEADING.search(text):
        return "nice_to_haves"
    if RESPONSIBILITY_HEADING.search(text):
        return "responsibilities"
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
            elif current_kind == "responsibilities":
                sections.responsibilities.append(bullet)
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
    bold_text = _clean(" ".join(
        bold.get_text(" ") for bold in element.find_all(["strong", "b"])
        if bold.find_parent(["strong", "b"]) is None
    ))
    if bold_text and bold_text.rstrip(":") == text.rstrip(":"):
        return text
    return text if text.endswith(":") else None


def _list_item_text(item: Tag) -> str:
    """The item's own text, without the text of lists nested inside it."""
    parts: list[str] = []

    def collect_text(element: Tag) -> None:
        """Keep inline runs together and add whitespace at rendered block boundaries."""
        for child in element.children:
            if isinstance(child, Comment):
                continue
            if isinstance(child, NavigableString):
                parts.append(str(child))
            elif isinstance(child, Tag) and child.name not in {"ul", "ol", "script", "style"}:
                is_break = child.name in {"br", "p", "div", "blockquote", *HEADING_TAGS}
                if is_break:
                    parts.append(" ")
                collect_text(child)
                if is_break:
                    parts.append(" ")

    collect_text(item)
    return _clean("".join(parts))


def _clean(text: str) -> str:
    """Collapses whitespace (including non-breaking spaces) and trims."""
    return WHITESPACE.sub(" ", text).strip()
