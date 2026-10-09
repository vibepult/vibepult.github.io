"""Per-clip work that runs in extraction worker processes. A module of its own because macOS spawns
workers that import their function by module name, which a function in __main__ cannot offer."""
import os
import tempfile
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def download(clip, out_dir):
    """Keep the compressed preview (about 0.5 MB); WAVs are decoded only for the length of an extraction.
    Written whole or not at all, so an interrupted download is fetched again next time."""
    from .sources import http

    src = out_dir / (clip["id"].split("/")[1] + ".src")
    if src.exists() and src.stat().st_size > 0:
        return True
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        body = http.get(clip["preview"])
    except http.HTTPError:
        return False
    if not body:
        return False
    part = src.with_suffix(".part")
    part.write_bytes(body)
    os.replace(part, src)
    return True


def clip_record(job):
    """Worker: preview -> temporary WAV -> features -> clip record, or None if download, decode or analysis fails.
    One odd preview (silence, a truncated file, an HTML error body) must never stop the other 7,000."""
    from . import aggregate, audio

    slug, c = job
    out_dir = DATA / "audio" / slug
    src = out_dir / (c["id"].split("/")[1] + ".src")
    try:
        if not download(c, out_dir):
            return None
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "clip.wav"
            if not audio.decode(src, wav):
                src.unlink(missing_ok=True)  # the decoder ran and refused it: not audio, fetch it again next run
                return None
            features = audio.features(wav)
    except Exception as e:  # noqa: BLE001 - logged by the caller as a dropped clip
        print(f"{c['id']}: dropped ({type(e).__name__}: {e})", flush=True)
        return None
    if not aggregate.finite(features):
        print(f"{c['id']}: dropped (non-finite feature)", flush=True)
        return None
    return {"id": c["id"], "band": slug, "title": c["title"], "source": c["source"], "album": c["album"],
            "year": c["year"], "itunes_year": c["itunes_year"], "year_source": c["year_source"],
            "extractor_version": audio.EXTRACTOR_VERSION, "features": {**features, "song_length": c["song_length"]}}
