"""Places people search for: every Census 2011 district under today's name, plus
the big cities that span several districts.

Districts keep their Census 2011 codes (the migration counts are keyed by them),
but are shown under the names and states people use today: Gurugram, not Gurgaon;
Leh in Ladakh, not Jammu & Kashmir. The old names stay searchable as aliases.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from .geo import haversine_km
from .trains import tidy_name

# Cities made of several Census districts; a search for the city covers them all.
CITIES = {
    "delhi": {"name": "Delhi", "districts": [90, 91, 92, 93, 94, 95, 96, 97, 98]},
    "mumbai": {"name": "Mumbai", "districts": [517, 518, 519], "aliases": ["Bombay"]},
    "hyderabad": {"name": "Hyderabad", "districts": [536, 537]},
}

# (Census 2011 name, Census 2011 state) -> (name today, extra aliases).
# The Census name is always kept as an alias too.
RENAMES: dict[tuple[str, str], tuple[str, list[str]]] = {
    ("Bangalore", "Karnataka"): ("Bengaluru", ["Bangalore", "Bengaluru Urban"]),
    ("Bangalore Rural", "Karnataka"): ("Bengaluru Rural", []),
    ("Mysore", "Karnataka"): ("Mysuru", []),
    ("Belgaum", "Karnataka"): ("Belagavi", []),
    ("Bellary", "Karnataka"): ("Ballari", []),
    ("Gulbarga", "Karnataka"): ("Kalaburagi", []),
    ("Shimoga", "Karnataka"): ("Shivamogga", []),
    ("Tumkur", "Karnataka"): ("Tumakuru", []),
    ("Bijapur", "Karnataka"): ("Vijayapura", []),
    ("Chikmagalur", "Karnataka"): ("Chikkamagaluru", []),
    ("Chamrajnagar", "Karnataka"): ("Chamarajanagar", []),
    ("Dakshina Kannada", "Karnataka"): ("Dakshina Kannada", ["Mangaluru", "Mangalore"]),
    ("Allahabad", "Uttar Pradesh"): ("Prayagraj", []),
    ("Faizabad", "Uttar Pradesh"): ("Ayodhya", []),
    ("Kheri", "Uttar Pradesh"): ("Lakhimpur Kheri", []),
    ("Jyotiba Phule Nagar", "Uttar Pradesh"): ("Amroha", []),
    ("Mahamaya Nagar", "Uttar Pradesh"): ("Hathras", []),
    ("Kansiram Nagar", "Uttar Pradesh"): ("Kasganj", []),
    ("Sant Ravi Das Nagar(bhadohi)", "Uttar Pradesh"): ("Bhadohi", []),
    ("Bara Banki", "Uttar Pradesh"): ("Barabanki", []),
    ("Rae Bareli", "Uttar Pradesh"): ("Raebareli", []),
    ("Kanpur Nagar", "Uttar Pradesh"): ("Kanpur Nagar", ["Kanpur"]),
    ("Gautam Buddha Nagar", "Uttar Pradesh"): ("Gautam Buddh Nagar", ["Noida", "Greater Noida"]),
    ("Varanasi", "Uttar Pradesh"): ("Varanasi", ["Banaras", "Benares", "Kashi"]),
    ("Gurgaon", "Haryana"): ("Gurugram", []),
    ("Mewat", "Haryana"): ("Nuh", []),
    ("Ahmadabad", "Gujarat"): ("Ahmedabad", []),
    ("Kachchh", "Gujarat"): ("Kutch", []),
    ("Dohad", "Gujarat"): ("Dahod", []),
    ("Panch Mahals", "Gujarat"): ("Panchmahal", []),
    ("Mahesana", "Gujarat"): ("Mehsana", []),
    ("Banas Kantha", "Gujarat"): ("Banaskantha", []),
    ("Sabar Kantha", "Gujarat"): ("Sabarkantha", []),
    ("Vadodara", "Gujarat"): ("Vadodara", ["Baroda"]),
    ("Haora", "West Bengal"): ("Howrah", []),
    ("Hugli", "West Bengal"): ("Hooghly", []),
    ("Barddhaman", "West Bengal"): ("Bardhaman", ["Burdwan", "Asansol", "Durgapur"]),
    ("Darjiling", "West Bengal"): ("Darjeeling", ["Siliguri"]),
    ("Koch Bihar", "West Bengal"): ("Cooch Behar", []),
    ("Maldah", "West Bengal"): ("Malda", []),
    ("Puruliya", "West Bengal"): ("Purulia", []),
    ("Hardwar", "Uttarakhand"): ("Haridwar", []),
    ("Garhwal", "Uttarakhand"): ("Pauri Garhwal", []),
    ("Bid", "Maharashtra"): ("Beed", []),
    ("Ahmadnagar", "Maharashtra"): ("Ahilyanagar", ["Ahmednagar"]),
    ("Aurangabad", "Maharashtra"): ("Chhatrapati Sambhajinagar", ["Aurangabad"]),
    ("Osmanabad", "Maharashtra"): ("Dharashiv", ["Osmanabad"]),
    ("Gondiya", "Maharashtra"): ("Gondia", []),
    ("Buldana", "Maharashtra"): ("Buldhana", []),
    ("Garhchiroli", "Maharashtra"): ("Gadchiroli", []),
    ("Hoshangabad", "Madhya Pradesh"): ("Narmadapuram", ["Hoshangabad"]),
    ("East Nimar", "Madhya Pradesh"): ("Khandwa", ["East Nimar"]),
    ("West Nimar", "Madhya Pradesh"): ("Khargone", ["West Nimar"]),
    ("Sahibzada Ajit Singh Nagar", "Punjab"): ("Mohali", ["SAS Nagar"]),
    ("Shahid Bhagat Singh Nagar", "Punjab"): ("Nawanshahr", []),
    ("Muktsar", "Punjab"): ("Sri Muktsar Sahib", []),
    ("Ganganagar", "Rajasthan"): ("Sri Ganganagar", []),
    ("Jhunjhunun", "Rajasthan"): ("Jhunjhunu", []),
    ("Chittaurgarh", "Rajasthan"): ("Chittorgarh", []),
    ("Dhaulpur", "Rajasthan"): ("Dholpur", []),
    ("Jalor", "Rajasthan"): ("Jalore", []),
    ("Baleshwar", "Odisha"): ("Balasore", []),
    ("Debagarh", "Odisha"): ("Deogarh", []),
    ("Kendujhar", "Odisha"): ("Keonjhar", []),
    ("Anugul", "Odisha"): ("Angul", []),
    ("Bauda", "Odisha"): ("Boudh", []),
    ("Jajapur", "Odisha"): ("Jajpur", []),
    ("Subarnapur", "Odisha"): ("Sonepur", []),
    ("Nabarangapur", "Odisha"): ("Nabarangpur", []),
    ("Khordha", "Odisha"): ("Khordha", ["Bhubaneswar"]),
    ("Kodarma", "Jharkhand"): ("Koderma", []),
    ("Pashchimi Singhbhum", "Jharkhand"): ("West Singhbhum", ["Chaibasa"]),
    ("Purbi Singhbhum", "Jharkhand"): ("East Singhbhum", ["Jamshedpur", "Tatanagar"]),
    ("Saraikela-kharsawan", "Jharkhand"): ("Seraikela Kharsawan", []),
    ("Pashchim Champaran", "Bihar"): ("West Champaran", ["Bettiah"]),
    ("Purba Champaran", "Bihar"): ("East Champaran", ["Motihari"]),
    ("Kaimur (bhabua)", "Bihar"): ("Kaimur", ["Bhabua"]),
    ("Saran (chhapra)", "Bihar"): ("Saran", ["Chhapra"]),
    ("Kancheepuram", "Tamil Nadu"): ("Kanchipuram", []),
    ("Thiruvallur", "Tamil Nadu"): ("Tiruvallur", []),
    ("Nagappattinam", "Tamil Nadu"): ("Nagapattinam", []),
    ("Virudunagar", "Tamil Nadu"): ("Virudhunagar", []),
    ("Thoothukkudi", "Tamil Nadu"): ("Thoothukudi", ["Tuticorin"]),
    ("Tiruchirappalli", "Tamil Nadu"): ("Tiruchirappalli", ["Trichy"]),
    ("Kanniyakumari", "Tamil Nadu"): ("Kanyakumari", []),
    ("The Nilgiris", "Tamil Nadu"): ("Nilgiris", ["Ooty"]),
    ("Ernakulam", "Kerala"): ("Ernakulam", ["Kochi", "Cochin"]),
    ("Thiruvananthapuram", "Kerala"): ("Thiruvananthapuram", ["Trivandrum"]),
    ("Kozhikode", "Kerala"): ("Kozhikode", ["Calicut"]),
    ("Thrissur", "Kerala"): ("Thrissur", ["Trichur"]),
    ("Dakshin Bastar Dantewada", "Chhattisgarh"): ("Dantewada", []),
    ("Uttar Bastar Kanker", "Chhattisgarh"): ("Kanker", []),
    ("Kabeerdham", "Chhattisgarh"): ("Kabirdham", []),
    ("Janjgir-champa", "Chhattisgarh"): ("Janjgir-Champa", []),
    ("Bastar", "Chhattisgarh"): ("Bastar", ["Jagdalpur"]),
    ("Rangareddy", "Andhra Pradesh"): ("Ranga Reddy", []),
    ("Mahbubnagar", "Andhra Pradesh"): ("Mahabubnagar", []),
    ("Y.s.r.", "Andhra Pradesh"): ("YSR Kadapa", ["Kadapa", "Cuddapah"]),
    ("Sri Potti Sriramulu Nellore", "Andhra Pradesh"): ("Nellore", []),
    ("Visakhapatnam", "Andhra Pradesh"): ("Visakhapatnam", ["Vizag"]),
    ("Krishna", "Andhra Pradesh"): ("Krishna", ["Vijayawada"]),
    ("Chittoor", "Andhra Pradesh"): ("Chittoor", ["Tirupati"]),
    ("Leh (ladakh)", "Jammu & Kashmir"): ("Leh", ["Ladakh"]),
    ("Baramula", "Jammu & Kashmir"): ("Baramulla", []),
    ("Punch", "Jammu & Kashmir"): ("Poonch", []),
    ("Badgam", "Jammu & Kashmir"): ("Budgam", []),
    ("Shupiyan", "Jammu & Kashmir"): ("Shopian", []),
    ("Reasi", "Jammu & Kashmir"): ("Reasi", ["Katra"]),
    ("Marigaon", "Assam"): ("Morigaon", []),
    ("Kamrup Metropolitan", "Assam"): ("Kamrup Metropolitan", ["Guwahati"]),
    ("Lawangtlai", "Mizoram"): ("Lawngtlai", []),
    ("North Goa", "Goa"): ("North Goa", ["Panaji", "Panjim"]),
    ("East", "Sikkim"): ("East", ["Gangtok"]),
    ("South Andaman", "Andaman & Nicobar Island"): ("South Andaman", ["Port Blair"]),
    ("East Khasi Hills", "Meghalaya"): ("East Khasi Hills", ["Shillong"]),
    ("Papum Pare", "Arunachal Pradesh"): ("Papum Pare", ["Itanagar", "Naharlagun"]),
    ("West Tripura", "Tripura"): ("West Tripura", ["Agartala"]),
    ("Imphal West", "Manipur"): ("Imphal West", ["Imphal"]),
    ("Kolkata", "West Bengal"): ("Kolkata", ["Calcutta"]),
    ("Chennai", "Tamil Nadu"): ("Chennai", ["Madras"]),
    ("Puducherry", "Puducherry"): ("Puducherry", ["Pondicherry"]),
    ("Pune", "Maharashtra"): ("Pune", ["Poona"]),
    ("South Goa", "Goa"): ("South Goa", ["Madgaon", "Margao", "Vasco"]),
}

# Districts in a different state or union territory today than in 2011
# (Telangana is found from today's state outlines; Ladakh became a UT in 2019).
STATE_TODAY = {
    ("Leh (ladakh)", "Jammu & Kashmir"): "Ladakh",
    ("Kargil", "Jammu & Kashmir"): "Ladakh",
}

# Census names that are only a compass point within the state: "Central" -> "Central Delhi".
DIRECTIONAL = {
    "Central", "East", "West", "North", "South", "North East", "North West", "South West",
}  # fmt: skip

# Not a district: a Census placeholder for an area it could not survey.
SKIP = {"Data Not Available"}


def spoken_state(state: str) -> str:
    return "Delhi" if state == "NCT of Delhi" else state


def today(name: str, state2011: str, state_now: str) -> tuple[str, str, list[str]]:
    """(name today, state today, aliases) for a Census 2011 district."""
    state_now = STATE_TODAY.get((name, state2011), state_now)
    new, extra = RENAMES.get((name, state2011), (name, []))
    if new in DIRECTIONAL:
        new = f"{new} {spoken_state(state_now)}"
    # A bare compass point ("East") is no use as a search term.
    aliases = [a for a in dict.fromkeys([name, *extra]) if a != new and a not in DIRECTIONAL]
    return new, state_now, aliases


def build(districts, state_today) -> tuple[dict, dict]:
    """districts: Census district records (census_code, name, state, centroid)."""
    out = {}
    for d in sorted(districts, key=lambda d: (d.state, d.name)):
        if d.name in SKIP:
            continue
        name, state, aliases = today(d.name, d.state, state_today(*d.centroid))
        out[str(d.census_code)] = [
            name,
            d.state,
            round(d.centroid[0], 3),
            round(d.centroid[1], 3),
            state,
            aliases,
        ]
    renamed = sum(1 for v in out.values() if v[5])
    report = {"districts": len(out), "renamed_or_aliased": renamed}
    return {"cities": CITIES, "districts": out}, report


def write(data: dict, path: Path) -> dict:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return {"file": path.name, "bytes": path.stat().st_size}


# ---- towns -----------------------------------------------------------------

# Indian Railways station codes; OpenStreetMap also tags metro stations (A01, 12).
RAIL_CODE = re.compile(r"^[A-Z]{2,5}$")
# Station-name suffixes that are not part of the place's name.
SUFFIX = re.compile(r"\s(jn|junction|road|rd|halt|cantt|city|town|terminus|ph)\.?$", re.I)
SAME_PLACE_KM = 8
# GeoNames feature codes for populated places, best first: cities and towns, then villages.
RANK = {"PPLC": 0, "PPLA": 0, "PPLA2": 1, "PPLA3": 1, "PPLA4": 1, "PPL": 3, "PPLL": 3, "PPLX": 4}
STATION_RANK = 2
BIG_TOWN = 20_000  # people; ranks a PPL place like a district town


def key(name: str) -> str:
    """Lower-case name without station suffixes: "Birur Jn" and "Birur" are one place."""
    # Same rule as the browser's normalise(): accents dropped, so "Kūa" files under "kua".
    plain = unicodedata.normalize("NFKD", name.lower())
    plain = "".join(c for c in plain if not unicodedata.combining(c))
    base = SUFFIX.sub("", plain).strip()
    return re.sub(r"[^a-z0-9]+", " ", base).strip()


def read_geonames(zip_path: Path) -> list[dict]:
    """Populated places (feature class P) from the GeoNames India dump."""
    import io
    import zipfile

    out = []
    with zipfile.ZipFile(zip_path) as z, z.open("IN.txt") as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8"):
            f = line.rstrip("\n").split("\t")
            if f[6] != "P" or f[7] not in RANK:
                continue
            rank = RANK[f[7]]
            if rank == 3 and f[14].isdigit() and int(f[14]) >= BIG_TOWN:
                rank = 1
            out.append({"name": f[1], "lat": float(f[4]), "lon": float(f[5]), "rank": rank})
    return out


def build_towns(
    geonames: list[dict], stations, timetable_codes: set[str], locate_many, districts: dict
) -> tuple[list, dict]:
    """Searchable places beyond districts: GeoNames towns and villages, plus every station
    that is not a main stop in the timetable (Kadur, say). Each row is
    [name, lon, lat, Census district code, station code or "", rank (0 = city ... 4)]."""
    known = districts["districts"]
    district_names = {(key(v[0]), int(k)) for k, v in known.items()}
    district_names |= {(key(a), int(k)) for k, v in known.items() for a in v[5]}
    rows: list[list] = []
    seen: dict[tuple[str, int], list[list]] = {}

    def add(name: str, lon: float, lat: float, district: int | None, code: str, rank: int):
        if district is None or str(district) not in known:
            return
        k = (key(name), district)
        if not k[0] or k in district_names:  # "Patna" the town is found as Patna the district
            return
        for old in seen.get(k, []):
            if haversine_km(old[1], old[2], lon, lat) <= SAME_PLACE_KM:
                if code and not old[4]:
                    old[4] = code  # a town with its own (small) station
                old[5] = min(old[5], rank)
                return
        row = [name, round(lon, 4), round(lat, 4), district, code, rank]
        seen.setdefault(k, []).append(row)
        rows.append(row)

    small = [s for s in stations if s.code not in timetable_codes and RAIL_CODE.match(s.code)]
    for st in small:
        add(tidy_name(st.name), st.lon, st.lat, st.district_code, st.code, STATION_RANK)
    geonames = sorted(geonames, key=lambda g: g["rank"])
    found = locate_many([(g["lon"], g["lat"]) for g in geonames])
    for g, district in zip(geonames, found, strict=True):
        add(g["name"].strip(), g["lon"], g["lat"], district, "", g["rank"])
    report = {
        "towns_and_stations": len(rows),
        "with_station": sum(1 for r in rows if r[4]),
        "from_geonames": len(geonames),
    }
    return rows, report


SHARD_BYTES = 120_000  # a busy prefix ("ka") is split further, to "kad", "kal", ...
MAX_PREFIX = 5


def _letters(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key(name))


def _encode(rows: list) -> str:
    rows.sort(key=lambda r: (r[5], r[0]))
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":"))


def write_towns(rows: list, folder: Path) -> dict:
    """Places split by the first letters of their names, so typing "kad" downloads only the
    "kad" file. Prefixes start at two letters and grow until each file is small."""
    import shutil

    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    files: dict[str, str] = {}

    def split(group: list, length: int) -> None:
        buckets: dict[str, list] = {}
        for row in group:
            buckets.setdefault(_letters(row[0])[:length].ljust(length, "_"), []).append(row)
        for prefix, bucket in buckets.items():
            text = _encode(bucket)
            if (
                len(text.encode()) > SHARD_BYTES
                and length < MAX_PREFIX
                and not prefix.endswith("_")
            ):
                split(bucket, length + 1)
            else:
                files[prefix] = text

    split(rows, 2)
    for prefix, text in files.items():
        (folder / f"{prefix}.json").write_text(text, encoding="utf-8")
    (folder / "index.json").write_text(json.dumps(sorted(files)), encoding="utf-8")
    sizes = [len(t.encode()) for t in files.values()]
    return {
        "folder": folder.name,
        "files": len(files),
        "largest_bytes": max(sizes),
        "total_bytes": sum(sizes),
    }
