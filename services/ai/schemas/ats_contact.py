"""Check contact syntax locally before privacy masking; no contact details reach this module's output."""

import re

from schemas.ats_content import ContentCheck, Evidence, _text_values


def contact_usability(sections):
    """Require one plausible email or phone and cite the original saved section."""
    contact = next(
        (
            section
            for section in sections
            if section.get("section_type", section.get("type")) == "contact"
        ),
        None,
    )
    content = (contact or {}).get("content") or {}
    email = str(content.get("email") or "")
    phone = str(content.get("phone") or "")
    usable = bool(
        re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email)
        or len(re.sub(r"\D", "", phone)) >= 7
    )
    source = contact or next(iter(sections), None)
    quote = next(
        iter(
            _text_values(
                {"title": (source or {}).get("title"), "content": (source or {}).get("content")}
            )
        ),
        None,
    )
    evidence = (
        [Evidence(section_id=str(source.get("id", source.get("position"))), excerpt=quote)]
        if quote
        else []
    )
    return ContentCheck(
        key="contact_usability",
        status="pass" if usable else "fail",
        evidence=evidence,
        explanation="A usable contact channel is present."
        if usable
        else "No usable email or phone is present in the contact section.",
        suggested_action="" if usable else "Add a current email address or phone number.",
        severity="info" if usable else "error",
        absence_reason=None if usable or evidence else "The resume has no contact section or text.",
    )
