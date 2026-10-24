"""Render one screened tailoring section without choosing or approving sources."""

from collections.abc import Sequence


def format_tailoring_section_input(
    heading_lines: Sequence[str], approved_values: Sequence[str],
    labels: Sequence[str], has_summary: bool,
) -> str:
    """Keep source labels aligned with the exact values approved by screening."""
    offset = 1
    result = [*heading_lines, approved_values[0]]
    if has_summary:
        result.extend(["", "## How the library matches this job", approved_values[1]])
        offset += 1
    result.extend(["", "# Sources"])
    result.extend(f"[{label}] {value}" for label, value in zip(labels, approved_values[offset:], strict=True))
    return "\n".join(result)
