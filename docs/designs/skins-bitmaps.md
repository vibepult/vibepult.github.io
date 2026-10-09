# Generated bitmaps for the skins

As of 7 October 2026. Companion to `skins.md`, which defines the slots. This is the to-do for replacing procedural
slots with generated images; nothing here is built yet beyond the loader. The procedural SVG stays the fallback for
every slot that has no file, so this can be done one image at a time.

## How a file gets onto the desk

1. Put the image under `web/skins/<pack>/`, for example `web/skins/folk/scene.webp`.
2. Name it in `web/skins/manifest.json`:
   ```json
   { "folk": { "scene": "skins/folk/scene.webp", "panel": "skins/folk/panel.webp" } }
   ```
3. Reload. `console.js` loads the manifest once; `skin()` in `web/skins.js` lays the named files over the procedural
   set, so a pack can mix bitmap and procedural slots. Unnamed slots stay procedural.

No build step, no commit of binaries elsewhere: the files live in `web/` and ship with the static site.

## Slots and what the file must be

| Slot | Size | Format | Rules |
| --- | --- | --- | --- |
| scene | 1600 x 900 | WebP or AVIF, under 400 KB | The desk covers the middle; everything of interest goes in the outer 160 px left and right and the top and bottom 110 px. Lower middle third dark and empty. The light layer still draws over it, so leave the procedural lights or set the slot and accept lights on a static image. |
| panel | 512 x 512 | WebP, lossless or high quality | Seamless tile. Greyscale, mean luminance near 50 percent: it is overlay-blended with the pack's panel colour, so the colour must not be in the file. |
| cap | 64 x 64 | WebP | Seamless tile, greyscale, same blending. Fader caps are 52 x 36 px on the reference desk, so detail finer than 2 px is lost. |
| ornament | 120 x 120 | PNG with alpha | 9-slice with 24 px slices: corners in the four 24 x 24 squares, a repeating edge piece in the 72 px middle of each side, the centre transparent. Draw inside the outer 22 px only. |
| emblem | 160 x 160 | PNG with alpha | One sigil, the pack's label colour, about 30 percent opacity. Shown at 96 px. |
| chassis | 128 to 512 square | WebP | Seamless tile, greyscale, overlay on the page background colour. The box the columns sit in. |
| pad | 64 to 256 square | WebP | Seamless tile, greyscale, overlay on the pad gradient. Lyric pads are 90 x 44 px. |
| plate | 16 to 256 square | WebP | Seamless tile, greyscale, overlay on the well colour. Name plates are 80 x 36 px. |
| cap-face | 44 x 36 | PNG with alpha | The fader cap, in the pack's cap colour, with its own grip line. Stretched to each cap, so keep detail centred and bold. |
| lever-face | 36 x 44 | PNG with alpha | The same cap turned on its side, for the horizontal levers. |

Greyscale is the rule for every tile because `ingest/themes.yaml` stays the single source of a pack's colour. A tile
that looks right in the generator will look wrong on the desk if it carries its own colour.

## Prompts

One prompt set per pack. The scene prompts describe the same picture the procedural scene draws, so a bitmap can
replace it without the pack changing character. Append to every scene prompt: "16:9, no text, no people, no logos,
the lower middle third empty and dark so a console can sit in front of it, painterly, muted". Append to every tile
prompt: "seamless tile, top-down, flat even lighting, greyscale, no text".

| Pack | Scene | Panel | Cap | Chassis | Ornament |
| --- | --- | --- | --- | --- | --- |
| black | night clearing in frost, cold grey mist, a pale moon with a wide halo, bare dead trees in silhouette, a jagged mountain line, skulls on wooden stakes at the sides, sparse snow | cold black marble with pale veins, matte | ivory bone, fine grain, hairline crack | cast iron, matte, slight pitting | a skull in each corner, a bone along each edge, thin pale rule |
| folk | conifer forest clearing at dusk, two depths of spruce and pine, mist on the ground, a small moon, pine boughs with cones hanging into the top corners, ferns and fallen cones in the bottom corners | oak planks, vertical grain, plank seams, worn | oak, fine vertical grain | rough pine bark | wrought-iron corner brackets with a scroll and nail heads, a pine cone on each edge |
| industrial | factory floor at night, perspective grid in dim neon, an orange horizon strip, hanging lamp cones or a row of grimy windows, pipes along the ceiling, neon tubes in orange and cyan down both sides, a neon bolt and ring sign in the top corners | brushed steel, horizontal streaks, a few scratches | knurled chrome | diamond plate steel | steel plate with a hex bolt in each corner, rivets and an orange neon strip on each edge |
| doom | stone dungeon wall with a low vault, candle clusters on shelves at the sides and on the floor, warm halos, wax runs, soot above the flames, chains from the ceiling, cobwebs in the top corners | rough stone blocks with mortar lines | dripped candle wax, glossy | dressed stone blocks | an iron ring in each corner, chain links and a wax drip on the edges |
| death | rust-streaked dark red slaughter room, meat hooks on chains at the sides, blood splatter and pools, skull piles in the corners, barbed wire along the top | pitted rust with dark spots | pitted rust | heavy rust | a knot of barbed wire in each corner, barbed wire along the edges |
| power | night sky over a crenellated castle with a few lit windows, a big moon or a storm with lightning, stars, two dragons in silhouette, red banners with gold trim hanging at the sides | brocade, fine diamond lattice over soft grain | brushed gold | red velvet | gold baroque scrollwork corners, beads along the edges |
| thrash | brick garage wall, band stickers in six colours with illegible text, spray-paint splats with drips in acid green and red, sharpie scrawls, a cable on the floor | denim twill | denim twill | black road-case vinyl with rivets | duct tape across each corner, a sharpie scrawl on each edge |
| steel | dark concert stage, four spotlight beams from above in white and amber, stage haze, guitar amp stacks with cloth grilles at both sides, monitor wedges in the bottom corners, cables across wooden boards | fine leather grain | brushed steel, vertical | studded black leather, pyramid studs | a pyramid stud in each corner, a row of studs along the edges |
| prog | low-poly mesh of points joined by thin cyan lines, glowing nodes, isometric wireframe cubes floating at the sides, a waveform along the floor, matte near-black | matte with a faint hex lattice | matte | carbon fibre weave | nested thin brackets in the corners, ruler ticks on the edges |

Emblems are better drawn than generated: a skull, a triple spiral, a cog, a candle, a hook, a crown, a lightning
bolt, a wireframe cube. The procedural ones are fine to keep.

## Post-processing

- Tiles: crop to a square, make seamless (offset by half and heal the seam, or generate with a tiling option),
  convert to greyscale, then level so the median is 50 percent grey and the range covers 20 to 80 percent. Stronger
  range means stronger grain on the desk.
- Scenes: resize to 1600 x 900, check the outer bands carry the motifs, darken the centre if the generator put
  something there, export WebP at quality 80.
- Ornaments: paint the 120 x 120 PNG by hand from the generated corner piece: one corner cleaned up, then mirrored,
  one edge piece cleaned up, then rotated. The procedural ones in `skins.js` show the layout.
- Keep the source prompts and seeds next to the files (`web/skins/<pack>/PROMPTS.md`) so a pack can be regenerated.

## Before shipping any of it

- Read the image generator's licence on commercial use once a donation link exists (`design-doc.md`, Theming).
- Check the page weight: eight scenes at 400 KB is 3 MB, loaded one at a time on commit, which is fine; eight full
  tile sets on top should stay under 1 MB together.
- Look at each pack once at the phone width: scenes do not show there, the tiles and ornaments do.
