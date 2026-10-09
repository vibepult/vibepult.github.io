"""Schema validation, premise gates, design rules and the ground-truth report.
FAIL exits 1; WARN prints under FLAGS and exits 0 (D5). Thresholds are poc-24h.md's, fixed before extraction."""
import json
import sys
from pathlib import Path

import jsonschema
import scipy.stats
import yaml

from . import publish
from .aggregate import schema

ROOT = Path(__file__).resolve().parent.parent
AUDIO_FADERS = ["aggression", "serenity", "darkness", "rawness", "speed", "heaviness"]
PROTECTED = ["elderwind", "mayhem", "anaal-nathrakh", "metallica", "gorgoroth", "cannibal-corpse"]
CLUSTER = ["mayhem", "gorgoroth", "cannibal-corpse", "anaal-nathrakh"]
SERENITY_GAP, AGGRESSION_GAP, CLUSTER_RANGE, CLUSTER_FADERS, RHO_CEILING = 40, 30, 40, 2, 0.8
FLAG_EXAMPLES = 5
SHORT_MAX, LABEL_CONTRAST, LED_CONTRAST, MIN_PACKS = 9, 4.5, 3.0, 6


class Report:
    def __init__(self):
        self.fails, self.warns, self.not_evaluable = [], [], []

    def ok(self, msg):
        print(f"  ok    {msg}")

    def info(self, msg):
        print(f"  info  {msg}")

    def fail(self, msg):
        print(f"  FAIL  {msg}")
        self.fails.append(msg)

    def warn(self, msg, kind):
        self.warns.append((kind, msg))

    def gate(self, name, passed, detail):
        (self.ok if passed else self.fail)(f"{name}: {detail}")


def rho(a, b):
    return float(scipy.stats.spearmanr(a, b).statistic)


# --- schema --------------------------------------------------------------------------------------------

def check_schema(r, root, bands):
    band_v, clip_v = (jsonschema.Draft202012Validator(schema(n)) for n in ("band", "clip"))  # compile once
    bad = 0
    for b in bands:
        for e in band_v.iter_errors(b):
            bad += 1
            r.fail(f"schema: data/bands/{b.get('slug')}.json: {e.message}")
    for p in sorted((root / "data" / "clips").glob("*/*.json")):
        for e in clip_v.iter_errors(json.loads(p.read_text())):
            bad += 1
            r.fail(f"schema: {p.relative_to(root)}: {e.message}")
    if not bad:
        r.ok(f"schema: {len(bands)} band records and their clips validate, all carry extractor_version")


# --- fader status ----------------------------------------------------------------------------------------

def check_status(r, live, weights):
    for fid, f in live.items():
        expected = weights["faders"][fid]["expected_status"]
        if f["status"] != expected:
            r.fail(f"status: {fid} is {f['status']}, weights.yaml expects {expected}")
        if f["dropped"]:
            r.info(f"status: {fid} dropped inputs missing for some band: {', '.join(f['dropped'])}")
    if all(f["status"] == weights["faders"][fid]["expected_status"] for fid, f in live.items()):
        r.ok(f"status: all {len(live)} faders match expected_status")


# --- premise gates (audio only) --------------------------------------------------------------------------

