# vibepult

A mixing console for metal. The faders set how a band should feel (aggressive, serene, dark, heavy...), the desk answers with the nearest band in the pool, plays it through a Spotify embed, and re-skins itself to that band's subgenre.

Everything the desk knows is measured from audio and metadata offline and shipped as one static file, `web/bands.json`. There is no server and no Spotify login.

## Open the desk

```
python web/serve.py
```

Open http://localhost:8000. It has to be served over http: opening `index.html` from disk does not work, and the page says so. `serve.py` is `python -m http.server` with caching turned off, so a reload always runs the latest code and data.

On a phone, on the same Wi-Fi: find the laptop's address (`ipconfig getifaddr en0` on a Mac) and open `http://<that address>:8000`.

## Using it

**Faders (left).** Twelve strips in two groups. Audio: Aggressive, Serene, Dark, Raw, Fast, Heavy. Character: Grand, Melodic, Technical, Consistent, Human, Theatrical. A fader position is a percentile of the pool: at 80, you are asking for a band more aggressive than 80 percent of the bands here. The middle means "don't care": a fader at 50 barely counts, and the further you push it toward either end, the harder it steers.

- Drag a cap, or click anywhere on the rail to jump there. On a phone, drag with your finger; the desk scrolls sideways.
- The LED column beside each fader has two brightnesses: dim up to your fader, bright up to where the current answer really sits. The difference is where the match compromised.
- Hover or drag a strip to see its reference bands: the pool's lowest, middle and highest band on that fader. The readout names the nearest one in words.

**Knobs, switches, selectors (middle).** These narrow the pool before the faders pick from it.

- Knobs: Era (formation year), Fans (Deezer fans, log scale), Band size, Prolificness (studio albums per active year). Drag up or down, or use the scroll wheel.
- Switches: Still active, Lineup stable. (A switch every band answers the same way, like Instrumental in this pool, is left off the desk.)
- Selectors: Country, Subgenre. Options that would leave no band are greyed out.
- When a switch or selector brings up a different band, the faders glide to where that band sits, so the desk always describes the answer you are hearing and you can nudge on from there.
- Language is a blank plate: lyrics are not part of this build.

**On-buttons.** Every control has a small button on top: lit means the control counts, dark means it is bypassed and dropped out entirely (its strip dims). On first load every fader is lit at 50 and every filter is dark. Touching a dark control switches it on.

**Sharing.** The address bar holds the whole desk (`#s=...`) and updates whenever you let go of a control. Copy the URL to share a setup; opening it restores every fader, knob, switch and selector.

**Result (right; pinned on top on a phone).** The band name and its Metal Archives genre update live while you drag. When you let go, the player swaps to that band and the desk changes skin. Dragging back to the band you started from changes nothing, and playback is never cut mid-drag.

- **Next** cycles through the second and third closest bands, then back. Moving any control resets it to the closest.
- Under the player: how many bands the desk knows, and how many pass the current filters.
- **Open in Spotify** is always under the player, for when the embed is blocked or slow.
- On a phone, tap the band name (or Player) to fold the player down to a strip and back.
- Logged out of Spotify, the player plays 30-second previews; logged in, full tracks. Volume is your device's: the Spotify embed has no volume control.

**Keyboard.** Tab through the faders, then the filters, then the result panel. On a fader or knob: arrows move 1, Page Up and Page Down move 10, Shift doubles, Home and End jump to the ends. Releasing the key commits, like letting go of the mouse.

**Messages.** *No band matches. Relax ...* names the filter to loosen. *Set at least one control.* means every fader and knob is bypassed.

## Tuning the space

The faders are weighted blends of measured features, defined in `ingest/weights.yaml`. That file is meant to be edited. After changing it:

```
.venv/bin/python -m ingest publish && .venv/bin/python -m ingest check
```

Then reload the page. This takes seconds and touches no audio. `check` exits non-zero if a premise gate fails (for example, Elderwind must sit well above Mayhem on Serene). It prints warnings under FLAGS, and reports how the faders correlate with the hand-written guesses in `data/ground-truth.yaml`.

Theme packs (colours, fonts, cap and LED shapes, and which genre gets which pack) live in `ingest/themes.yaml`. `check` enforces contrast on them.

## Rebuilding the data

One-time setup (Python 3.11, macOS: decoding uses the built-in `afconvert`):

```
python -m venv .venv
.venv/bin/pip install -e 'ingest[test]'
```

The pipeline, per band or for the whole pool:

```
.venv/bin/python -m ingest fetch [slug]     # Metal Archives metadata, iTunes previews -> data/fetch, data/audio
.venv/bin/python -m ingest extract [slug]   # audio features per clip -> data/clips, per band -> data/bands
.venv/bin/python -m ingest publish          # -> web/bands.json
.venv/bin/python -m ingest check
```

`fetch` is slow on purpose: iTunes allows about 20 requests a minute. `fetch --no-audio` only checks that a band has enough previews. Clip features are cached by extractor version, so re-running `extract` only computes what is new. Audio is never committed; clip and band records are.

The pool is 666 bands from 24 corners of metal (`ingest/corners.yaml`). To grow or rebalance it: edit the quotas, then `python -m ingest scout` (draws candidates from Wikidata), `python -m ingest admit` (keeps those with enough previews, about 13 s a band), `python -m ingest hand export` / `merge` (persona and camp scores), then `extract`, `publish`, `check`.

To add a single band by hand, add an entry to `ingest/pool.yaml` (iTunes, Deezer and Spotify artist IDs, the Metal Archives page, a short label of at most 9 characters, persona and camp scores), then run the four commands for its slug.

## Tests

```
.venv/bin/python -m pytest -q ingest/tests && node --test web/*.test.js
```

## Where things are

- `docs/designs/poc-24h.md`: the plan this build follows, with decisions and step-0 results.
- `docs/designs/design-doc.md`: the full product it grows into.
- `ingest/`: the offline pipeline, configs and check.
- `web/`: the desk. `engine.js` is the matching logic (no DOM); `console.js` is the UI.
- `data/`: measured records (`fetch`, `clips`, `bands`) and the sealed ground truth.
