from pathlib import Path

import pytest

from ingest.sources import deezer, http, itunes, metal_archives
from ingest.sources.titles import is_variant, match, normalise_title

FIX = Path(__file__).parent / "fixtures"


@pytest.mark.parametrize("raw,norm", [
    ("Ride the Lightning (Remastered) [2016 Remastered Version]", "ride the lightning"),
    ("Hardwired…To Self-Destruct (Deluxe Edition)", "hardwired to self destruct"),
    ("Destroy Erase Improve: 30th Anniversary Edition (2026 Remastered)", "destroy erase improve"),
    ("Immutable - The Indelible Edition", "immutable"),
    ("Sehnsüchte Expanded Bonus Version", "sehnsuchte"),
    ("Reise, Reise", "reise reise"),
])
def test_normalise_title(raw, norm):
    assert normalise_title(raw) == norm


def test_match_threshold():
    cands = {"de mysteriis dom sathanas": 1, "chimera": 2}
    assert match("De Mysteriis Dom Sathanas (Remastered)", cands) == 1
    assert match("De Mysteriis Dom Satanas", cands) == 1  # ratio about 0.98
    assert match("Chimaera Live", cands) is None


def test_variants_dropped():
    assert is_variant("Battery (Live)") and is_variant("One - Live at Wembley") and is_variant("X [Demo]")
    assert not is_variant("Orion (Remastered)") and not is_variant("Fade to Black")


def test_select_clips_round_robin_and_dedupe():
    albums = [{"id": 1, "title": "A", "year": 1990}, {"id": 2, "title": "B", "year": 1995}]
    t = lambda a, n, title, ms=200_000: {"album_id": a, "n": n, "disc": 1, "title": title, "ms": ms, "preview": "u"}
    tracks = [t(1, 1, "Intro", 60_000), t(1, 2, "One"), t(1, 3, "Two"), t(1, 4, "Three"),
              t(2, 1, "One (Remastered)"), t(2, 2, "Four"), t(2, 3, "Five (Live)")]
    picks = itunes.select_clips(albums, tracks)
    assert [p["title"] for p in picks] == ["Two", "Four", "One", "Three"]  # middle first, alternating albums


def test_deezer_duration_window():
    r = lambda d: {"artist": {"id": 9}, "preview": "p", "duration": d, "id": d}
    assert deezer.pick([r(203)], 9, 200)["deezer_id"] == 203
    assert deezer.pick([r(204)], 9, 200) is None
    assert deezer.pick([{**r(200), "artist": {"id": 8}}], 9, 200) is None


def test_metal_archives_parse():
    m = metal_archives.parse_band((FIX / "ma_band.html").read_text())
    assert m == {"genre": "Black Metal", "country": "NO", "formed": 1984, "split": 2011, "status": "split-up",
                 "members": 2, "past_members": 1, "themes": "Satanism, Death"}
    albums = metal_archives.parse_discography((FIX / "ma_discography.html").read_text())
    kept, unmatched = metal_archives.albums_with_years(
        [{"id": 1, "title": "De Mysteriis Dom Sathanas (Remastered)", "year": 2011},
         {"id": 2, "title": "Deathcrush", "year": 2008},
         {"id": 3, "title": "The Colder the Night", "year": 2018},
         {"id": 4, "title": "Live in Leipzig", "year": 1993}], albums)
    assert [(a["id"], a["year"], a["itunes_year"]) for a in kept] == [(1, 1994, 2011), (3, 2018, 2018)]
    assert unmatched == ["Live in Leipzig"]


def test_throttled_get_spacing_and_backoff(monkeypatch):
    clock = {"t": 0.0}
    sleeps = []

    def sleep(s):
        sleeps.append(round(s, 2))
        clock["t"] += s

    replies = iter([(429, b""), (403, b""), (200, b"ok"), (200, b"again")])
    monkeypatch.setattr(http, "_last", {})
    kw = dict(sleep=sleep, now=lambda: clock["t"], fetch=lambda url: next(replies))
    assert http.get("https://itunes.apple.com/x", **kw) == b"ok"
    assert http.get("https://itunes.apple.com/y", **kw) == b"again"
    # backoff 10 then 20 after the 429 and 403, each retry still waits out the 3.5 s spacing; then spacing again
    assert sleeps == [10.0, 20.0, 3.5]


