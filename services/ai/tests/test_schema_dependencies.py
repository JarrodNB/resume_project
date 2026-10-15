"""Keep shared data contracts independent of runtime orchestration and infrastructure."""

import ast
from pathlib import Path

import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_ROOT = SERVICE_ROOT / "schemas"
FIRST_PARTY_MODULES = {
    path.stem
    for path in SERVICE_ROOT.iterdir()
    if (path.is_dir() or path.suffix == ".py") and not path.name.startswith(".")
} - {"schemas"}


@pytest.mark.parametrize("source_path", sorted(SCHEMA_ROOT.rglob("*.py")), ids=lambda p: p.name)
def test_schemas_do_not_import_runtime_modules(source_path: Path) -> None:
    """Report forbidden static imports without importing the schema or running its code."""
    violations = []
    for node in ast.walk(ast.parse(source_path.read_text(), filename=str(source_path))):
        if isinstance(node, ast.Import):
            modules = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                package_depth = len(source_path.relative_to(SCHEMA_ROOT).parts)
                if node.level > package_depth:
                    violations.append(f"line {node.lineno}: relative import leaves schemas")
                continue
            modules = [node.module or ""]
        else:
            continue
        for module in modules:
            if module.split(".")[0] in FIRST_PARTY_MODULES:
                violations.append(f"line {node.lineno}: {module}")
    assert not violations, f"{source_path.relative_to(SERVICE_ROOT)}: " + "; ".join(violations)
