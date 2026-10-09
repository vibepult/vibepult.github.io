"""Deezer public API (no key): clip fallback by artist + title + duration, and fan count."""
import json
from urllib.parse import quote

from . import http

API = "https://api.deezer.com"


def _json(url):
    """Deezer answers quota and lookup errors with HTTP 200 and an error object; raise so callers retry or record it."""
    data = json.loads(http.get(url))
    if isinstance(data, dict) and "error" in data:
        code = data["error"].get("code") if isinstance(data["error"], dict) else None
        raise http.HTTPError(url, 429 if code == 4 else 404)  # 4 is Deezer's quota code; the rest are lookup misses
    return data


def fans(artist_id):
    return _json(f"{API}/artist/{artist_id}")["nb_fan"]


def pick(results, artist_id, seconds, tolerance=3):
    """First result by this artist with a preview whose duration is within tolerance seconds."""
    for r in results:
        if r["artist"]["id"] == artist_id and r.get("preview") and abs(r["duration"] - seconds) <= tolerance:
            return {"preview": r["preview"], "deezer_id": r["id"]}
    return None


def find(artist_id, artist_name, title, seconds):
    q = quote(f'artist:"{artist_name}" track:"{title}"')
    return pick(_json(f"{API}/search?q={q}&limit=25").get("data", []), artist_id, seconds)