def check_gates(r, bands, weights, gt):
    idx = {b["slug"]: i for i, b in enumerate(bands)}
    partial = {b["slug"] for b in bands if b["partial"]}
    meta = weights["metadata_inputs"]
    audio = publish.faders(bands, weights, exclude=meta)
    v = {fid: audio[fid]["values"] for fid in AUDIO_FADERS}

    def evaluable(name, slugs):
        missing = [s for s in slugs if s not in idx or s in partial]
        if missing or any(v[f] is None for f in AUDIO_FADERS):
            r.info(f"{name}: not evaluable ({', '.join(missing) or 'a fader has no audio inputs'})")
            r.not_evaluable.append(name)
            return False
        return True

    print("Premise gates (audio inputs only; metadata inputs zeroed):")
    if evaluable("pole pair, serenity", ["elderwind", "mayhem"]):
        gap = v["serenity"][idx["elderwind"]] - v["serenity"][idx["mayhem"]]
        r.gate("pole pair, serenity", gap >= SERENITY_GAP, f"Elderwind - Mayhem = {gap:.1f} (need >= {SERENITY_GAP})")
    if evaluable("pole pair, aggression", ["anaal-nathrakh", "metallica"]):
        gap = v["aggression"][idx["anaal-nathrakh"]] - v["aggression"][idx["metallica"]]
        r.gate("pole pair, aggression", gap >= AGGRESSION_GAP,
               f"Anaal Nathrakh - Metallica = {gap:.1f} (need >= {AGGRESSION_GAP})")
    if evaluable("brutal cluster spread", CLUSTER):
        ranges = {f: max(v[f][idx[s]] for s in CLUSTER) - min(v[f][idx[s]] for s in CLUSTER) for f in AUDIO_FADERS}
        wide = [f for f, x in ranges.items() if x >= CLUSTER_RANGE]
        r.gate("brutal cluster spread", len(wide) >= CLUSTER_FADERS,
               f"{len(wide)} of {len(AUDIO_FADERS)} faders span >= {CLUSTER_RANGE} (need {CLUSTER_FADERS}): "
               + ", ".join(f"{f} {x:.0f}" for f, x in ranges.items()))

    lufs = [b["features"]["lufs"]["median"] for b in bands]
    year = [b["metadata"]["release_year"] for b in bands]
    no_lufs = publish.faders(bands, weights, exclude=meta + ["lufs"])["aggression"]["values"]
    if no_lufs is not None and v["aggression"] is not None:
        x = rho(no_lufs, lufs)
        r.gate("loudness confound", abs(x) <= RHO_CEILING,
               f"|rho(aggression without lufs, lufs)| = {abs(x):.2f} (need <= {RHO_CEILING})")
        x = rho(v["aggression"], year)
        r.gate("era confound", abs(x) <= RHO_CEILING,
               f"|rho(aggression, release year)| = {abs(x):.2f} (need <= {RHO_CEILING})")
    scored = [s for s in gt if s in idx]
    if len(scored) >= 3:
        g = [gt[s]["aggression"] for s in scored]
        r.info(f"baseline: ground-truth aggression vs lufs rho = {rho(g, [lufs[idx[s]] for s in scored]):.2f}, "
               f"vs release year rho = {rho(g, [year[idx[s]] for s in scored]):.2f} over {len(scored)} bands")
    else:
        r.info("baseline: pending (ground truth not filled in)")


# --- design rules ----------------------------------------------------------------------------------------

