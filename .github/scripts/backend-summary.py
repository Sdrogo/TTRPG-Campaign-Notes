"""Write the Backend job's section of the GitHub job summary, as Markdown on stdout.

Reads pytest's JUnit XML (test counts) and `coverage json` output; run from
backend/. Files with no statements (the empty `__init__.py` packages) are left
out of the per-file table: they are always "100%" and only add noise.
"""

import json
from pathlib import Path
from xml.etree import ElementTree

JUNIT = Path("junit.xml")
COVERAGE = Path("coverage.json")


def pct(value: float) -> str:
    """Format a percentage like Vitest does: at most two decimals, no trailing zeros."""
    return f"{round(value, 2):g}%"


def tests() -> None:
    """Print the pass/fail counts from pytest's JUnit XML."""
    print("### Backend tests\n")
    if not JUNIT.exists():
        print("_No test report produced._\n")
        return
    root = ElementTree.parse(JUNIT).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
    keys = ("tests", "failures", "errors", "skipped")
    count = {k: sum(int(s.get(k, 0)) for s in suites) for k in keys}
    failed = count["failures"] + count["errors"]
    passed = count["tests"] - failed - count["skipped"]
    parts = [f"✅ {passed} passed"]
    if failed:
        parts.insert(0, f"❌ {failed} failed")
    if count["skipped"]:
        parts.append(f"⏭️ {count['skipped']} skipped")
    print(f"**Tests:** {' · '.join(parts)} · {count['tests']} total\n")


def coverage() -> None:
    """Print the coverage totals, then a collapsible per-file table."""
    print("### Backend coverage\n")
    if not COVERAGE.exists():
        print("_No coverage report produced._")
        return
    report = json.loads(COVERAGE.read_text())
    total = report["totals"]
    print("| Metric | Coverage | Covered |")
    print("| --- | ---: | ---: |")
    covered = f"{total['covered_lines']}/{total['num_statements']}"
    print(f"| Statements | {pct(total['percent_covered'])} | {covered} |")

    files = report["files"].items()
    rows = sorted((path, f["summary"]) for path, f in files if f["summary"]["num_statements"])
    # Open by default only when something is below 100%, so the gap is visible.
    gap = any(s["missing_lines"] for _, s in rows)
    summary = f"<summary>Coverage by file ({len(rows)} files)</summary>"
    print(f"\n<details{' open' if gap else ''}>{summary}\n")
    print("| File | Statements | Missed | Coverage |")
    print("| --- | ---: | ---: | ---: |")
    for path, s in rows:
        cover = pct(s["percent_covered"])
        print(f"| `{path}` | {s['num_statements']} | {s['missing_lines']} | {cover} |")
    print("\n</details>")


if __name__ == "__main__":
    tests()
    coverage()
