"""Turn LinkedIn description lines into paragraphs for heading extraction.

Split line breaks inside nested inline formatting while retaining the wrappers
and their attributes. Existing lists and block elements stay intact.
"""

from bs4 import BeautifulSoup, NavigableString, Tag

BLOCK_TAGS = {"p", "div", "ul", "ol", "table", "blockquote", "pre"} | {f"h{n}" for n in range(1, 7)}


def linkedin_description_to_html(markup_html: str) -> str:
    """Lists and other blocks are kept as they are; inline runs between <br>s become <p>s."""
    source = BeautifulSoup(markup_html, "html.parser")
    output = BeautifulSoup("", "html.parser")
    line = output.new_tag("p")

    def end_line() -> None:
        """Keeps the current line as a paragraph if it has text, then starts a new one."""
        nonlocal line
        if line.get_text(strip=True):
            output.append(line)
        line = output.new_tag("p")

    for child in list(source.children):
        if isinstance(child, Tag) and child.name in BLOCK_TAGS:
            end_line()
            output.append(child.extract())
        elif isinstance(child, Tag) and child.name == "br":
            end_line()
        elif isinstance(child, Tag) and child.find("br"):
            for piece in _split_at_line_breaks(child, output):
                if piece is None:
                    end_line()
                elif piece.get_text(strip=True):
                    line.append(piece)
        elif isinstance(child, (Tag, NavigableString)):
            line.append(child.extract())
    end_line()
    return output.decode()


def _split_at_line_breaks(tag: Tag, output: BeautifulSoup) -> list[Tag | None]:
    """Split inline wrappers recursively, using None to mark each line break."""
    pieces: list[Tag | None] = []
    current = output.new_tag(tag.name, attrs=dict(tag.attrs))
    for child in list(tag.children):
        if isinstance(child, Tag) and child.name == "br":
            pieces.extend([current, None])
            current = output.new_tag(tag.name, attrs=dict(tag.attrs))
        elif isinstance(child, Tag) and child.name not in BLOCK_TAGS and child.find("br"):
            for piece in _split_at_line_breaks(child, output):
                if piece is None:
                    pieces.extend([current, None])
                    current = output.new_tag(tag.name, attrs=dict(tag.attrs))
                else:
                    current.append(piece)
        else:
            current.append(child.extract())
    pieces.append(current)
    return pieces
