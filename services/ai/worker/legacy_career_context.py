"""Read task envelopes queued before the career-context rename without changing source text.

Rails migrates persisted snapshots, but already-published SQS bodies keep the old keys.
Normalize only structural identifiers at this boundary; all domain code uses the new names.
"""

from typing import Any

_KEYS = {"facts": "career_contexts", "library_facts": "career_contexts", "library_fact": "career_context"}
_VALUES = {
    "section": {"facts": "career_contexts"},
    "kind": {"fact": "career_context", "library_fact": "career_context"},
    "type": {"library_facts": "career_contexts"},
    "source_type": {"LibraryFact": "CareerContext"},
    "record_type": {"LibraryFact": "CareerContext", "library_fact": "career_context"},
}


def normalize_legacy_career_context(value: Any) -> Any:
    """Copy structured snapshots, keeping prose, UUIDs, revisions and digests exact."""
    if isinstance(value, list):
        return [normalize_legacy_career_context(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        canonical_key = _KEYS.get(key, key)
        # Prefer a canonical field if both spellings are present in a transitional envelope.
        if canonical_key != key and canonical_key in value:
            continue
        result[canonical_key] = (_VALUES.get(key, {}).get(item, item) if isinstance(item, str)
                                 else normalize_legacy_career_context(item))
    return result
