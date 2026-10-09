"""Candidates (candidates.yaml) -> coverage -> pool.yaml. Resumable: every decision is logged in
admission.yaml and never retried. A corner admits picks first, then reserves, until it holds as many
bands as candidates.yaml picked for it."""
import itertools
import json
import sys
from pathlib import Path
from urllib.parse import quote

import yaml

from . import __main__ as cli
from .check import SHORT_MAX
from .sources import deezer, http, itunes, metal_archives
from .sources.titles import normalise_title

HERE = Path(__file__).parent
LOG = HERE / "admission.yaml"
ITUNES_TRIES = 3  # same-name iTunes artists checked against the Metal Archives discography
GENERIC = {"the", "of", "in", "and", "black", "dark", "death", "iron", "metal", "blood", "night", "dead"}


def short_label(name, taken):
    """Tick label of at most 9 characters, unique in the pool; override by editing pool.yaml."""
    words = name.split()
    distinct = sorted((w for w in words if w.lower() not in GENERIC and len(w) <= SHORT_MAX),
                      key=lambda w: -len(w))  # longest distinctive word: Nathrakh, Maiden, Witchery
    options = [name, *distinct, "".join(w[0] for w in words) if len(words) > 2 else None,
               name[:SHORT_MAX - 1] + "."]
    for s in options:
        if s and len(s) <= SHORT_MAX and len(s) >= 3 and s not in taken:
            return s
    return next(s for i in itertools.count(2) if (s := f"{name[:SHORT_MAX - 1]}{i}") not in taken)  # last resort


def same_name(a, b):
    return normalise_title(a) == normalise_title(b)


def resolve_itunes(cand, ma_albums):
    """iTunes artist whose albums best overlap the Metal Archives full-lengths; (id, albums) or None."""
    full = {normalise_title(a["title"]) for a in ma_albums if a["type"] == "Full-length"}
    rows = json.loads(http.get(f"https://itunes.apple.com/search?term={quote(cand['name'])}"
                               f"&entity=musicArtist&attribute=artistTerm&limit=10"))["results"]
    found = [r["artistId"] for r in rows if same_name(r["artistName"], cand["name"])][:ITUNES_TRIES]
    # Wikidata's Apple Music ID first, but it is sometimes stale (Myrkur), so search results follow it
    ids = list(dict.fromkeys(([cand["itunes"]] if cand.get("itunes") else []) + found))
    best = None
    for artist_id in ids:
        albums = itunes.albums(artist_id)
        overlap = len({a["norm"] for a in albums} & full)
        if overlap and (best is None or overlap > best[0]):
            best = (overlap, artist_id, albums)
        if overlap == len(full):  # every full-length matched: no later artist can do better
            break
    return (best[1], best[2]) if best else None


def resolve_deezer(cand):
    if cand.get("deezer"):
        return cand["deezer"]
    rows = deezer._json(f"https://api.deezer.com/search/artist?q={quote(cand['name'])}&limit=10").get("data", [])
    hits = [r for r in rows if same_name(r["name"], cand["name"])]
    return max(hits, key=lambda r: r["nb_fan"])["id"] if hits else None


def try_candidate(cand, taken_shorts):
    """Returns (pool entry, None) when the band passes coverage, else (None, reason)."""
    try:
        meta = metal_archives.band(f"_/{cand['ma']}")
    except http.HTTPError as e:
        if e.transient:
            raise
        return None, f"metal archives: {e}"  # a real 404: the band is not there
    except (KeyError, AttributeError, ValueError, TypeError) as e:  # odd page
        return None, f"metal archives: {type(e).__name__} {e}"
    found = resolve_itunes(cand, meta["albums"])
    if not found:
        return None, "itunes: no artist whose albums match the Metal Archives full-lengths"
    itunes_id, albums = found
    deezer_id = resolve_deezer(cand)
    if not deezer_id:
        return None, "deezer: no artist of that name"
    entry = {"slug": cand["slug"], "name": cand["name"], "short": short_label(cand["name"], taken_shorts),
             "itunes": itunes_id, "deezer": deezer_id, "spotify": cand["spotify"], "ma": f"_/{cand['ma']}"}
    record = cli.fetch(entry, audio=False, meta=meta, itunes_albums=albums)
    if len(record["clips"]) < cli.CLIPS_MIN:
        return None, f"coverage: {len(record['clips'])} clips, need {cli.CLIPS_MIN}"
    return entry, None


