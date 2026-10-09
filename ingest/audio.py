"""Decode previews to WAV and compute the per-clip audio features (feature table rows 1 to 15 and 18)."""
import subprocess
import warnings

import librosa
import numpy as np
import pyloudnorm
import scipy.ndimage
import scipy.signal

# 0.2.0: lowest_pitch floor test 6 dB over a 31-bin floor (0.1.0's 12 dB found nothing in dense mixes);
#        clean_share is the share of tonal frames (0.1.0's quiet-and-tonal never fired on loud previews).
# 0.3.0: vocal_share and vocal_voiced from the Demucs vocal stem (row 18). Before it, nothing in the pipeline
#        heard a voice: Humanity ranked the 359 genre-prior "clean" bands by tonal-frame share, which peaks on
#        drone walls, so Sunn O))) was the most human band in the pool.
EXTRACTOR_VERSION = "0.3.0"
AFCONVERT = "/usr/bin/afconvert"
CLEAN_FLATNESS = 0.005
SR = 22050
VOCAL_ACTIVE_DB = -40.0  # a vocal-stem frame counts as sung or screamed only above this RMS
FEATURES = ["tempo_bpm", "onset_rate", "tempo_var", "low_onset_rate", "lufs", "rms_dbfs", "crest",
            "centroid", "flatness", "sub100_share", "lowest_pitch", "harmonic_share", "clean_share",
            "minor_share", "chord_rate", "repetitiveness", "vocal_share", "vocal_voiced"]

# Krumhansl-Kessler key profiles, C first.
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def decode(src, wav):
    """afconvert any preview (AAC or MP3) to 16-bit mono WAV at 22050 Hz. Returns False on failure."""
    try:
        r = subprocess.run([AFCONVERT, "-f", "WAVE", "-d", f"LEI16@{SR}", "-c", "1", str(src), str(wav)],
                           capture_output=True, timeout=120)
    except subprocess.TimeoutExpired:  # a hung decoder is a failed one; a missing decoder raises, loudly
        return False
    return r.returncode == 0


def lowest_pitch(y_harm, sr, fmax=200.0, persistence=0.2):
    """Lowest sustained spectral peak below fmax (D11): per-frame peaks on the harmonic component
    standing 6 dB over the local floor, keep bins peaking in at least `persistence` of frames, return the lowest in Hz (fmax if none)."""
    n_fft = 8192  # 2.7 Hz bins at 22050
    mag = np.abs(librosa.stft(y_harm, n_fft=n_fft, hop_length=2048))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    low = (freqs > 20) & (freqs < fmax)
    counts = np.zeros(low.sum())
    floor = scipy.ndimage.median_filter(mag, size=(31, 1))  # local spectral floor per frame
    for frame, base in zip(mag.T, floor.T):
        if frame.max() <= 0:
            continue
        peaks, _ = scipy.signal.find_peaks(frame[low], height=0.1 * frame.max())
        peaks = peaks[frame[low][peaks] > 2 * base[low][peaks]]  # 6 dB above the neighbourhood
        counts[peaks] += 1
    sustained = np.flatnonzero(counts >= persistence * mag.shape[1])
    return float(freqs[low][sustained[0]]) if len(sustained) else fmax


def _db(x):
    return float(20 * np.log10(max(x, 1e-10)))


_demucs = None


def vocal_stem(y, sr):
    """The Demucs (htdemucs) vocal stem of a mono signal, returned at sr. The model loads once per process.
    One torch thread: extraction already runs one worker per core, and on an M2 Pro one thread per worker
    separates a clip in 23 s against 12 s for ten threads in one process, so ten single-thread workers win 5x."""
    global _demucs
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    if _demucs is None:
        torch.set_num_threads(1)
        _demucs = get_model("htdemucs").eval()
    ym = librosa.resample(y, orig_sr=sr, target_sr=_demucs.samplerate)
    x = torch.from_numpy(np.stack([ym, ym])).float()[None]  # the model wants stereo
    with torch.no_grad(), warnings.catch_warnings():
        warnings.simplefilter("ignore")
        out = apply_model(_demucs, x, device="cpu", shifts=0, split=True, overlap=0.25, progress=False)[0]
    voc = out[_demucs.sources.index("vocals")].mean(0).numpy()
    return librosa.resample(voc, orig_sr=_demucs.samplerate, target_sr=sr)


