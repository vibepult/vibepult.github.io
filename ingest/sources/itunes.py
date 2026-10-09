"""iTunes Search API: artist -> albums -> one batched song lookup with preview URLs."""
import json
import re

from . import http
from .titles import is_variant, normalise_title

API = "https://itunes.apple.com/lookup"
ALBUMS_PER_LOOKUP = 12  # a lookup returns at most 200 rows; 12 albums of tracks stay under that
NOT_FULL_LENGTH = re.compile(r"(- single|- ep|\blive\b|box set|best of|greatest hits|collection|anthology"
                             r"|videos|motion picture|soundtrack|tribute|blacklist|demos?\b|remixes)", re.I)


def albums(artist_id):
    """Studio-album candidates, one per normalised title (the edition with the fewest tracks)."""
    rows = json.loads(http.get(f"{API}?id={artist_id}&entity=album&limit=200"))["results"]
    best = {}
    for r in rows:
        if r.get("wrapperType") != "collection" or r.get("artistId") != artist_id:
            continue
        name = r["collectionName"]
        if NOT_FULL_LENGTH.search(name) or not 5 <= r.get("trackCount", 0) <= 25:
            continue
        album = {"id": r["collectionId"], "title": name, "norm": normalise_title(name),
                 "year": int(r["releaseDate"][:4]), "tracks": r["trackCount"]}
        prev = best.get(album["norm"])
        if prev is None or (album["tracks"], album["year"]) < (prev["tracks"], prev["year"]):
            best[album["norm"]] = album
    return sorted(best.values(), key=lambda a: a["year"])


def songs(album_ids):
    """All tracks of the given albums, batched by album (approved D6): one request per ALBUMS_PER_LOOKUP albums,
    because a lookup silently stops at 200 rows."""
    ids, out = list(album_ids), []
    for i in range(0, len(ids), ALBUMS_PER_LOOKUP):
        batch = ",".join(str(x) for x in ids[i:i + ALBUMS_PER_LOOKUP])
        rows = json.loads(http.get(f"{API}?id={batch}&entity=song&limit=200"))["results"]
        out += [{"album_id": r["collectionId"], "title": r["trackName"], "n": r.get("trackNumber", 0),
                 "disc": r.get("discNumber", 1), "ms": r.get("trackTimeMillis", 0), "preview": r.get("previewUrl")}
                for r in rows if r.get("wrapperType") == "track" and r.get("kind") == "song"]
    return out


def select_clips(albums, tracks, min_ms=120_000):
    """Order candidate tracks so any prefix spreads across albums (sorted by year): round-robin,
    middle of each album first. Drops live/demo/remix variants, interludes under min_ms, and repeated
    titles (earliest album wins). The caller takes the first CLIPS_WANTED that download and decode."""
    seen, queues = set(), []
    for album in albums:
        own = [t for t in tracks if t["album_id"] == album["id"] and t["ms"] >= min_ms and not is_variant(t["title"])]
        own.sort(key=lambda t: (t["disc"], t["n"]))
        mid = (len(own) - 1) / 2
        own = [t for _, t in sorted(enumerate(own), key=lambda it: abs(it[0] - mid))]
        queue = []
        for t in own:
            key = normalise_title(t["title"])
            if key not in seen:
                seen.add(key)
                queue.append({**t, "album": album})
        queues.append(queue)
    picks = []
    while any(queues):
        for q in queues:
            if q:
                picks.append(q.pop(0))
    return picks
