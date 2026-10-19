"""Places people search for: every Census 2011 district under today's name, plus
the big cities that span several districts.

Districts keep their Census 2011 codes (the migration counts are keyed by them),
but are shown under the names and states people use today: Gurugram, not Gurgaon;
Leh in Ladakh, not Jammu & Kashmir. The old names stay searchable as aliases.
"""

from __future__ import annotations

import json
from pathlib import Path

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