def vocal_voiced(voc, sr):
    """Share of audible vocal-stem frames that pyin calls voiced: sung lines near 1, growls and screams
    (noise-like, no stable pitch) lower, 0 when the stem is silent throughout."""
    rms = librosa.feature.rms(y=voc)[0]
    active = 20 * np.log10(np.maximum(rms, 1e-10)) > VOCAL_ACTIVE_DB
    if not active.any():
        return 0.0
    _, voiced, _ = librosa.pyin(voc, fmin=65, fmax=1000, sr=sr)
    return float(voiced[active].mean())


def features(wav):
    y, sr = librosa.load(str(wav), sr=SR, mono=True)
    dur = len(y) / sr
    S = np.abs(librosa.stft(y)) ** 2
    freqs = librosa.fft_frequencies(sr=sr)
    rms = float(np.sqrt(np.mean(y ** 2)))
    y_harm, y_perc = librosa.effects.hpss(y)
    voc = vocal_stem(y, sr)

    onsets = librosa.onset.onset_detect(y=y, sr=sr)
    low_mel = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=16, fmax=200)
    low_onsets = librosa.onset.onset_detect(onset_envelope=librosa.onset.onset_strength(S=librosa.power_to_db(low_mel)), sr=sr)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    local_tempo = librosa.feature.tempo(y=y, sr=sr, aggregate=None)

    flat = librosa.feature.spectral_flatness(y=y)[0]
    # ponytail: "clean/acoustic" = tonal frames by one flatness threshold; a classifier is the M2 upgrade
    clean = flat < CLEAN_FLATNESS

    chroma = librosa.feature.chroma_cqt(y=y_harm, sr=sr)
    mean_chroma = chroma.mean(axis=1)
    major = max(np.corrcoef(mean_chroma, np.roll(MAJOR, k))[0, 1] for k in range(12))
    minor = max(np.corrcoef(mean_chroma, np.roll(MINOR, k))[0, 1] for k in range(12))

    # Chords: triad templates on half-second median-smoothed chroma, changes per second.
    smooth = scipy.ndimage.median_filter(chroma, size=(1, 21))
    triads = np.array([np.roll([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], k) for k in range(12)] +
                      [np.roll([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0], k) for k in range(12)])
    labels = np.argmax(triads @ smooth, axis=0)
    labels = scipy.ndimage.median_filter(labels, size=21, mode="nearest")

    sync = librosa.util.normalize(librosa.util.sync(chroma, beats) if len(beats) > 2 else chroma, norm=2, axis=0)
    sim = sync.T @ sync
    off_diag = sim[~np.eye(len(sim), dtype=bool)]

    return {
        "tempo_bpm": float(np.atleast_1d(tempo)[0]),
        "onset_rate": len(onsets) / dur,
        "tempo_var": float(np.std(local_tempo)),
        "low_onset_rate": len(low_onsets) / dur,
        "lufs": float(pyloudnorm.Meter(sr).integrated_loudness(y)),
        "rms_dbfs": _db(rms),
        "crest": _db(np.max(np.abs(y)) / max(rms, 1e-10)),
        "centroid": float(librosa.feature.spectral_centroid(y=y, sr=sr).mean()),
        "flatness": float(flat.mean()),
        "sub100_share": float(S[freqs < 100].sum() / max(S.sum(), 1e-10)),
        "lowest_pitch": lowest_pitch(y_harm, sr),
        "harmonic_share": float(np.sum(y_harm ** 2) / max(np.sum(y_harm ** 2) + np.sum(y_perc ** 2), 1e-10)),
        "clean_share": float(clean.mean()),
        "minor_share": float(minor - major),
        "chord_rate": float(np.count_nonzero(np.diff(labels)) / dur),
        "repetitiveness": float(off_diag.mean()) if off_diag.size else 0.0,
        "vocal_share": float(np.sum(voc ** 2) / max(np.sum(y ** 2), 1e-10)),
        "vocal_voiced": vocal_voiced(voc, sr),
    }
