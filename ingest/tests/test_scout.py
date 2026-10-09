from ingest import scout

CFG = {"country_cap": 0.5, "known_share": 0.75, "corners": [
    {"id": "atmo", "quota": 2, "keywords": ["atmospheric black"]},
    {"id": "black", "quota": 4, "keywords": ["black metal"]},
    {"id": "thin", "quota": 3, "keywords": ["war metal"]},
]}


def cand(name, genre, links, country="NO", ma=None):
    return {"name": name, "genres": [genre], "sitelinks": links, "country": country, "ma": ma or name, "spotify": name}


def test_first_matching_corner_wins():
    assert scout.corner_of(["Atmospheric Black Metal"], CFG["corners"]) == "atmo"
    assert scout.corner_of(["black metal", "atmospheric black metal"], CFG["corners"]) == "atmo"
    assert scout.corner_of(["jazz"], CFG["corners"]) is None


def test_quota_existing_country_cap_and_spill():
    pool = [cand(f"b{i}", "black metal", 100 - i, country="NO" if i < 5 else "SE") for i in range(10)]
    pool += [cand("w1", "war metal", 5), cand("skip", "black metal", 999, ma="m1")]
    existing = {"ma": {"m1"}, "spotify": set(), "corners": {"black": 1}}
    out = scout.select(pool, CFG, existing)
    picks = [c["name"] for c in out["black"]["picks"]]
    assert "skip" not in picks                                # already in the pool
    assert out["thin"]["short_of"] == 2                        # one war-metal band for a quota of three
    assert len(picks) == 3 + 2                                 # quota 4 minus 1 existing, plus 2 spilled in
    assert sum(c["country"] == "NO" for c in out["black"]["picks"][:3]) <= 2  # cap 0.5 * 4 before spilling
    assert out["black"]["spill"] == 2


def test_slugify():
    assert scout.slugify("Mötley Crüe") == "motley-crue"
    assert scout.slugify("Ænima!!") == "nima"
    assert scout.slugify("???") == "band"
