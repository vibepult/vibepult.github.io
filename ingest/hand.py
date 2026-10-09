"""Hand scores (features 26 persona, 27 camp) for admitted bands: export the bands that lack them, merge
drafted scores back into pool.yaml. Drafts come from Claude subagents and are spot-checked by the user."""
import json
import re
import sys
from pathlib import Path

from . import __main__ as cli

HERE = Path(__file__).parent

BRIEF = """Score each metal band 0.0 to 1.0, one decimal, on two axes. Use what you know about the band plus the facts given.
persona: stage persona and show. 0 = plain clothes, own names, no stage concept. 0.5 = corpsepaint or a consistent
  image. 1.0 = characters, masks, costumes, lore, stage theatre (Ghost, King Diamond, GWAR, Lordi).
camp: self-aware theatrical excess and humour in the image and lyrics. 0 = wholly sincere (Meshuggah, Agalloch).
  1.0 = knowingly over the top (Ghost, Alestorm, Rhapsody of Fire, Steel Panther). Gore alone is not camp.
Reference points already scored: Mayhem 0.8/0.2, Iron Maiden 0.6/0.5, Cannibal Corpse 0.3/0.4, Metallica 0.1/0.1,
Rammstein 0.8/0.8, Nightwish 0.4/0.4. If you do not know a band, score from genre and themes and set "known": false.
Reply with JSON only: {"<slug>": {"persona": 0.0, "camp": 0.0, "known": true}, ...} for every slug given."""


def missing(root=cli.ROOT):
    out = []
    for b in cli.pool():
        if b.get("hand"):
            continue
        meta = json.loads((root / "data" / "fetch" / f"{b['slug']}.json").read_text())["metadata"]
        out.append({"slug": b["slug"], "name": b["name"], "genre": meta["genre"], "country": meta["country"],
                    "formed": meta["formed"], "themes": meta.get("themes", "")})
    return out


def merge(drafts, pool_path=HERE / "pool.yaml"):
    """drafts: {slug: {"persona": x, "camp": y}}. Writes hand: {...} into each admitted band's pool.yaml line."""
    text = pool_path.read_text()
    done = 0
    for slug, d in drafts.items():
        p, c = float(d["persona"]), float(d["camp"])
        if not (0 <= p <= 1 and 0 <= c <= 1):
            raise ValueError(f"{slug}: scores outside 0..1: {d}")
        m = re.search(rf"^(  - \{{.*\bslug: '?{re.escape(slug)}'?(?=[,}}])[^\n]*?)\}}$", text, re.M)  # '1349' is quoted
        if not m or "hand:" in m.group(1):
            continue  # not a one-line admitted entry, or already scored
        text = text[:m.start()] + f"{m.group(1)}, hand: {{persona: {p:.1f}, camp: {c:.1f}}}}}" + text[m.end():]
        done += 1
    pool_path.write_text(text)
    return done


def main(argv):
    if argv[:1] == ["export"]:
        print(json.dumps(missing(), ensure_ascii=False, indent=1))
    elif argv[:1] == ["merge"]:
        drafts = {}
        for path in argv[1:]:
            drafts.update(json.loads(Path(path).read_text()))
        print(f"merged {merge(drafts)} drafts into pool.yaml")
    elif argv[:1] == ["brief"]:
        print(BRIEF)
    else:
        sys.exit("python -m ingest hand export | brief | merge <drafts.json>...")
