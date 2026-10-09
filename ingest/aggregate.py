"""Per-clip records -> one per-band record: median and IQR per feature, partial flag, metadata."""
import json
import math
import os
from pathlib import Path

import jsonschema
import numpy as np

from .audio import EXTRACTOR_VERSION, FEATURES

SCHEMA = Path(__file__).parent / "schema"
CLIP_FEATURES = FEATURES + ["song_length"]
BAND_FEATURES = CLIP_FEATURES + ["vocal_presence"]
# A fifth of all previews are the first 30 s of the track, an instrumental intro in metal (Metallica: 10 of 12),
# so a clip without a voice says nothing about the voice: the vocal features are aggregated over the clips that
# have one, and vocal_presence is the share of clips that do. Under this stem energy share the stem is silence.
VOCAL_MIN_SHARE = 0.02
VOCAL_FEATURES = ["vocal_share", "vocal_voiced"]
METADATA = ["formed", "split", "country", "status", "members", "past_members", "full_lengths", "genre",
            "vocals", "instrumental", "fans", "themes"]


def schema(name):
    s = json.loads((SCHEMA / f"{name}.json").read_text())
    s["properties"]["features"]["required"] = BAND_FEATURES if name == "band" else CLIP_FEATURES  # one source: audio.FEATURES
    return s


def write_json(path, obj):
    """Records are written whole or not at all (temp file + rename) and never carry NaN or infinity."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1, ensure_ascii=False, allow_nan=False))
    os.replace(tmp, path)


def finite(features):
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in features.values())


def band_record(cfg, fetched, clips, clips_min=8):
    """cfg: the pool.yaml entry; fetched: data/fetch/<slug>.json; clips: clip records that decoded (at least one)."""
    if not clips:
        raise ValueError(f"{cfg['slug']}: no decoded clips, no band record")
    values = {k: np.array([c["features"][k] for c in clips]) for k in CLIP_FEATURES}
    voiced = [c for c in clips if c["features"]["vocal_share"] >= VOCAL_MIN_SHARE]
    for k in VOCAL_FEATURES:
        values[k] = np.array([c["features"][k] for c in voiced]) if voiced else np.zeros(1)
    values["vocal_presence"] = np.array([len(voiced) / len(clips)])
    q = {k: np.percentile(v, [25, 50, 75]) for k, v in values.items()}
    meta = {k: fetched["metadata"][k] for k in METADATA}
    meta["release_year"] = int(np.median([c["year"] for c in clips]))
    return {
        "slug": cfg["slug"],
        "name": cfg["name"],
        "extractor_version": EXTRACTOR_VERSION,
        "ids": {"itunes": cfg["itunes"], "deezer": cfg["deezer"], "spotify": cfg["spotify"]},
        "metadata": meta,
        "partial": len(clips) < clips_min,
        "clips": [c["id"] for c in clips],
        "features": {k: {"median": float(v[1]), "iqr": float(v[2] - v[0])} for k, v in q.items()},
        "hand": cfg["hand"],
        "sources_failed": fetched["sources_failed"],
    }


def validate(record, name):
    jsonschema.validate(record, schema(name))
