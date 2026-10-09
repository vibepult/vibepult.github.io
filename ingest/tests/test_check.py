import json

import pytest

from ingest import check, publish

WEIGHTS = publish.load_yaml("weights.yaml")
THEMES = publish.load_yaml("themes.yaml")
SLUGS = ["elderwind", "mayhem", "anaal-nathrakh", "metallica", "gorgoroth", "cannibal-corpse", "x1", "x2"]


def band(slug, lufs=-8.0, year=2000, partial=False):
    return {"slug": slug, "partial": partial, "features": {"lufs": {"median": lufs, "iqr": 1}},
            "metadata": {"release_year": year, "genre": "Black Metal"}}


def fake_faders(values, aggression_without_lufs=None):
    """Monkeypatch target: every audio fader takes `values[fader]` (aligned with SLUGS)."""
    def faders(bands, weights, exclude=()):
        out = {f: {"values": values.get(f, list(range(len(bands)))), "status": "live", "dropped": []}
               for f in check.AUDIO_FADERS}
        if "lufs" in exclude and aggression_without_lufs is not None:
            out["aggression"]["values"] = aggression_without_lufs
        return out
    return faders


def run_gates(monkeypatch, values, bands=None, gt=None, **kw):
    monkeypatch.setattr(publish, "faders", fake_faders(values, **kw))
    r = check.Report()
    check.check_gates(r, bands or [band(s, lufs=-8 - i, year=1990 + (i * 7) % 30) for i, s in enumerate(SLUGS)],
                      WEIGHTS, gt or {})
    return r


#                elder may  anaal metal gorg cann x1 x2
PASSING = {
    "serenity":   [100,  10,  20,   60,   30,  0,   50, 40],
    "aggression": [0,    70,  100,  30,   80,  90,  20, 40],
    "darkness":   [10,   100, 60,   20,   90,  40,  0,  50],
    "rawness":    [20,   100, 50,   0,    90,  30,  60, 10],
}


def test_gates_pass_on_constructed_percentiles(monkeypatch, capsys):
    r = run_gates(monkeypatch, PASSING, aggression_without_lufs=[0, 50, 100, 20, 10, 90, 60, 30])
    assert r.fails == [], r.fails
    out = capsys.readouterr().out
    assert "baseline: pending" in out


def test_pole_pair_fails(monkeypatch):
    values = {**PASSING, "serenity": [50, 20, 0, 0, 0, 0, 0, 0]}  # gap 30 < 40
    r = run_gates(monkeypatch, values)
    assert any("serenity" in f for f in r.fails)


def test_cluster_collapse_fails(monkeypatch):
    flat = [0, 50, 52, 0, 54, 56, 0, 0]  # the four brutal bands within 6 points everywhere
    values = {f: flat for f in check.AUDIO_FADERS}
    values["serenity"] = [100, 50, 52, 0, 54, 56, 0, 0]
    values["aggression"] = [0, 50, 100, 0, 54, 56, 0, 0]  # spans 50 on one fader only
    r = run_gates(monkeypatch, values)
    assert any("cluster" in f for f in r.fails)


def test_loudness_and_era_confounds_fail(monkeypatch):
    bands = [band(s, lufs=-20 + i, year=1980 + i) for i, s in enumerate(SLUGS)]
    mono = list(range(8))
    r = run_gates(monkeypatch, {**PASSING, "aggression": mono}, bands=bands, aggression_without_lufs=mono)
    assert any("loudness" in f for f in r.fails) and any("era" in f for f in r.fails)


def test_protected_partial_is_not_evaluable(monkeypatch):
    bands = [band(s, partial=(s == "mayhem")) for s in SLUGS]
    r = run_gates(monkeypatch, PASSING, bands=bands)
    assert "pole pair, serenity" in r.not_evaluable and "brutal cluster spread" in r.not_evaluable


def test_baseline_printed_with_ground_truth(monkeypatch, capsys):
    gt = {s: {f: 10 * i for f in check.AUDIO_FADERS} for i, s in enumerate(SLUGS)}
    run_gates(monkeypatch, PASSING, gt=gt)
    assert "baseline: ground-truth aggression vs lufs rho = -1.00" in capsys.readouterr().out


def test_pack_rules():
    r = check.Report()
    check.check_packs(r, [{"metadata": {"genre": g}} for g in
                          ["black", "death", "doom", "industrial", "power", "thrash", "djent"]], THEMES)
    assert r.fails == []
    bad = json.loads(json.dumps(THEMES))
    bad["packs"]["black"]["label"] = "#202020"                      # label on panel under 4.5:1
    bad["packs"]["death"]["led_on"] = bad["packs"]["death"]["led_off"]  # LEDs indistinguishable
    bad["packs"]["doom"].update(font_display=bad["packs"]["steel"]["font_display"])
    bad["packs"]["prog"].update(cap_shape="rect", led_shape="round")  # no shape change from steel
    r = check.Report()
    check.check_packs(r, [{"metadata": {"genre": "steel"}}], bad)
    joined = " | ".join(r.fails)
    for needle in ("packs: 1 distinct", "pack black: label", "pack death: led", "pack doom: same display font",
                   "pack prog: no shape"):
        assert needle in joined


def test_short_label_over_nine_fails():
    r = check.Report()
    check.check_shorts(r, [{"slug": "candlemass", "short": "Candlemass"}, {"slug": "ok", "short": "Ok"}])
    assert len(r.fails) == 1


def test_status_mismatch_fails():
    r = check.Report()
    live = {f: {"status": "live", "dropped": []} for f in WEIGHTS["faders"]}
    live["grandeur"]["status"] = "bypassed"
    check.check_status(r, live, WEIGHTS)
    assert r.fails == ["status: grandeur is bypassed, weights.yaml expects live"]


def test_flags_are_warnings(tmp_path):
    clips = tmp_path / "data" / "clips" / "b"
    clips.mkdir(parents=True)
    for i, (src, it_year) in enumerate([("deezer", 1990), ("deezer", 2016), ("itunes", 1990)]):
        (clips / f"1-{i}.json").write_text(json.dumps({"source": src, "itunes_year": it_year, "year": 1990, "album": "A"}))
    b = {"slug": "b", "clips": [f"b/1-{i}" for i in range(3)], "partial": True, "sources_failed": ["deezer"]}
    r = check.Report()
    check.check_flags(r, tmp_path, [b])
    assert r.fails == [] and len(r.warns) == 4  # deezer share, late iTunes year, partial, source failed


def test_exit_codes(monkeypatch):
    for fails, code in ((["x"], 1), ([], 0)):
        rep = check.Report()
        rep.fails, rep.warns = fails, ["w"]
        monkeypatch.setattr(check, "run", lambda root=None, rep=rep: rep)
        with pytest.raises(SystemExit) as e:
            check.main()
        assert e.value.code == code


def test_duplicate_slug_or_short_fails():
    r = check.Report()
    check.check_shorts(r, [{"slug": "a", "short": "A"}, {"slug": "b", "short": "A"}, {"slug": "b", "short": "B"}])
    assert sorted(r.fails) == ["duplicate shorts in pool.yaml: A", "duplicate slugs in pool.yaml: b"]
