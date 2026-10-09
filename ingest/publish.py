"""Stored raw band records -> everything pool-relative -> web/bands.json. Touches no audio."""
import datetime
import json
import math
import re
from pathlib import Path

import scipy.stats
import yaml

HERE = Path(__file__).parent
ROOT = HERE.parent
VOCALS = {"harsh": 1.0, "mixed": 0.5, "clean": 0.0}
# Metal Archives "Themes" field -> lyric axes (lyrics.yaml), the only place the themes reach the desk: the Lyrics
# grid filters on them, no fader reads them. A band is on an axis when one of its themes contains an axis key.
def lyric_axes(themes, axes):
    parts = [re.sub(r"\(.*?\)", "", t).strip().lower() for t in re.split(r"[,;]", themes or "")]  # "(early)" dropped
    parts = [t for t in parts if t and t != "n/a"]
    return sorted(a for a, cfg in axes.items() if any(k in p for k in cfg["keys"] for p in parts))
SWITCHES = [{"id": "active", "label": "Still active"}, {"id": "instrumental", "label": "Instrumental"},
            {"id": "stable", "label": "Lineup stable", "note": "crude: past members <= current"}]


def load_yaml(name):
    return yaml.safe_load((HERE / name).read_text())


def with_pool(bands, pool):
    """Name, Spotify id and hand scores come from pool.yaml, the hand-edit path, so publish && check honours an edit
    without re-extracting; records without a pool entry are dropped. The record keeps the measured features."""
    cfg = {b["slug"]: b for b in pool}
    orphans = [b["slug"] for b in bands if b["slug"] not in cfg]
    if orphans:
        print(f"skipping {len(orphans)} band records with no pool.yaml entry: {', '.join(orphans)}")
    return [{**b, "name": cfg[b["slug"]]["name"], "ids": {**b["ids"], "spotify": cfg[b["slug"]]["spotify"]},
             "hand": cfg[b["slug"]].get("hand", b["hand"])} for b in bands if b["slug"] in cfg]


def load_bands(root=ROOT):
    bands = [json.loads(p.read_text()) for p in sorted((root / "data" / "bands").glob("*.json"))]
    return with_pool(bands, load_yaml("pool.yaml")["bands"])


def percentiles(values):
    """100 * (rank - 1) / (n - 1), ties take the average rank (D7)."""
    n = len(values)
    if n < 2:
        return [50.0] * n
    return [100 * (r - 1) / (n - 1) for r in scipy.stats.rankdata(values, method="average")]


def inputs(band):
    """Every blendable input of one band: feature medians, their IQRs (name_iqr), metadata, hand scores."""
    out = {}
    for k, v in band["features"].items():
        out[k], out[f"{k}_iqr"] = v["median"], v["iqr"]
    out["vocals_harsh"] = VOCALS[band["metadata"]["vocals"]]
    out.update(band["hand"])
    return out


def input_percentiles(bands):
    """name -> list of percentiles aligned with bands, only for inputs every band has (pool-wide rule)."""
    rows = [inputs(b) for b in bands]
    common = set.intersection(*(set(r) for r in rows)) if rows else set()
    return {k: percentiles([r[k] for r in rows]) for k in common}


def blend(pct, weights, exclude=()):
    """Weighted blend of input percentiles, re-ranked to 0..100. Returns (values or None, status, dropped).
    Inputs missing pool-wide are dropped; under half the absolute weight mass left -> bypassed."""
    weights = {k: w for k, w in weights.items() if k not in exclude}
    dropped = sorted(k for k in weights if k not in pct)
    present = {k: w for k, w in weights.items() if k in pct}
    mass = sum(abs(w) for w in weights.values())
    if not present or sum(abs(w) for w in present.values()) < mass / 2:
        return None, "bypassed", dropped
    total = sum(abs(w) for w in present.values())
    n = len(next(iter(pct.values())))
    raw = [sum(w * pct[k][i] for k, w in present.items()) / total for i in range(n)]
    return percentiles(raw), "live", dropped


def faders(bands, weights_cfg, exclude=()):
    """fader id -> {"values": [...] aligned with bands, "status", "dropped"}."""
    pct = input_percentiles(bands)
    out = {}
    for fid, f in weights_cfg["faders"].items():
        values, status, dropped = blend(pct, f["weights"], exclude)
        out[fid] = {"values": values, "status": status, "dropped": dropped}
    return out


def ticks(values, labels):
    """Reference bands along a fader: the band nearest each quintile (0, 25, 50, 75, 100), each a distinct band."""
    order = sorted(range(len(values)), key=lambda i: (values[i], labels[i]["slug"]))
    used, out = set(), []
    for t in (0, 25, 50, 75, 100):
        if len(used) == len(order):  # fewer than five bands: as many ticks as there are bands
            break
        i = min((i for i in order if i not in used), key=lambda i: (abs(values[i] - t), labels[i]["slug"]))
        used.add(i)
        out.append({"value": round(values[i], 1), "short": labels[i]["short"], "name": labels[i]["name"]})
    return out


