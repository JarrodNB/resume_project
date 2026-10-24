"""Render untrusted text for safety classification; decisions remain with screening."""


def format_fallback_input(text: str) -> str:
    quoted = "\n".join(f"| {line}" for line in text.split("\n"))
    return f"<user_text>\n{quoted}\n</user_text>"
