"""python -m ingest scout|admit|hand|fetch|extract|publish|check [band] [--no-audio]"""
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
POOL = Path(__file__).parent / "pool.yaml"
CLIPS_WANTED = 12
CLIPS_MIN = 8
WORKERS = int(os.environ.get("WORKERS", 0)) or max(1, (os.cpu_count() or 2) - 2)  # WORKERS=15 oversubscribes on purpose


def pool():
    return yaml.safe_load(POOL.read_text())["bands"]


def fetch(band, audio=True, meta=None, itunes_albums=None):
    """Clip manifest -> data/fetch/<slug>.json; with audio, the compressed previews -> data/audio/<slug>/*.src.
    meta and itunes_albums may be passed in when the caller (admission) already fetched them."""
    from . import aggregate, clips_
    from .sources import deezer, http, itunes, metal_archives

    failed = []
    meta = dict(meta or band.get("metadata") or metal_archives.band(band["ma"]))
    # feature 17 is a subgenre prior: Metal Archives lineup roles do not say harsh or clean
    meta["vocals"] = band.get("vocals") or meta.get("vocals") or (
        "harsh" if any(k in meta["genre"].lower() for k in ("black", "death", "grind", "djent")) else "clean")
    meta["instrumental"] = "instrumental" in meta["genre"].lower()
    meta["full_lengths"] = sum(a["type"] == "Full-length" for a in meta["albums"])
    try:
        meta["fans"] = deezer.fans(band["deezer"])
    except http.HTTPError:
        meta["fans"], failed = 0, failed + ["deezer"]

    albums, unmatched = metal_archives.albums_with_years(itunes_albums or itunes.albums(band["itunes"]), meta["albums"],
                                                         "hand" if band.get("metadata") else "metal-archives")
    tracks = itunes.songs([a["id"] for a in albums])
    out_dir = DATA / "audio" / band["slug"]
    clips = []
    for t in itunes.select_clips(albums, tracks):
        if len(clips) == CLIPS_WANTED:
            break
        source, url = "itunes", t["preview"]
        if not url:
            try:
                hit = deezer.find(band["deezer"], band["name"], t["title"], t["ms"] / 1000)
            except http.HTTPError as e:
                if e.transient:
                    raise
                hit = None
            if not hit:
                continue
            source, url = "deezer", hit["preview"]
        a = t["album"]
        clip = {"id": f"{band['slug']}/{a['id']}-{t['disc'] * 100 + t['n']}", "title": t["title"],
                "album": a["title"], "album_id": a["id"], "year": a["year"], "itunes_year": a["itunes_year"],
                "year_source": a["year_source"], "source": source, "song_length": t["ms"] / 1000, "preview": url}
        if audio and not clips_.download(clip, out_dir):
            continue  # dropped; counts toward the eight-clip minimum like any missing clip
        clips.append(clip)

    record = {"slug": band["slug"], "metadata": meta, "clips": clips, "unmatched_albums": unmatched,
              "sources_failed": failed}
    aggregate.write_json(DATA / "fetch" / f"{band['slug']}.json", record)
    deezer_n = sum(c["source"] == "deezer" for c in clips)
    print(f"{band['slug']:18} {len(clips):2} clips ({deezer_n} deezer) from {len({c['album_id'] for c in clips})}"
          f" albums, {len(unmatched)} unmatched albums skipped"
          f"{'  PARTIAL' if len(clips) < CLIPS_MIN else ''}", flush=True)
    return record


def extract(bands):
    """Per-clip features in parallel (a clip record at the current extractor_version is never recomputed),
    then one band record per band. Clips that fail to download or decode are dropped and count toward
    the minimum. Clips are extracted for every band; a band without drafted hand scores gets its band
    record once it has them."""
    from . import aggregate, audio, clips_

    if not Path(audio.AFCONVERT).exists():
        sys.exit(f"{audio.AFCONVERT} not found: decoding is macOS only for now")
    fetched = {b["slug"]: json.loads((DATA / "fetch" / f"{b['slug']}.json").read_text()) for b in bands}

    def cached(c):
        path = DATA / "clips" / f"{c['id']}.json"
        try:
            rec = json.loads(path.read_text()) if path.exists() else None
        except json.JSONDecodeError:  # a record cut short by an interrupted run is recomputed
            return None
        return rec if rec and rec["extractor_version"] == audio.EXTRACTOR_VERSION else None

    jobs = [(b["slug"], c) for b in bands for c in fetched[b["slug"]]["clips"] if not cached(c)]
    print(f"{len(jobs)} clips to extract on {WORKERS} workers", flush=True)
    with ProcessPoolExecutor(WORKERS) as pool_:
        for (slug, c), rec in zip(jobs, pool_.map(clips_.clip_record, jobs, chunksize=4)):
            if rec is None:
                continue
            aggregate.validate(rec, "clip")
            aggregate.write_json(DATA / "clips" / f"{c['id']}.json", rec)

    for b in bands:
        if not b.get("hand"):
            print(f"{b['slug']:18} clips done; band record waits for hand scores (persona, camp)", flush=True)
            continue
        clips = [r for r in map(cached, fetched[b["slug"]]["clips"]) if r]
        if not clips:
            print(f"{b['slug']:18} no clip decoded; no band record", flush=True)
            continue
        record = aggregate.band_record(b, fetched[b["slug"]], clips, CLIPS_MIN)
        aggregate.validate(record, "band")
        aggregate.write_json(DATA / "bands" / f"{b['slug']}.json", record)
        print(f"{b['slug']:18} {len(clips):2} clips{'  PARTIAL' if record['partial'] else ''}", flush=True)


def main(argv):
    cmd, rest = argv[0], argv[1:]
    only = [a for a in rest if not a.startswith("--")]
    bands = [b for b in pool() if not only or b["slug"] in only]
    if cmd == "fetch":
        for b in bands:
            fetch(b, audio="--no-audio" not in rest)
    elif cmd == "extract":
        extract(bands)
    elif cmd == "hand":
        from . import hand
        hand.main(rest)
    elif cmd == "admit":
        from . import admit
        admit.main(only)
    elif cmd == "scout":
        from . import scout
        scout.main()
    elif cmd == "publish":
        from . import publish
        publish.main()
    elif cmd == "check":
        from . import check
        check.main()
    else:
        sys.exit(f"unknown command {cmd}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["check"])