def append_to_pool(entry, corner):
    line = yaml.safe_dump([entry], allow_unicode=True, default_flow_style=None, width=200).strip()
    with (HERE / "pool.yaml").open("a") as f:
        f.write(f"  # corner: {corner}; admitted by python -m ingest admit; hand scores drafted separately\n")
        f.write("  " + line.replace("\n", "\n  ") + "\n")


def write_log(log):
    LOG.write_text("# Written by python -m ingest admit: one decision per candidate, never retried.\n"
                   + yaml.safe_dump(log, allow_unicode=True, sort_keys=False))


def decide(cand, corner, log, taken, in_pool):
    try:
        entry, reason = try_candidate(cand, taken)
    except http.HTTPError as e:
        if e.transient:  # the source, not the band, is the problem: stop here, the next run retries this candidate
            raise SystemExit(f"{cand['slug']}: {e}; stopping so it is retried, not rejected")
        entry, reason = None, f"error: {e}"
    except Exception as e:  # one band's odd data must never stop a multi-hour run; it is logged, not retried
        entry, reason = None, f"error: {type(e).__name__} {e}"
    log[cand["slug"]] = {"corner": corner, "status": "admitted" if entry else "rejected",
                         **({"reason": reason} if reason else {})}
    if entry:
        append_to_pool(entry, corner)
        taken.add(entry["short"])
        in_pool.add(entry["slug"])
    else:
        print(f"{cand['slug']:18} rejected: {reason}", flush=True)
    write_log(log)
    return bool(entry)


def top_up(chosen, log, taken, in_pool):
    """Corners that ran out of reserves leave a deficit; fill it from the deepest remaining reserves."""
    deficit = sum(len(g["picks"]) for g in chosen.values()) - sum(v["status"] == "admitted" for v in log.values())
    left = {c: [x for x in g["reserves"] if x["slug"] not in log and x["slug"] not in in_pool]
            for c, g in chosen.items()}
    extra = {c: 0 for c in chosen}
    while deficit > 0 and any(left.values()):
        corner = max(left, key=lambda c: len(left[c]) - 3 * extra[c])  # spread, as scout does
        if decide(left[corner].pop(0), corner, log, taken, in_pool):
            deficit -= 1
            extra[corner] += 1
    print(f"== top-up: {sum(extra.values())} admitted from reserves, deficit {max(deficit, 0)}", flush=True)


def main(only=()):
    chosen = yaml.safe_load((HERE / "candidates.yaml").read_text())
    log = yaml.safe_load(LOG.read_text()) if LOG.exists() else {}
    log = log or {}
    pool = cli.pool()
    taken = {b["short"] for b in pool}
    in_pool = {b["slug"] for b in pool}
    for corner, group in chosen.items():
        if only and corner not in only:
            continue
        target = len(group["picks"])
        admitted = sum(1 for v in log.values() if v["corner"] == corner and v["status"] == "admitted")
        for cand in group["picks"] + group["reserves"]:
            if admitted >= target:
                break
            if cand["slug"] in log or cand["slug"] in in_pool:
                continue
            admitted += decide(cand, corner, log, taken, in_pool)
        print(f"== {corner}: {admitted}/{target} admitted", flush=True)
    if not only:
        top_up(chosen, log, taken, in_pool)
    total = sum(1 for v in log.values() if v["status"] == "admitted")
    print(f"admitted {total}; pool now {len(cli.pool())} bands", file=sys.stderr)
