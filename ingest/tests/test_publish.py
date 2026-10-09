from ingest import publish


def test_percentile_formula_with_average_ties():
    assert publish.percentiles([10, 20, 30]) == [0, 50, 100]
    assert publish.percentiles([1, 1, 2]) == [25, 25, 100]  # ranks 1.5, 1.5, 3 over n-1 = 2
    assert publish.percentiles([7]) == [50.0]


def test_pool_wide_drop_and_renormalisation():
    pct = {"a": [0, 50, 100], "b": [100, 50, 0]}
    values, status, dropped = publish.blend(pct, {"a": 2.0, "missing": 1.0})
    assert (values, status, dropped) == ([0, 50, 100], "live", ["missing"])
    values, status, _ = publish.blend(pct, {"a": 1.0, "missing": 2.0})  # under half the mass present
    assert values is None and status == "bypassed"
    values, _, _ = publish.blend(pct, {"a": 1.0, "b": -1.0})  # negative weight flips direction, re-ranked
    assert values == [0, 50, 100]


def test_input_missing_for_one_band_is_dropped_for_all():
    def band(extra):
        b = {"features": {"lufs": {"median": 1, "iqr": 0}}, "metadata": {"vocals": "harsh", "themes": ""}, "hand": {"persona": 0, "camp": 0}}
        if extra:
            b["hand"]["ttr"] = 0.5
        return b
    pct = publish.input_percentiles([band(True), band(False), band(True)])
    assert "ttr" not in pct and "lufs" in pct


# Metal Archives genre strings as scraped on 2026-10-05 (Rammstein hand-entered).
POOL_GENRES = {
    "elderwind": "Atmospheric Black Metal", "agalloch": "Atmospheric Folk/Doom/Black Metal, Post-Rock/Metal",
    "mayhem": "Black Metal", "cannibal-corpse": "Death Metal", "candlemass": "Epic Doom Metal",
    "black-sabbath": "Heavy/Doom Metal", "rammstein": "Industrial Metal, Neue Deutsche Härte",
    "nightwish": "Symphonic Power Metal (early); Symphonic Metal (later)",
    "metallica": "Thrash Metal (early); Hard Rock (mid); Heavy/Thrash Metal (later)",
    "meshuggah": "Technical Groove/Thrash Metal (early); Djent (later)", "iron-maiden": "Heavy Metal, NWOBHM",
    "ghost": "Heavy Metal, Rock", "lamb-of-god": "Groove Metal/Metalcore",
}


def test_theme_mapping_gives_eight_packs_over_the_pool():
    themes = publish.load_yaml("themes.yaml")
    packs = {slug: publish.pack_for(g, themes) for slug, g in POOL_GENRES.items()}
    assert packs["meshuggah"] == "prog" and packs["metallica"] == "thrash" and packs["agalloch"] == "folk"
    assert packs["rammstein"] == "industrial" and packs["iron-maiden"] == "steel" and packs["lamb-of-god"] == "steel"
    assert len(set(packs.values()) - {"steel"}) == 8  # Agalloch is folk since earliest mention wins (2026-10-07)


def test_quintile_ticks_from_thirty_bands():
    labels = [{"slug": f"b{i:02}", "short": f"b{i}", "name": f"b{i}"} for i in range(30)]
    values = publish.percentiles(list(range(30)))
    ticks = publish.ticks(values, labels)
    assert [t["name"] for t in ticks] == ["b0", "b7", "b14", "b22", "b29"]  # nearest to 0, 25, 50, 75, 100


def test_new_families_map_into_existing_packs():
    themes = publish.load_yaml("themes.yaml")
    cases = {"Grindcore": "death", "Gothic/Doom Metal": "doom", "Sludge Metal": "doom", "Drone": "doom",
             "Celtic Folk Metal": "folk", "Neo-classical Metal": "power", "Avant-garde Metal": "prog",
             "Post-Metal": "steel", "Atmospheric Sludge/Black Metal": "doom"}
    assert {g: publish.pack_for(g, themes) for g in cases} == cases


