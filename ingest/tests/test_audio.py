from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from ingest import audio

SR = 22050
AFCONVERT = pytest.mark.skipif(not Path("/usr/bin/afconvert").exists(), reason="macOS decoder")


@pytest.fixture(scope="module")
def wavs(tmp_path_factory):
    d = tmp_path_factory.mktemp("wav")
    t = np.arange(2 * SR) / SR
    sf.write(d / "tone.wav", 0.5 * np.sin(2 * np.pi * 50 * t), SR)
    sf.write(d / "noise.wav", 0.3 * np.random.default_rng(0).standard_normal(2 * SR), SR)
    return {"tone": audio.features(d / "tone.wav"), "noise": audio.features(d / "noise.wav")}


def test_all_feature_keys(wavs):
    assert sorted(wavs["tone"]) == sorted(audio.FEATURES) and len(audio.FEATURES) == 18
    assert all(np.isfinite(v) for v in wavs["tone"].values())


def test_tone_is_all_sub_bass_at_50hz(wavs):
    assert wavs["tone"]["sub100_share"] > 0.95
    assert abs(wavs["tone"]["lowest_pitch"] - 50) < 3


def test_noise_is_flat_and_has_no_sustained_low_pitch(wavs):
    assert wavs["noise"]["flatness"] > 0.3 > wavs["tone"]["flatness"]
    assert wavs["noise"]["lowest_pitch"] == 200.0


def test_clean_share_is_the_tonal_frame_share(wavs):
    assert wavs["tone"]["clean_share"] > 0.9 and wavs["noise"]["clean_share"] == 0


def test_vocal_share_is_the_stem_energy_ratio(wavs):
    assert abs(wavs["tone"]["vocal_share"] - 0.25) < 1e-3  # conftest's stem is the signal at half gain


def test_vocal_voiced_tells_a_sung_tone_from_a_scream(tmp_path, monkeypatch):
    """A 220 Hz tone stem is voiced throughout; a noise stem (a growl has no stable pitch) is not; a silent stem is 0."""
    t = np.arange(2 * SR) / SR
    tone, noise = 0.5 * np.sin(2 * np.pi * 220 * t), 0.3 * np.random.default_rng(1).standard_normal(2 * SR)
    assert audio.vocal_voiced(tone, SR) > 0.9
    assert audio.vocal_voiced(noise, SR) < 0.2
    assert audio.vocal_voiced(np.zeros(2 * SR), SR) == 0.0
    sf.write(tmp_path / "x.wav", tone, SR)
    monkeypatch.setattr(audio, "vocal_stem", lambda y, sr: np.zeros_like(y))
    f = audio.features(tmp_path / "x.wav")
    assert f["vocal_share"] == 0.0 and f["vocal_voiced"] == 0.0  # an instrumental clip, as Sunn O))) measures


@AFCONVERT
def test_afconvert_failure_drops_clip(tmp_path):
    bad = tmp_path / "x.m4a"
    bad.write_bytes(b"not audio")
    assert audio.decode(bad, tmp_path / "x.wav") is False


def test_silence_is_non_finite_and_gets_dropped(tmp_path, monkeypatch):
    """Silence gives -inf loudness; the worker drops such a clip instead of writing NaN into the pool."""
    from ingest import aggregate, clips_
    sf.write(tmp_path / "s.wav", np.zeros(2 * SR), SR)
    f = audio.features(tmp_path / "s.wav")
    assert not aggregate.finite(f)
    monkeypatch.setattr(clips_, "download", lambda c, d: True)
    monkeypatch.setattr(audio, "decode", lambda src, wav: sf.write(wav, np.zeros(2 * SR), SR) or True)
    monkeypatch.setattr(clips_, "DATA", tmp_path)
    assert clips_.clip_record(("x", {"id": "x/1-1", "title": "t", "source": "itunes", "album": "a", "year": 2000,
                                     "itunes_year": 2000, "year_source": "metal-archives", "song_length": 200})) is None
    monkeypatch.setattr(audio, "features", lambda wav: 1 / 0)  # any analysis error is a dropped clip, not a dead pool
    assert clips_.clip_record(("x", {"id": "x/1-2", "title": "t", "source": "itunes", "album": "a", "year": 2000,
                                     "itunes_year": 2000, "year_source": "metal-archives", "song_length": 200})) is None
