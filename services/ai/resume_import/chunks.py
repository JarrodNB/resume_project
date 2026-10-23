"""Keep whole recognizable resume sections together and coalesce adjacent sections.

Unknown layouts stay intact. Chunk IDs refer to the original document registry;
we never split a role, wrapped bullet, or uncertain section just to meet a size target.
"""

from itertools import pairwise
from math import ceil

from resume_import.source import _SECTION, ResumeSource


def structural_chunks(text: str, source: ResumeSource) -> list[tuple[str, set[str], int]]:
    """Return complete adjacent sections with their globally owned passage IDs.

    Two sections share a call to leave room for validation retries under the normal
    six-request budget. At most three chunks are produced, regardless of length.
    """
    lines = text.splitlines()
    boundaries = [0]
    passage_starts = {
        passage.start_line for passage in source.passages.values() if not passage.bullet
    }
    headings = set()
    for index, line in enumerate(lines):
        heading = line.strip().casefold().rstrip(":")
        if heading in headings:
            continue
        if _SECTION.fullmatch(line.strip()):
            headings.add(heading)
        if (
            index
            and index in passage_starts
            and any(item.strip() for item in lines[boundaries[-1] : index])
            and _SECTION.fullmatch(line.strip())
        ):
            boundaries.append(index)
    boundaries.append(len(lines))
    sections = list(pairwise(boundaries))
    width = max(2, ceil(len(sections) / 3))
    chunks = []
    for offset in range(0, len(sections), width):
        start = sections[offset][0]
        end = sections[min(offset + width, len(sections)) - 1][1]
        owned = {
            key for key, passage in source.passages.items() if start <= passage.start_line < end
        }
        chunks.append(("\n".join(lines[start:end]), owned, start))
    return chunks
