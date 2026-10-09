"""Draw candidate bands from Wikidata by corner quota (corners.yaml) -> ingest/candidates.yaml.
Candidates are not pool members: a candidate joins pool.yaml only after it passes coverage."""
import json
import math
import random
import re
import unicodedata
from pathlib import Path
from urllib.parse import quote

import yaml

from .sources import http

HERE = Path(__file__).parent
SPARQL = "https://query.wikidata.org/sparql"
RESERVE_FACTOR = 2  # reserves kept per corner, as a multiple of the picks, to replace coverage failures
SEED = 666

# Bands (not humans) with a Metal Archives ID (P1952) and a Spotify artist ID (P1902); Apple Music/iTunes (P2850),
# Deezer (P2722), country ISO code (P495, else the formation location's country), genres (P136) and sitelink count where known.
QUERY = """
SELECT ?b ?name ?ma ?sp ?it ?dz ?cc ?links (GROUP_CONCAT(DISTINCT ?gl; separator="|") AS ?genres) WHERE {
  ?b wdt:P1952 ?ma ; wdt:P1902 ?sp ; wikibase:sitelinks ?links ; rdfs:label ?name . FILTER(lang(?name) = "en")
  FILTER NOT EXISTS { ?b wdt:P31 wd:Q5 }  # bands only: solo artists are humans in Wikidata
  OPTIONAL { ?b wdt:P2850 ?it } OPTIONAL { ?b wdt:P2722 ?dz }
  OPTIONAL { { ?b wdt:P495 ?c } UNION { ?b wdt:P740/wdt:P17 ?c } ?c wdt:P297 ?cc }
  OPTIONAL { ?b wdt:P136 ?g . ?g rdfs:label ?gl . FILTER(lang(?gl) = "en") }
} GROUP BY ?b ?name ?ma ?sp ?it ?dz ?cc ?links
"""


def wikidata():
    rows = json.loads(http.get(f"{SPARQL}?format=json&query={quote(QUERY)}"))["results"]["bindings"]
    seen, out = set(), []
    for r in rows:
        qid = r["b"]["value"].rsplit("/", 1)[1]
        if qid in seen:  # several iTunes/Deezer/country values give duplicate rows; keep the first
            continue
        seen.add(qid)
        v = lambda k: r[k]["value"] if k in r else None
        out.append({"qid": qid, "name": v("name"), "ma": v("ma"), "spotify": v("sp"),
                    "itunes": int(v("it")) if v("it") and v("it").isdigit() else None,
                    "deezer": int(v("dz")) if v("dz") and v("dz").isdigit() else None,
                    "country": v("cc"), "sitelinks": int(v("links")),
                    "genres": [g for g in (v("genres") or "").split("|") if g]})
    return out


def corner_of(genres, corners):
    text = [g.lower() for g in genres]
    for c in corners:
        if any(k in g for k in c["keywords"] for g in text):
            return c["id"]
    return None


def slugify(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "band"


def select(candidates, cfg, existing):
    """existing: {"ma": set of MA ids, "spotify": set, "corners": {corner id: count already in the pool}}.
    Returns {corner id: {"picks": [...], "reserves": [...], "short_of": n}}."""
    rng = random.Random(SEED)
    by_corner = {c["id"]: [] for c in cfg["corners"]}
    for cand in candidates:
        if cand["ma"] in existing["ma"] or cand["spotify"] in existing["spotify"]:
            continue
        cid = corner_of(cand["genres"], cfg["corners"])
        if cid:
            by_corner[cid].append(cand)
    out = {}
    for c in cfg["corners"]:
        need = max(0, c["quota"] - existing["corners"].get(c["id"], 0))
        cap = math.ceil(cfg["country_cap"] * c["quota"])
        ranked = sorted(by_corner[c["id"]], key=lambda x: (-x["sitelinks"], x["name"]))
        known_n = round(cfg["known_share"] * need)
        lower = ranked[len(ranked) // 2:]
        deep_order = rng.sample(lower, len(lower))
        per_country, picks = {}, []

        def take(pool, n):
            for cand in pool:
                if len(picks) >= n:
                    return
                if cand in picks or per_country.get(cand["country"], 0) >= cap:
                    continue
                per_country[cand["country"]] = per_country.get(cand["country"], 0) + 1
                picks.append(cand)

        take(ranked, known_n)
        take(deep_order, need)
        take(ranked, need)  # deep cuts ran short: fill from the known side
        rest = [x for x in ranked if x not in picks][: RESERVE_FACTOR * max(need, 1)]
        out[c["id"]] = {"picks": picks, "reserves": rest, "short_of": need - len(picks)}
    # Corners that came up short hand their slots to the corners with the deepest reserves, one at a time.
    short = sum(g["short_of"] for g in out.values())
    while short > 0:
        donor = max(out, key=lambda cid: len(out[cid]["reserves"]) - 3 * out[cid].get("spill", 0))  # spread it
        if not out[donor]["reserves"]:
            break
        out[donor]["picks"].append(out[donor]["reserves"].pop(0))
        out[donor]["spill"] = out[donor].get("spill", 0) + 1
        short -= 1
    return out


def existing_pool(pool, fetched_genres):
    ma = {str(b["ma"]).rsplit("/", 1)[1] for b in pool if b.get("ma")}
    cfg = yaml.safe_load((HERE / "corners.yaml").read_text())
    counts = {}
    for b in pool:
        cid = corner_of([fetched_genres.get(b["slug"], b.get("metadata", {}).get("genre", ""))], cfg["corners"])
        counts[cid] = counts.get(cid, 0) + 1
    return {"ma": ma, "spotify": {b["spotify"] for b in pool}, "corners": counts}


def main(root=HERE.parent):
    pool = yaml.safe_load((HERE / "pool.yaml").read_text())["bands"]
    cfg = yaml.safe_load((HERE / "corners.yaml").read_text())
    genres = {p.stem: json.loads(p.read_text())["metadata"]["genre"] for p in (root / "data" / "fetch").glob("*.json")}
    candidates = wikidata()
    chosen = select(candidates, cfg, existing_pool(pool, genres))
    used = {b["slug"] for b in pool}
    for group in chosen.values():
        for cand in group["picks"] + group["reserves"]:
            base = slug = slugify(cand["name"])
            if slug in used:
                slug = f"{base}-{(cand['country'] or cand['qid']).lower()}"
            n = 2
            while slug in used:  # same name, same country: number it rather than collide on data paths
                slug, n = f"{base}-{n}", n + 1
            used.add(slug)
            cand["slug"] = slug
    (HERE / "candidates.yaml").write_text(
        "# Written by python -m ingest scout from Wikidata; picks go through coverage before joining pool.yaml.\n"
        + yaml.safe_dump(chosen, allow_unicode=True, sort_keys=False, width=120))
    print(f"{len(candidates)} Wikidata bands with Metal Archives and Spotify IDs")
    for cid, g in chosen.items():
        print(f"  {cid:17} {len(g['picks']):3} picks, {len(g['reserves']):3} reserves"
              + (f", short by {g['short_of']}" if g["short_of"] else "")
              + (f", +{g['spill']} spilled in" if g.get("spill") else ""))
    print(f"total picks {sum(len(g['picks']) for g in chosen.values())} + {len(pool)} in the pool")
