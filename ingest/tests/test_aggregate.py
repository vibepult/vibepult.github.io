import copy

import jsonschema
import pytest

from ingest import aggregate
from ingest.aggregate import BAND_FEATURES

CFG = {"slug": "mayhem", "name": "Mayhem", "itunes": 1, "deezer": 2, "spotify": "0dR10i73opHXuRuLbgxltM",
       "hand": {"persona": 0.8, "camp": 0.2}}
FETCHED = {"metadata": {"formed": 1984, "split": None, "country": "NO", "status": "active", "members": 5,
                        "past_members": 15, "full_lengths": 7, "genre": "Black Metal", "vocals": "harsh",
                        "instrumental": False, "fans": 84755, "themes": "Satanism, Death"}, "sources_failed": []}


def clip(i, value, year=1994):
    return {"id": f"mayhem/1-{i}", "band": "mayhem", "title": "t", "source": "itunes", "album": "a", "year": year,
            "itunes_year": year, "year_source": "metal-archives", "extractor_version": "0.1.0",
            "features": {k: float(value) for k in BAND_FEATURES}}


def test_median_iqr_and_release_year():
    clips = [clip(i, v, y) for i, (v, y) in enumerate(zip([1, 2, 3, 4, 5, 6, 7, 8, 9], [1994] * 5 + [2004] * 4))]
    r = aggregate.band_record(CFG, FETCHED, clips)
    assert r["features"]["lufs"] == {"median": 5.0, "iqr": 4.0}
    assert r["metadata"]["release_year"] == 1994 and r["partial"] is False
    aggregate.validate(r, "band")


def test_vocal_features_ignore_clips_without_a_voice():
    """Ten intro previews and two with a voice: the vocal medians come from the two, presence is 2 of 12."""
    clips = [clip(i, 1) for i in range(12)]
    for c in clips[:10]:
        c["features"].update(vocal_share=0.0, vocal_voiced=0.0)
    clips[10]["features"].update(vocal_share=0.2, vocal_voiced=0.5)
    clips[11]["features"].update(vocal_share=0.3, vocal_voiced=0.7)
    f = aggregate.band_record(CFG, FETCHED, clips)["features"]
    assert f["vocal_share"]["median"] == 0.25 and f["vocal_voiced"]["median"] == 0.6
    assert f["vocal_presence"] == {"median": 2 / 12, "iqr": 0.0}
    f = aggregate.band_record(CFG, FETCHED, clips[:10])["features"]  # an instrumental band
    assert f["vocal_share"] == f["vocal_voiced"] == f["vocal_presence"] == {"median": 0.0, "iqr": 0.0}


def test_partial_under_eight_clips():
    r = aggregate.band_record(CFG, FETCHED, [clip(i, i) for i in range(7)])
    assert r["partial"] is True
    aggregate.validate(r, "band")


def test_clip_schema_and_mutations_fail():
    aggregate.validate(clip(1, 1), "clip")
    for mutate in (lambda c: c.pop("extractor_version"), lambda c: c["features"].pop("lufs"),
                   lambda c: c.update(source="spotify")):
        c = clip(1, 1)
        mutate(c)
        with pytest.raises(jsonschema.ValidationError):
            aggregate.validate(c, "clip")


def test_band_schema_mutation_fails():
    r = aggregate.band_record(CFG, FETCHED, [clip(i, i) for i in range(8)])
    bad = copy.deepcopy(r)
    bad["metadata"]["vocals"] = "growl"
    with pytest.raises(jsonschema.ValidationError):
        aggregate.validate(bad, "band")


def test_zero_clips_is_an_error_and_one_clip_has_zero_iqr():
    with pytest.raises(ValueError):
        aggregate.band_record(CFG, FETCHED, [])
    r = aggregate.band_record(CFG, FETCHED, [clip(0, 5)])
    assert r["features"]["lufs"] == {"median": 5.0, "iqr": 0.0} and r["partial"] is True


def test_write_json_is_atomic_and_finite(tmp_path):
    p = tmp_path / "a" / "b.json"
    aggregate.write_json(p, {"x": 1})
    assert p.read_text().startswith("{") and not p.with_suffix(".json.tmp").exists()
    with pytest.raises(ValueError):
        aggregate.write_json(p, {"x": float("nan")})
    assert p.read_text() == '{\n "x": 1\n}'  # the earlier record survives a failed write
    assert aggregate.finite({"a": 1.0, "b": 2}) and not aggregate.finite({"a": float("-inf")}) and not aggregate.finite({"a": float("nan")})
