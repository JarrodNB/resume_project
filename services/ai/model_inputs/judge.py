"""Readable, source-preserving input for the interview quality judge."""

from pydantic_core import to_jsonable_python


def readable(value, indent=0):
    """Render the case data as labeled lines while preserving source wording."""
    value = to_jsonable_python(value)
    if isinstance(value, dict):
        return "\n".join(
            " " * indent + f"{key}:" + (f"\n{readable(item, indent + 2)}"
                                     if isinstance(item, (dict, list)) else
                                     readable(item, indent + 2) if isinstance(item, str) and "\n" in item
                                     else f" {readable(item)}")
            for key, item in value.items()
        )
    if isinstance(value, list):
        return "\n".join(" " * indent + "- " + (
            "\n" + readable(item, indent + 2) if isinstance(item, (dict, list))
            else readable(item)) for item in value)
    if isinstance(value, str) and "\n" in value:
        return "\n" + "\n".join(" " * indent + "| " + line for line in value.split("\n"))
    return str(value)


def format_judge_input(rubrics, inputs, output) -> str:
    return (f"Rubrics:\n{readable(rubrics, 2)}\n\n"
            f"Inputs:\n{readable(inputs, 2)}\n\n"
            f"Output:\n{readable(output, 2)}")
