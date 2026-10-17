"""2023 state-to-state rail travel shares from the EAC-PM migration study.

Debroy & Misra, "400 Million Dreams! Examining volume and directions of domestic
migration in India using novel high frequency data", Economic Advisory Council to the
Prime Minister, December 2024. Table 7 gives, for unreserved (UTS) second-class
non-suburban passengers in 2023, the percentage departing each state that were
destined to each other state.

These are shares of train trips, not counts of people, and the app labels them so.
"""

from __future__ import annotations

import re
import urllib.request
from pathlib import Path

URL = (
    "https://eacpm.gov.in/wp-content/uploads/2024/12/"
    "FINAL-Internal-Migration-Project.docx-Publication-Version.pdf"
)
TABLE_7_PAGE = 24  # zero-based page index of Table 7 in the published PDF
CITATION = (
    "EAC-PM, 400 Million Dreams (Debroy & Misra, 2024), Table 7: unreserved second-class "
    "non-suburban rail passengers, 2023"
)

# Table 7 uses two-letter codes; names match the app's current state names.
STATES = {
    "AP": "Andhra Pradesh",
    "AR": "Arunachal Pradesh",
    "AS": "Assam",
    "BH": "Bihar",
    "CH": "Chandigarh",
    "CG": "Chhattisgarh",
    "DL": "NCT of Delhi",
    "GA": "Goa",
    "GJ": "Gujarat",
    "HR": "Haryana",
    "HP": "Himachal Pradesh",
    "JK": "Jammu & Kashmir",
    "JH": "Jharkhand",
    "KN": "Karnataka",
    "KL": "Kerala",
    "MP": "Madhya Pradesh",
    "MH": "Maharashtra",
    "NL": "Nagaland",
    "OD": "Odisha",
    "PY": "Puducherry",
    "PB": "Punjab",
    "RJ": "Rajasthan",
    "TN": "Tamil Nadu",
    "TG": "Telangana",
    "TR": "Tripura",
    "UP": "Uttar Pradesh",
    "UK": "Uttarakhand",
    "WB": "West Bengal",
}


def fetch(target: Path) -> Path:
    if not target.exists():
        request = urllib.request.Request(URL, headers={"User-Agent": "ghar-wapsi-pipeline/0.1"})
        with urllib.request.urlopen(request, timeout=120) as response:
            target.write_bytes(response.read())
    return target


def parse(pdf_path: Path) -> dict:
    import pdfplumber

    with pdfplumber.open(pdf_path) as pdf:
        rows = pdf.pages[TABLE_7_PAGE].find_tables()[0].extract()
    columns = [c for c in rows[0][1:] if c and c.strip() in STATES]
    shares: dict[str, dict[str, float]] = {}
    label = None
    for row in rows[1:]:
        if row[0] and row[0].strip():
            label = row[0].strip()
            continue
        values = [c.strip() for c in row[1:] if c and re.fullmatch(r"\d+\.\d+", c.strip())]
        if label in STATES and len(values) == len(columns):
            shares[STATES[label]] = {
                STATES[col]: float(v) for col, v in zip(columns, values, strict=True)
            }
            label = None

    # Each origin row is a percentage split, so it must add up to 100.
    assert len(shares) == len(STATES), f"parsed {len(shares)} of {len(STATES)} origin states"
    for origin, row in shares.items():
        assert abs(sum(row.values()) - 100) < 0.1, f"{origin} row sums to {sum(row.values())}"
    return {"source": CITATION, "url": URL, "year": 2023, "shares": shares}
