# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Pool of 671 bands (`ingest/pool.yaml`), grown from the PoC's 16 by scout and admit, plus five sheet bands admitted 2026-10-07. Extractor 0.3.0 (2026-10-06) adds the Demucs vocal stem (`vocal_share`, `vocal_voiced`); a full re-extract is about six hours on an M2 Pro. PoC built to `docs/designs/poc-24h.md` (that doc wins over `design-doc.md` for the PoC). Read its Step 0 results section for what changed from the plan. The desk layout follows `docs/designs/console/` since 2026-10-07 (two rows of three columns, 6+6 strips, stepped selectors, lyrics bank); the phone layout of D14 was dropped then and is not maintained. Skins (M4, 2026-10-07): `web/skins.js` builds seeded procedural SVG for ten asset slots (scene, panel, cap, ornament, emblem, chassis, pad, plate, cap face, lever face) per `docs/designs/skins.md`; all nine packs are skinned, steel as a stage, with seeded motif variants, scene compositions, an animated light layer (`renderLights`, desktop only, off under reduced motion), bump-lit materials, and `web/skins/manifest.json` for bitmap overrides. Pack crossover (2026-10-07): the genre string's earliest-named pack skins the desk, the next one (`pack2`) trims it with its ornament, emblem and cap faces. Search (2026-10-09): an LCD field in the brand row recalls a band by name (`findBand`, `recallBand` in `web/engine.js`): faders and levers move to the band, filters that would hide it go to Any.

## Commands

```
python -m venv .venv && .venv/bin/pip install -e 'ingest[test]'   # once (or the deps listed in ingest/pyproject.toml)
.venv/bin/python -m ingest scout                       # Wikidata -> ingest/candidates.yaml by corners.yaml quotas
.venv/bin/python -m ingest admit [corner]              # candidates -> coverage -> pool.yaml (resumable, admission.yaml)
.venv/bin/python -m ingest hand export|brief|merge     # persona/camp scores for admitted bands (drafted by subagents)
.venv/bin/python -m ingest fetch [slug] [--no-audio]   # pool.yaml -> data/fetch/, previews -> data/audio/ (rate-limited, slow)
.venv/bin/python -m ingest extract [slug]              # data/audio -> data/clips (cached by extractor_version) -> data/bands; Demucs, ~3 s/clip on 10 workers
.venv/bin/python -m ingest publish && .venv/bin/python -m ingest check   # the iteration loop, no audio touched
.venv/bin/python web/serve.py                          # the desk on :8000, caching off
.venv/bin/python -m pytest -q ingest/tests && node --test web/*.test.js
```

`check.py` exits 1 on FAIL and prints warnings under FLAGS. `data/ground-truth.yaml` is the scoring sheet for weight tuning: check prints the per-fader Spearman rho against it, and the sheet is edited freely (the sealing rule was dropped 2026-10-06).

## What this is

A web app shaped like a mixing console. Faders set perceptual qualities of metal (aggression, serenity, darkness, grandeur...), the app answers with the nearest band and its 5 top tracks as Spotify embeds, and the desk re-skins to that band's subgenre.

## Architecture (planned, from the design doc)

Three parts, deliberately decoupled:

- **Offline ingestion** (Python, run locally or on GitHub Actions): resolves a band via Spotify metadata + Metal Archives, fetches 30-second previews from iTunes (Deezer fallback), extracts audio features with librosa/Essentia and lyric features from Genius, aggregates per band (median + IQR), and writes one record per band.
- **Publish step**: derives everything pool-relative (percentiles, fader blends via a weight-matrix config, reference-band tick labels, theme pack) from stored raw records and emits `bands.json`, committed to the static site.
- **Runtime**: static SPA (SVG + CSS console) does filter-then-weighted-Euclidean nearest neighbour in the browser over `bands.json`. One Cloudflare Worker exists only to hold the Spotify client secret and proxy the top-tracks call.

Milestones: M1 plumbing (one band end to end) → M2 pool of ~100 bands → M3 the browser desk → M4 theme packs → M5 public.

## Hard constraints

These come from API terms and platform limits, not taste. Do not relax them without checking the design doc's "Constraints and risks" table.

- **No Spotify user login, ever.** Client-credentials flow server-side only; playback goes through embeds. This keeps the app outside Spotify's 25-user dev-mode cap.
- **Never use Spotify for audio or analysis.** `preview_url`, audio-features, recommendations and related-artists are all unavailable to this app. Analysis audio comes from iTunes/Deezer previews; all features are computed locally.
- **Never store lyric text.** Genius terms forbid caching it. Store derived features only.
- **Raw per-band feature values are immutable once ingested.** Each record carries an extractor version; re-extract only when the extractor changes. Percentiles and fader values are derived at publish time, never stored as ground truth, so adding bands never requires re-ingesting old ones.
- **Rate limits**: iTunes is ~20 req/min. Look up by album, not by track.
- **The weight matrix (faders × features) lives in a config file** and is the main tuning surface. Faders are weighted blends, never a single raw feature.