def packs_for(genre, themes):
    """Packs the genre string names, earliest mention first: the first skins the desk, the second trims it."""
    g = genre.lower()
    first = {}
    for rule in themes["rules"]:
        hits = [g.find(k) for k in rule["keywords"] if k in g]
        if hits:
            first[rule["pack"]] = min(hits)
    return sorted(first, key=first.get)


def pack_for(genre, themes):
    return (packs_for(genre, themes) or [themes["default"]])[0]


def prolificness(meta, today=None):
    end = meta["split"] or (today or datetime.date.today()).year
    return meta["full_lengths"] / max(end - meta["formed"] + 1, 1)


def knob_values(b):
    m = b["metadata"]
    return {"era": m["formed"], "prolific": round(prolificness(m), 3)}


def build(bands, pool, weights_cfg, themes, lyrics):
    bands = with_pool(bands, pool)
    cfg = {b["slug"]: b for b in pool}
    labels = [{"slug": b["slug"], "short": cfg[b["slug"]]["short"], "name": b["name"]} for b in bands]
    fd = faders(bands, weights_cfg)
    kv = [knob_values(b) for b in bands]
    span = lambda k: [min(v[k] for v in kv), max(v[k] for v in kv)]
    era_min = min(1970, span("era")[0] // 10 * 10)  # Scorpions formed 1964: the knob reaches every band
    packs = [pack_for(b["metadata"]["genre"], themes) for b in bands]
    packs2 = [(packs_for(b["metadata"]["genre"], themes)[1:] or [None])[0] for b in bands]  # crossover trim, or None
    switch_values = [{"active": b["metadata"]["status"] == "active", "instrumental": b["metadata"]["instrumental"],
                      "stable": b["metadata"]["past_members"] <= b["metadata"]["members"]} for b in bands]
    # A switch every band answers the same way is a dead end on the desk (Instrumental: 0 of 666), so it is left out.
    switches = [s for s in SWITCHES if len({v[s["id"]] for v in switch_values}) > 1]
    return {
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "faders": [{"id": fid, "label": weights_cfg["faders"][fid]["label"], "group": weights_cfg["faders"][fid]["group"],
                    "status": f["status"], "ticks": ticks(f["values"], labels) if f["values"] else []}
                   for fid, f in fd.items()],
        "knobs": [
            {"id": "era", "label": "Era", "unit": "year", "min": era_min, "max": 2029, "step": 1,
             "detents": list(range(era_min, 2021, 10))},
            {"id": "prolific", "label": "Prolificness", "unit": "albums/yr", "min": 0,
             "max": math.ceil(span("prolific")[1] * 10) / 10},
        ],
        "switches": switches,
        "selectors": [
            {"id": "country", "label": "Country",
             "options": sorted({b["metadata"]["country"] for b in bands})},
            {"id": "subgenre", "label": "Subgenre",
             "options": sorted(set(packs), key=list(themes["packs"]).index)},
        ],
        "lyrics": {"id": "lyrics", "label": "Lyrics", "options": [{"id": k, "label": v["label"]} for k, v in lyrics.items()]},
        "packs": themes["packs"],
        "bands": [{
            "slug": b["slug"], "name": b["name"], "short": cfg[b["slug"]]["short"], "spotify": b["ids"]["spotify"],
            "genre": b["metadata"]["genre"], "pack": packs[i], "pack2": packs2[i],
            "fans": b["metadata"]["fans"],  # Deezer nb_fan, shown as a size hint only (dropped as a knob 2026-10-07)
            "faders": {fid: round(f["values"][i], 1) for fid, f in fd.items() if f["values"]},
            "knobs": kv[i],
            "switches": {s["id"]: switch_values[i][s["id"]] for s in switches},
            "selectors": {"country": b["metadata"]["country"], "subgenre": packs[i]},
            "lyrics": lyric_axes(b["metadata"]["themes"], lyrics),
        } for i, b in enumerate(bands)],
    }


def main(root=ROOT):
    bands = load_bands(root)
    if not bands:
        raise SystemExit("no band records in data/bands; run python -m ingest extract first")
    out = build(bands, load_yaml("pool.yaml")["bands"], load_yaml("weights.yaml"), load_yaml("themes.yaml"),
                load_yaml("lyrics.yaml")["axes"])
    (root / "web" / "bands.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
    print(f"published {len(bands)} bands to web/bands.json")
    for f in out["faders"]:
        print(f"  {f['id']:14} {f['status']}")
    return out
