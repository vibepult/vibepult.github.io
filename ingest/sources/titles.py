"""Title normalisation shared by iTunes album/track dedupe and Metal Archives matching (D4)."""
import difflib
import re
import unicodedata

REISSUE_WORDS = r"\b(remastered|remaster|deluxe|edition|anniversary|expanded|bonus|version|reissue)\b"
VARIANT = re.compile(r"\b(live|demo|remix|rehearsal|instrumental|edit|acoustic|alternate|rough mix)\b", re.I)


def normalise_title(title):
    t = unicodedata.normalize("NFKD", title)
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    t = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", t)
    # "Destroy Erase Improve: 30th Anniversary Edition", "Immutable - The Indelible Edition"
    parts = re.split(r"\s*:\s+|\s+[-–]\s+", t)
    t = " ".join([parts[0]] + [p for p in parts[1:] if not re.search(REISSUE_WORDS, p)])
    t = re.sub(REISSUE_WORDS, " ", t)
    t = re.sub(r"[^\w\s]|_", " ", t)
    return " ".join(t.split())


def match(title, candidates, threshold=0.9):
    """Best candidate whose normalised title equals or is >= threshold similar to title's, else None.
    candidates: dict of normalised title -> value."""
    norm = normalise_title(title)
    if norm in candidates:
        return candidates[norm]
    score, best = max(((difflib.SequenceMatcher(None, norm, c).ratio(), c) for c in candidates),
                      default=(0, None))
    return candidates[best] if score >= threshold else None


def is_variant(track_title):
    """Live, demo, remix and similar takes inside brackets or after a dash."""
    brackets = re.findall(r"[(\[]([^)\]]*)[)\]]", track_title)
    tail = track_title.partition(" - ")[2]
    return bool(VARIANT.search(" ".join(brackets + [tail])))
