# vibepult console layout

Static HTML/CSS export of the console design, as of 2026-10-07.

- `index.html` is the full console at a 1440×900 reference size. Open it directly in a browser.
- `selector-open.html` shows a stepped selector (the mixing-desk take on a dropdown) in its open state.
- `console.css` holds all the styles. Colours are CSS variables on `:root`; `--lcd` is the accent.

## Layout

Two rows, each split into three equal columns:

| | Left | Middle | Right |
|---|---|---|---|
| Top | Brand, Strict master fader, 4 five-step levers | U-shaped output: band name, match %, Find band | Patreon / Ko-fi, 3 stepped selectors, `[Sliders]` slot |
| Bottom | Channels 1–4 | 3×5 toggle bank (14 buttons, last cell empty) | Channels 5–8 |

## Notes

- This is a static mock: nothing is wired up yet.
- Text in `[BRACKETS]` is a placeholder.
- Positions are set with CSS variables in inline styles: `--pos` on fader and lever caps, `--angle` on knobs.
- The Width/Weight knobs on the channels are rotary. That clashes with the "no rotary controls" rule set for the top levers, and is still to be decided.