def test_throttled_get_gives_up_after_three(monkeypatch):
    monkeypatch.setattr(http, "_last", {})
    with pytest.raises(http.HTTPError) as e:
        http.get("https://api.deezer.com/x", sleep=lambda s: None, now=lambda: 0.0, fetch=lambda u: (429, b""))
    assert e.value.status == 429


def test_split_year_only_for_split_bands_and_never_before_the_last_album():
    albums = [{"type": "Full-length", "year": 2004}, {"type": "Full-length", "year": 2013}, {"type": "Live album", "year": 2026}]
    fix = lambda status, split: metal_archives.fix_split({"status": status, "split": split, "albums": albums})["split"]
    assert fix("on hold", 1999) is None          # Turisas: "Years active" ended in a bare start year
    assert fix("split-up", 2005) == 2013         # Ithilien: split no earlier than the last studio album
    assert fix("split-up", 2015) == 2015         # Motorhead: a posthumous live album does not move it
    assert metal_archives.fix_split({"status": "split-up", "split": None, "albums": []})["split"] is None


def test_404_raises_at_once_without_sleeping(monkeypatch):
    monkeypatch.setattr(http, "_last", {})
    calls, sleeps = [], []
    with pytest.raises(http.HTTPError) as e:
        http.get("https://x.example/a", sleep=sleeps.append, now=lambda: 0.0, fetch=lambda u: (calls.append(u), (404, b""))[1])
    assert e.value.status == 404 and len(calls) == 1 and sleeps == []


def test_curl_failure_is_a_retryable_http_error(monkeypatch):
    """A DNS blip or reset comes back as status 0: retried like a 429, then HTTPError, never a subprocess exception."""
    monkeypatch.setattr(http, "_last", {})
    replies = iter([(0, b""), (200, b"ok")])
    assert http.get("https://x.example/a", sleep=lambda s: None, now=lambda: 0.0, fetch=lambda u: next(replies)) == b"ok"
    with pytest.raises(http.HTTPError) as e:
        http.get("https://x.example/b", sleep=lambda s: None, now=lambda: 0.0, fetch=lambda u: (0, b""))
    assert e.value.status == 0
    assert http._curl("https://nonexistent.invalid.example/")[0] == 0  # the real curl, failing to resolve


def test_deezer_error_body_is_an_http_error(monkeypatch):
    monkeypatch.setattr(http, "get", lambda url: b'{"error": {"type": "Exception", "code": 4, "message": "Quota limit exceeded"}}')
    with pytest.raises(http.HTTPError) as e:
        deezer.fans(1)
    assert e.value.status == 429 and e.value.transient
    monkeypatch.setattr(http, "get", lambda url: b'{"data": []}')
    assert deezer.find(1, "a", "b", 200) is None


def test_songs_lookup_is_chunked_under_the_200_row_cap(monkeypatch):
    urls = []
    monkeypatch.setattr(http, "get", lambda u: (urls.append(u), b'{"results": []}')[1])
    assert itunes.songs(range(25)) == []
    assert len(urls) == 3 and urls[0].count(",") == itunes.ALBUMS_PER_LOOKUP - 1


def test_transient_errors_stop_admit_instead_of_rejecting(monkeypatch):
    from ingest import admit
    assert http.HTTPError("u", 0).transient and http.HTTPError("u", 429).transient and http.HTTPError("u", 503).transient
    assert not http.HTTPError("u", 404).transient
    writes = []
    monkeypatch.setattr(admit, "write_log", writes.append)
    monkeypatch.setattr(admit, "try_candidate", lambda c, t: (_ for _ in ()).throw(http.HTTPError("u", 403)))
    with pytest.raises(SystemExit):
        admit.decide({"slug": "x"}, "corner", {}, set(), set())
    assert writes == []  # nothing logged: the candidate is retried next run
    monkeypatch.setattr(admit, "try_candidate", lambda c, t: (_ for _ in ()).throw(http.HTTPError("u", 404)))
    log = {}
    assert admit.decide({"slug": "x"}, "corner", log, set(), set()) is False
    assert log["x"]["status"] == "rejected" and writes
