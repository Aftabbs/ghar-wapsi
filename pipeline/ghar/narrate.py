"""The story line at the top of each card, in English and Hindi.

An LLM writes a small set of templates, one group per situation (are festival specials
running, is Chhath celebrated in the home state, how large is the community in the
city), with slots for the city and state names. Every template is checked by code and
then read by a person before it is used; the reviewed set lives in
data/narrations/templates.json. The pipeline fills the slots for each city and home
state, so no unreviewed sentence reaches the site, and the site never calls an API.

    python -m ghar.narrate draft       # LLM drafts templates + Hindi names (GROQ_API_KEY)
    python -m ghar.narrate             # fill reviewed templates -> web/public/data
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "web" / "public" / "data"
FOLDER = ROOT / "data" / "narrations"
TEMPLATES = FOLDER / "templates.json"
NAMES_HI = FOLDER / "names-hi.json"
OUT = DATA / "narrations.json"
API = "https://api.groq.com/openai/v1/chat/completions"
VARIANTS = 3
MAX_EN_CHARS = 120  # without the city and state names
MAX_HI_CHARS = 140

CHHATH_STATES = {"Bihar", "Jharkhand", "Uttar Pradesh"}
FESTIVAL_WORDS = {
    "Diwali": ["diwali", "दीवाली", "दिवाली", "दीपावली"],
    "Chhath": ["chhath", "छठ"],
    "Durga Puja": ["durga", "दुर्गा"],
    "Holi": ["holi", "होली"],
    "Eid": ["eid", "ईद"],
    "Onam": ["onam", "ओणम"],
    "Pongal": ["pongal", "पोंगल"],
    "Bihu": ["bihu", "बिहू"],
    "Kali Puja": ["kali puja", "काली पूजा"],
}
QUANTITY_WORDS = [
    "lakh", "crore", "million", "billion", "thousand", "hundred", "percent", "%",
    "लाख", "करोड़", "हज़ार", "हजार", "प्रतिशत", "फ़ीसदी", "फीसदी",
]  # fmt: skip
DIGITS = re.compile(r"[0-9०-९]")
DEVANAGARI = re.compile(r"[ऀ-ॿ]")
SLOTS_EN = ("{city}", "{state}")
SLOTS_HI = ("{city_hi}", "{state_hi}")

# Census 2011 count of people from the home state living in the city -> description.
COMMUNITY_SIZES = [(100_000, "big"), (20_000, "medium"), (2_000, "small"), (0, "none")]
COMMUNITY_WORDS = {
    "big": "A large community from the home state lives in the city.",
    "medium": "A sizeable community from the home state lives in the city.",
    "small": "A small community from the home state lives in the city.",
    "none": "Few people from the home state live in the city.",
}


def scenario(specials: bool, chhath: bool, people: int) -> str:
    size = next(name for floor, name in COMMUNITY_SIZES if people >= floor)
    return (
        f"specials={'yes' if specials else 'no'}|chhath={'yes' if chhath else 'no'}"
        f"|community={size}"
    )


def scenario_facts(key: str) -> dict:
    parts = dict(p.split("=") for p in key.split("|"))
    return {
        "festivals": ["Diwali", "Chhath"] if parts["chhath"] == "yes" else ["Diwali"],
        "festival_specials": (
            "Festival special trains are running from the city to the home state this season."
            if parts["specials"] == "yes"
            else "No festival special from the city to the home state is on the verified list "
            "yet (it holds only trains confirmed in official notices; there may be others)."
        ),
        "community": COMMUNITY_WORDS[parts["community"]],
    }


ALL_SCENARIOS = [
    scenario(specials, chhath, people)
    for specials in (True, False)
    for chhath in (True, False)
    for people in (100_000, 20_000, 2_000, 0)
]


# ---- checks ---------------------------------------------------------------


def _strip_slots(text: str, slots: tuple[str, ...]) -> str:
    for slot in slots:
        text = text.replace(slot, "")
    return text


def check(line: dict, festivals: list[str]) -> list[str]:
    """Problems with a template pair {en, hi}; empty means it passes."""
    en, hi = line.get("en", "").strip(), line.get("hi", "").strip()
    if not en or not hi:
        return ["missing text"]
    problems = [f"English must use {s} exactly once" for s in SLOTS_EN if en.count(s) != 1]
    problems += [f"Hindi must use {s} exactly once" for s in SLOTS_HI if hi.count(s) != 1]
    bare_en, bare_hi = _strip_slots(en, SLOTS_EN), _strip_slots(hi, SLOTS_HI)
    if "{" in bare_en + bare_hi or "}" in bare_en + bare_hi:
        problems.append("unknown slot")
    both = f"{bare_en} {bare_hi}".lower()
    if DIGITS.search(both):
        problems.append("contains a number")
    if any(word in both for word in QUANTITY_WORDS):
        problems.append("contains a quantity word")
    for festival, words in FESTIVAL_WORDS.items():
        if festival not in festivals and any(w in both for w in words):
            problems.append(f"names {festival}, which is not in the facts")
    if len(bare_en) > MAX_EN_CHARS or len(bare_hi) > MAX_HI_CHARS:
        problems.append("too long")
    if "!" in both or "#" in both:
        problems.append("exclamation or hashtag")
    if len(DEVANAGARI.findall(bare_hi)) < 0.7 * len(re.sub(r"\W", "", bare_hi)):
        problems.append("Hindi is not mostly Devanagari")
    return problems


# ---- drafting with the LLM ------------------------------------------------


def _load_env() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())


def _call(messages: list[dict], schema: dict, retries: int = 6) -> dict:
    body = {
        "model": os.environ.get("MODEL_NAME", "openai/gpt-oss-120b"),
        "messages": messages,
        "temperature": 0.7,
        "reasoning_effort": "medium",
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "result", "schema": schema, "strict": True},
        },
    }
    request = urllib.request.Request(
        API,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {os.environ['GROQ_API_KEY']}",
            "Content-Type": "application/json",
            "User-Agent": "ghar-wapsi-pipeline/0.1",
        },
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = json.loads(response.read())
            return json.loads(payload["choices"][0]["message"]["content"])
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", "replace")
            # 400 json_validate_failed: the model's output did not fit the schema; try again.
            retryable = err.code in (429, 500, 502, 503) or "json_validate_failed" in detail
            if retryable and attempt < retries - 1:
                wait = int(err.headers.get("retry-after", 0) or 0) or 15 * (attempt + 1)
                time.sleep(wait)
                continue
            raise RuntimeError(f"Groq API {err.code}: {detail[:300]}") from err
        except (OSError, ValueError, KeyError):
            if attempt == retries - 1:
                raise
            time.sleep(10 * (attempt + 1))
    raise RuntimeError("unreachable")


PAIR = {
    "type": "object",
    "properties": {"en": {"type": "string"}, "hi": {"type": "string"}},
    "required": ["en", "hi"],
    "additionalProperties": False,
}
TEMPLATE_SCHEMA = {
    "type": "object",
    "properties": {"variants": {"type": "array", "items": PAIR}},
    "required": ["variants"],
    "additionalProperties": False,
}
NAMES_SCHEMA = {
    "type": "object",
    "properties": {"names": {"type": "array", "items": PAIR}},
    "required": ["names"],
    "additionalProperties": False,
}


def draft_templates(save) -> dict:
    """Draft templates per situation, saving after each so an interrupted run resumes."""
    system = (Path(__file__).parent / "prompts" / "card_system.txt").read_text(encoding="utf-8")
    draft = FOLDER / "templates.draft.json"
    out = json.loads(draft.read_text(encoding="utf-8"))["templates"] if draft.exists() else {}
    for key in ALL_SCENARIOS:
        if len(out.get(key, [])) >= VARIANTS:
            continue
        facts = scenario_facts(key)
        prompt = f"Write {VARIANTS} different templates for these facts:\n" + json.dumps(
            facts, ensure_ascii=False, indent=1
        )
        good: list[dict] = []
        for _attempt in range(4):
            result = _call(
                [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                TEMPLATE_SCHEMA,
            )
            good += [v for v in result["variants"] if not check(v, facts["festivals"])]
            if len(good) >= VARIANTS:
                break
        out[key] = good[:VARIANTS]
        save(out)
        print(f"  {key}: {len(out[key])} templates", flush=True)
    return out


def draft_names(names: list[str]) -> dict[str, str]:
    prompt = (
        "Give the usual Hindi (Devanagari) name for each Indian city and state below, as Hindi "
        "newspapers write it. Put the English name in 'en' and the Hindi in 'hi'. Return every "
        "name exactly once.\n" + json.dumps(names, ensure_ascii=False)
    )
    result = _call(
        [
            {"role": "system", "content": "You are a careful Hindi editor."},
            {"role": "user", "content": prompt},
        ],
        NAMES_SCHEMA,
    )
    return {n["en"]: n["hi"] for n in result["names"]}


# ---- filling ----------------------------------------------------------------


def _spoken(state: str) -> str:
    return "Delhi" if state == "NCT of Delhi" else state


def _variant(city_id: str, state: str, count: int) -> int:
    return hashlib.sha256(f"{city_id}|{state}".encode()).digest()[0] % count


def fill(data: dict, templates: dict, names_hi: dict[str, str]) -> tuple[dict, dict]:
    """A story line for every city and home state, from reviewed templates only."""
    districts = data["routes"]["districts"]
    states = sorted({d[4] for d in districts.values()})
    cards: dict[str, dict] = {}
    report = {"pairs": 0, "filled": 0, "missing_template": 0, "missing_hindi_name": 0}
    for city_id, city in data["routes"]["cities"].items():
        city_state = districts[str(city["districts"][0])][4]
        inside = set(city["districts"])
        for state in states:
            if state == city_state:
                continue
            report["pairs"] += 1
            census_state = "Andhra Pradesh" if state == "Telangana" else state
            people = sum(
                data["migration"]["districts"].get(str(d), {}).get("from", {}).get(census_state, 0)
                for d in city["districts"]
            )
            specials = any(
                s.get("oDistrict") in inside and s.get("dState") == state for s in data["specials"]
            )
            options = templates.get(scenario(specials, state in CHHATH_STATES, people), [])
            if not options:
                report["missing_template"] += 1
                continue
            name_hi, state_hi = names_hi.get(city["name"]), names_hi.get(_spoken(state))
            if not name_hi or not state_hi:
                report["missing_hindi_name"] += 1
                continue
            t = options[_variant(city_id, state, len(options))]
            cards[f"{city_id}|{state}"] = {
                "en": t["en"].format(city=city["name"], state=_spoken(state)),
                "hi": t["hi"].format(city_hi=name_hi, state_hi=state_hi),
            }
            report["filled"] += 1
    return cards, report


def _load_data() -> dict:
    def load(name: str) -> dict:
        return json.loads((DATA / name).read_text(encoding="utf-8"))

    return {
        "routes": load("routes.json"),
        "migration": load("migration-2011.json"),
        "specials": load("specials-2026.json"),
    }


def _write(path: Path, value, indent: int | None = 1) -> None:
    separators = None if indent else (",", ":")
    text = json.dumps(value, ensure_ascii=False, indent=indent, separators=separators)
    path.write_bytes(text.encode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    data = _load_data()
    FOLDER.mkdir(parents=True, exist_ok=True)
    if args[:1] == ["draft"]:
        _load_env()
        if not os.environ.get("GROQ_API_KEY"):
            print("GROQ_API_KEY is not set (put it in .env).")
            return 1
        cities = [c["name"] for c in data["routes"]["cities"].values()]
        states = sorted({_spoken(d[4]) for d in data["routes"]["districts"].values()})
        if not (FOLDER / "names-hi.draft.json").exists():
            _write(FOLDER / "names-hi.draft.json", draft_names(cities + states))
        model = os.environ.get("MODEL_NAME", "openai/gpt-oss-120b")

        def save(templates: dict) -> None:
            drafts = {"model": model, "reviewed": False, "templates": templates}
            _write(FOLDER / "templates.draft.json", drafts)

        draft_templates(save)
        print("Drafts written. Review them, then save as templates.json and names-hi.json.")
        return 0

    reviewed = json.loads(TEMPLATES.read_text(encoding="utf-8"))
    if not reviewed.get("reviewed"):
        print("templates.json is not marked reviewed; narrations unchanged.")
        return 1
    names = json.loads(NAMES_HI.read_text(encoding="utf-8"))
    cards, report = fill(data, reviewed["templates"], names)
    _write(OUT, {"model": reviewed["model"], "cards": cards}, indent=None)
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