def test_crossover_packs_follow_the_order_the_genre_string_names_them():
    themes = publish.load_yaml("themes.yaml")
    assert publish.packs_for("Progressive/Groove/Death Metal", themes) == ["prog", "death"]  # Gojira: not death first
    assert publish.packs_for("Death/Doom Metal (early); Atmospheric Progressive Rock (later)", themes) == ["death", "doom", "prog"]
    assert publish.packs_for("Heavy Metal, NWOBHM", themes) == []


def test_blend_exclude_removes_mass_from_both_sides():
    pct = {"a": [0, 50, 100], "b": [100, 50, 0]}
    values, status, _ = publish.blend(pct, {"a": 1.0, "b": 1.0}, exclude=("b",))
    assert (values, status) == ([0, 50, 100], "live")


def test_knob_ranges_reach_every_band():
    def rec(slug, formed, fans, members, past=0):
        return {"slug": slug, "name": slug, "ids": {"spotify": "x"}, "hand": {"persona": 0, "camp": 0},
                "features": {"lufs": {"median": 1, "iqr": 0}},
                "metadata": {"formed": formed, "split": None, "fans": fans, "members": members, "full_lengths": 1,
                             "genre": "Heavy Metal", "country": "DE", "status": "active", "instrumental": False,
                             "past_members": past, "vocals": "clean", "themes": ""}}
    bands = [rec("scorpions", 1964, 50, 5, past=20), rec("new", 2010, 10 ** 6, 0), rec("mid", 1990, 10 ** 4, 4)]
    pool = [{"slug": b["slug"], "short": b["slug"][:9], "name": b["slug"], "spotify": "x"} for b in bands] + [{"slug": "gone", "short": "Gone"}]
    out = publish.build(bands, pool, {"faders": {"x": {"label": "X", "group": "audio", "weights": {"lufs": 1.0}, "expected_status": "live"}}},
                        publish.load_yaml("themes.yaml"), {"war": {"label": "War", "keys": ["war"]}})
    knobs = {k["id"]: k for k in out["knobs"]}
    assert out["lyrics"]["options"] == [{"id": "war", "label": "War"}] and out["bands"][0]["lyrics"] == []
    assert knobs["era"]["min"] == 1960 and knobs["era"]["detents"][0] == 1960
    assert set(knobs) == {"era", "prolific"} and out["bands"][0]["fans"] == 50  # Fans and Band size dropped 2026-10-07
    assert len(out["bands"]) == 3  # a pool entry without a record is fine; a record without a pool entry is skipped
    assert [s["id"] for s in out["switches"]] == ["stable"]  # every band is active and none instrumental: dead switches dropped
    assert set(out["bands"][0]["switches"]) == {"stable"}


def test_pool_yaml_wins_for_hand_edited_fields():
    rec = {"slug": "a", "name": "Old", "ids": {"itunes": 1, "deezer": 2, "spotify": "old"}, "hand": {"persona": 0, "camp": 0}}
    pool = [{"slug": "a", "name": "New", "spotify": "new", "hand": {"persona": 0.9, "camp": 0.1}}]
    (b,) = publish.with_pool([rec, {**rec, "slug": "gone"}], pool)
    assert (b["name"], b["ids"]["spotify"], b["hand"], b["ids"]["itunes"]) == ("New", "new", {"persona": 0.9, "camp": 0.1}, 1)


def test_lyric_axes_match_substrings_strip_era_markers_and_skip_na():
    axes = {"occult": {"keys": ["satan", "anti-christ"]}, "nature": {"keys": ["nature", "winter"]}, "war": {"keys": ["war"]}}
    assert publish.lyric_axes("Satanism, Anti-Christianity, Darkness, Death", axes) == ["occult"]
    assert publish.lyric_axes("Nature (early); War, Winter (later)", axes) == ["nature", "war"]
    assert publish.lyric_axes("N/A", axes) == []
    assert publish.lyric_axes("", axes) == []
