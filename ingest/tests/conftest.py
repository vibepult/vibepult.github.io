import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # repo root, so `import ingest` works


import pytest  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def no_demucs():
    """Tests never load the 80 MB Demucs model (network, 12 s a clip): the vocal stem is the signal at half gain
    unless a test installs its own stem. Session scope, so module-scoped WAV fixtures see it too."""
    from ingest import audio
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(audio, "vocal_stem", lambda y, sr: 0.5 * y)
        yield