def luminance(hex_colour):
    rgb = [int(hex_colour.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a, b):
    la, lb = sorted([luminance(a), luminance(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


def check_packs(r, bands, themes):
    used = {publish.pack_for(b["metadata"]["genre"], themes) for b in bands}
    (r.ok if len(used) >= MIN_PACKS else r.fail)(f"packs: {len(used)} distinct over the pool ({', '.join(sorted(used))}), need {MIN_PACKS}")
    steel = themes["packs"][themes["default"]]
    failing = 0
    for name, p in themes["packs"].items():
        problems = []
        if contrast(p["label"], p["panel"]) < LABEL_CONTRAST:
            problems.append(f"label on panel {contrast(p['label'], p['panel']):.1f}:1 < {LABEL_CONTRAST}")
        if contrast(p["led_on"], p["led_off"]) < LED_CONTRAST:
            problems.append(f"led on/off {contrast(p['led_on'], p['led_off']):.1f}:1 < {LED_CONTRAST}")
        if name != themes["default"]:
            if p["font_display"] == steel["font_display"]:
                problems.append("same display font as steel")
            if p["cap_shape"] == steel["cap_shape"] and p["led_shape"] == steel["led_shape"]:
                problems.append("no shape slot differs from steel")
        for msg in problems:
            r.fail(f"pack {name}: {msg}")
        failing += bool(problems)
    if not failing:
        r.ok(f"packs: all {len(themes['packs'])} pass contrast and the font/shape rule")


def check_shorts(r, pool):
    long = [f"{b['slug']} ({b['short']})" for b in pool if len(b["short"]) > SHORT_MAX]
    (r.fail if long else r.ok)(f"short labels over {SHORT_MAX} characters: {', '.join(long)}" if long
                               else f"short labels: all <= {SHORT_MAX} characters")
    for key in ("slug", "short"):  # tick labels and record paths assume both are unique
        seen, dupes = set(), set()
        for b in pool:
            (dupes if b[key] in seen else seen).add(b[key])
        if dupes:
            r.fail(f"duplicate {key}s in pool.yaml: {', '.join(sorted(map(str, dupes)))}")


def load_ground_truth(root):
    path = root / "data" / "ground-truth.yaml"
    raw = (yaml.safe_load(path.read_text()) or {}).get("bands", {}) if path.exists() else {}
    return {s: v for s, v in (raw or {}).items()
            if isinstance(v, dict) and all(isinstance(v.get(f), (int, float)) for f in AUDIO_FADERS)}


def check_ground_truth(r, bands, live, gt):
    idx = {b["slug"]: i for i, b in enumerate(bands)}
    scored = [s for s in gt if s in idx]
    if len(scored) < 3:
        r.info("ground-truth report: pending (fewer than three scored bands)")
        return
    parts = []
    for f in AUDIO_FADERS:
        if live[f]["values"] is not None:
            parts.append(f"{f} {rho([gt[s][f] for s in scored], [live[f]['values'][idx[s]] for s in scored]):+.2f}")
    r.info(f"ground-truth rho over {len(scored)} bands (live definition): " + ", ".join(parts))


# --- flags -----------------------------------------------------------------------------------------------

def check_flags(r, root, bands):
    skipped_total = skipped_bands = 0
    for b in bands:
        clips = [json.loads((root / "data" / "clips" / f"{c}.json").read_text()) for c in b["clips"]]
        dz = sum(c["source"] == "deezer" for c in clips)
        if clips and dz / len(clips) > 0.5:
            r.warn(f"{b['slug']}: Deezer share {dz}/{len(clips)} over 50 percent (codec mix)", "deezer share")
        late = [c for c in clips if c["itunes_year"] > c["year"] + 2]
        if late:
            r.warn(f"{b['slug']}: {len(late)} clips with an iTunes year more than two after the original "
                   f"({', '.join(sorted({c['album'] for c in late}))})", "reissue year")
        if b["partial"]:
            r.warn(f"{b['slug']}: partial, {len(clips)} clips"
                   + ("; protected band, the gate naming it is not evaluable" if b["slug"] in PROTECTED else ""), "partial")
        if b["sources_failed"]:
            r.warn(f"{b['slug']}: sources failed: {', '.join(b['sources_failed'])}", "source failed")
        fetched = root / "data" / "fetch" / f"{b['slug']}.json"
        if fetched.exists():
            skipped = json.loads(fetched.read_text()).get("unmatched_albums", [])
            skipped_total += len(skipped)
            skipped_bands += bool(skipped)
    if skipped_total:
        r.info(f"{skipped_total} iTunes albums across {skipped_bands} bands matched no full-length and were skipped")


def run(root=ROOT):
    r = Report()
    bands = publish.load_bands(root)
    weights, themes = publish.load_yaml("weights.yaml"), publish.load_yaml("themes.yaml")
    pool = publish.load_yaml("pool.yaml")["bands"]
    gt = load_ground_truth(root)
    print("Records and config:")
    check_schema(r, root, bands)
    check_shorts(r, pool)
    check_packs(r, bands, themes)
    if bands:
        live = publish.faders(bands, weights)
        check_status(r, live, weights)
        check_gates(r, bands, weights, gt)
    print("Ground truth:")
    if bands:
        check_ground_truth(r, bands, live, gt)
        check_flags(r, root, bands)
    if r.warns:
        print("FLAGS")
        kinds = {}
        for kind, msg in r.warns:
            kinds.setdefault(kind, []).append(msg)
        for kind, msgs in kinds.items():  # a count per kind; every line only when there are few
            print(f"  WARN  {kind}: {len(msgs)}")
            for msg in msgs[:FLAG_EXAMPLES]:
                print(f"          {msg}")
            if len(msgs) > FLAG_EXAMPLES:
                print(f"          ... and {len(msgs) - FLAG_EXAMPLES} more")
    verdict = "FAIL" if r.fails else "PASS"
    extra = f"; not evaluable: {', '.join(r.not_evaluable)}" if r.not_evaluable else ""
    print(f"{verdict}: {len(r.fails)} failures, {len(r.warns)} warnings{extra}")
    return r


def main(root=ROOT):
    sys.exit(1 if run(root).fails else 0)
