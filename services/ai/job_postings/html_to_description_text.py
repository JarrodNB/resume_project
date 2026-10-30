"""Turn job HTML into readable paragraphs and bullet lines for saved descriptions.

Keep spaces between blocks inside a bullet and between table cells without
changing inline punctuation. Remove scripts, styles and explicitly hidden content
before the selected description reaches a parser or saved plain-text field.
"""

import re

from bs4 import BeautifulSoup

BLOCK_TAGS = [
    "p", "div", "section", "article", "blockquote", "table", "tr",
    "h1", "h2", "h3", "h4", "h5", "h6",
]  # fmt: skip
SPACES = re.compile(r"[^\S\n]+")


def html_to_description_text(description_html: str) -> str:
    """Keeps the text and its structure; drops all markup."""
    soup = BeautifulSoup(description_html, "html.parser")
    for hidden in soup.select("script, style, template, noscript, [hidden], [aria-hidden='true']"):
        hidden.decompose()
    for line_break in soup.find_all("br"):
        line_break.replace_with("\n")
    for item_list in soup.find_all(["ul", "ol"]):
        item_list.insert_before("\n")
        item_list.insert_after("\n")
    for item in soup.find_all("li"):
        item.insert(0, "- ")
        item.append("\n")
    for cell in soup.find_all(["td", "th"]):
        cell.insert_before(" ")
        cell.insert_after(" ")
    for block in soup.find_all(BLOCK_TAGS):
        separator = " " if block.find_parent("li") is not None else "\n\n"
        block.insert_before(separator)
        block.insert_after(separator)
    return _tidy_lines(soup.get_text())


def _tidy_lines(text: str) -> str:
    """Collapses spaces, trims lines, and keeps at most one blank line in a row."""
    lines: list[str] = []
    for raw_line in text.split("\n"):
        line = SPACES.sub(" ", raw_line).strip()
        if line in ("", "-"):
            if lines and lines[-1] != "":
                lines.append("")
            continue
        if lines and lines[-1].startswith("- ") and not line.startswith("- "):
            lines.append("")
        lines.append(line)
    return "\n".join(lines).strip()
