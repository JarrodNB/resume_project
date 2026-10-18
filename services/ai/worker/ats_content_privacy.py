"""Protect ATS user text before serialization, keeping JSON and run identity intact.

The same task privacy object retains discoveries through screening, generation and
trace completion. Imports keep their existing document preparation behavior.
"""

from copy import deepcopy

from schemas.ats_content import Snapshot


def prepare_ats_snapshot(snapshot: Snapshot, privacy) -> Snapshot:
    """Return a protected copy without sending data to providers or mutating the input."""
    value = snapshot.model_dump(mode="json", exclude={"pdf_result"})
    sources = []
    _mask_fields(value, lambda text: sources.append(text) or text)
    masked_values = iter(privacy.prepare_values(sources, json_mask=_mask_fields))
    return Snapshot.model_validate(_mask_fields(value, lambda _text: next(masked_values)))


def _mask_fields(value, mask):
    """Transform only resume prose and requirement text, never keys or source identity."""
    if not isinstance(value, dict) or not isinstance(value.get("content_snapshot"), list):
        return None
    protected = deepcopy(value)
    for section in protected["content_snapshot"]:
        if isinstance(section.get("title"), str):
            section["title"] = mask(section["title"])
        if "content" in section:
            section["content"] = _mask_values(section["content"], mask)
    for requirement in (protected.get("job_snapshot") or {}).get("requirements", []):
        if isinstance(requirement.get("text"), str):
            requirement["text"] = mask(requirement["text"])
    return protected


def _mask_values(value, mask):
    if isinstance(value, str):
        return mask(value)
    if isinstance(value, dict):
        return {key: _mask_values(item, mask) for key, item in value.items()}
    if isinstance(value, list):
        return [_mask_values(item, mask) for item in value]
    return value
