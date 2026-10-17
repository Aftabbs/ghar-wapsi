"""The README and methods page quote pipeline figures; they must match report.json."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def figures() -> list[str]:
    report = json.loads((ROOT / "pipeline" / "report.json").read_text(encoding="utf-8"))
    trains, check = report["trains"], report["trains"]["crosscheck_vs_2016"]
    return [
        f"{trains['trains_out']:,}",
        f"{trains['trains_found']:,}",
        str(check["compared"]),
        f"{check['share_within_25pct'] * 100:.1f}%",
    ]


def test_methods_page_quotes_current_figures():
    text = (ROOT / "web" / "methods.html").read_text(encoding="utf-8")
    assert all(f in text for f in figures()), figures()


def test_readme_quotes_current_figures():
    text = (ROOT / "README.md").read_text(encoding="utf-8")
    assert all(f in text for f in figures()), figures()
