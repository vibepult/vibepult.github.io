# vibepult skins: slot layout for generated assets (M4)

As of 7 October 2026. Extends the Theming section of `design-doc.md`; the palette and shape slots are still `ingest/themes.yaml`.

## What a skin is

A pack is a palette (`themes.yaml`: panel, inset, cap, LEDs, label, accent, display font, cap and LED shape) plus an
asset set. The asset set fills ten slots, each one CSS variable on `<html>`, set by `applyPack` in `web/console.js`
from `web/skins.js`. The geometry under the assets stays the parametric HTML/CSS console, so every pack drops into
the same desk. Every pack has an asset set since 2026-10-07; an unknown pack name clears the slots.

The desk should look like a place, not a skinned form: a desk in a forest clearing for a pagan band, a frost-bitten
black-metal desk under a cold moon, a chrome desk on a factory floor, a candle-and-wax dungeon for gothic doom.
The place is the scene slot; the other three slots make the desk itself belong there.

Crossover (2026-10-07): publish names the packs in the order the Metal Archives genre string mentions them. The first
is the pack (scene, palette, font, lights, panel, chassis, pad, plate); the second, when there is one, is `pack2`, the
trim: `skin()` takes its ornament, emblem, cap face and lever face, drawn in the primary palette. Gojira
("Progressive/Groove/Death Metal") is a prog stage with death trim; 242 of 671 bands carry a trim.

## The ten slots

| Slot | CSS variable | Form | Reference size | Where it lands |
| --- | --- | --- | --- | --- |
| Scene | `--scene` | one image, `background-size: cover`, own colours | 1600 x 900, `preserveAspectRatio: slice` | the page behind the desk (desktop only; on a phone the desk fills the screen) |
| Panel | `--panel-tex` | seamless tile, luminance only, `background-blend-mode: overlay` on `--panel` | 512 x 512 | every `.col` |
| Cap | `--cap-tex` | seamless tile, luminance only, overlay on the cap gradient | 64 x 64 | fader caps, lever caps, the master cap, the chamfer cap layer |
| Ornament | `--ornament` | 9-slice `border-image`, 24 px slices, transparent middle, edges repeat `round` | 120 x 120 | corners and edges of every `.col` except the output U |
| Emblem | `--emblem` | one image, the pack sigil in the label colour at 30 percent | 160 x 160 | the empty bottom of the output U |
| Chassis | `--chassis` | seamless tile, luminance only, overlay on `--bg` | 64 to 512 square | the console box behind and between the columns |
| Pad | `--pad` | seamless tile, luminance only, overlay on the pad gradient | 64 to 256 square | the lyric pads |
| Plate | `--plate` | seamless tile, luminance only, overlay on `--well` | 16 to 256 square | the name plates above faders and the master |
| Cap face | `--cap-face` | one image in the pack's cap colour, stretched to the cap (`preserveAspectRatio: none`), draws its own grip | 44 x 36 | fader caps, the master cap, the chamfer cap layer |
| Lever face | `--lever-face` | the cap face turned on its side | 36 x 44 | the horizontal lever caps |

Reserved, not wired: a knob face (128 x 128, pointer at twelve o'clock). The desk has had no rotary control since
the levers replaced the knobs on 2026-10-07; the slot gets a variable the day one comes back.

Rules the slots impose:

- Panel and cap textures carry no colour. They are grey luminance tiles blended with `overlay`, where 50 percent grey
  is a no-op, so a tile's mean must sit near 0.5 and its range decides how strong the grain is. `themes.yaml` stays
  the only place a pack's colour lives; the same oak tile would read as bone on the black pack.
- The scene owns its colours (sky, fog, stone) but takes the pack accent for its lights: fireflies, neon, candle flames.
- The desk covers the middle of the scene. Motifs (skulls, cones, neon signs) go where the scene shows on a desktop:
  the outer 160 px on each side and the top and bottom 110 px of the 1600 x 900 frame.
- Ornaments live in the 22 px rim every column keeps clear (panel padding, strip inset), so they never sit under
  content. The edge slices carry a 2 px rule at the outer edge, which replaces the plain panel border while the skin
  is on. Border images ignore `border-radius`, so a skinned column has square corners.
- Motifs come in variants chosen per placement by the seed (three skulls: whole, cracked, horned; two cones; spruce or
  pine; rectangle, badge or burst stickers; taper or pillar candles), and scenes pick a composition per band: the forest
  is night or dusk and may have a lake, the frost night may carry an aurora, the factory has lamp cones or a row of
  windows, the castle sits under a moon or a storm with lightning.
- The only motion is the light layer and the 400 ms cross-fade on commit. The scene also hands `applyPack` a list of
  lights in scene coordinates (kind, position, radius, colour, timing jitter); `renderLights` draws one blurred disc per
  light in a fixed layer behind the desk, mapped onto the viewport with the scene's cover scale, and CSS animates each
  kind: candle flicker, neon buzz, firefly drift, slow pulse, rising embers, lightning flash. Lights sit where the scene
  shows and go still under `prefers-reduced-motion`. The scene SVG itself never animates.
- Stone, bark, rust, tolex, wax and bone tiles are bump-lit: the noise is a height map under `feDiffuseLighting`, with
  `feSpecularLighting` on gold and wax, so the materials have relief that flat noise lacks.

## Procedural first, bitmaps as a drop-in

The assets are procedural: seeded SVG built as data URIs in `web/skins.js`. Textures are `feTurbulence` mapped onto a
grey range; scenes are generated geometry (conifers, branching trees, a perspective grid) over gradients and noise fog.
The seed is a hash of the band slug, so every band gets its own forest and a share link draws the same one. The
"always different" variant is one line: seed from the clock instead of the slug.

A generated bitmap drops into any slot through `web/skins/manifest.json` (`{ pack: { slot: 'skins/pack/file.webp' } }`),
which `console.js` loads once and `skin()` applies over the procedural set, so a pack can mix bitmap and procedural
slots. Cut generated images to the reference sizes above, make the tiles seamless and grey, and leave the ornament's
middle transparent. `web/skins/README.md` repeats the rules next to the manifest, and `skins-bitmaps.md` is the handbook for producing the images.

## Pack scenes and prompt sets

One prompt set per pack: scene, panel, cap, ornament. The first three packs ship procedurally; the prompts describe
the same picture for a future generated batch. All nine packs are built, steel included: it is the default for every genre the rules do not match, so it gets a place of its own rather than a plain desk.

| Pack | Scene | Panel | Cap | Ornament |
| --- | --- | --- | --- | --- |
| Black | night clearing, cold grey mist, a pale moon with a wide halo, bare branching dead trees in silhouette, a jagged mountain line, skulls on stakes at the sides and piled in the corners, sparse snow | cold black marble with pale veins, matte | ivory bone, fine grain, a hairline crack | a skull in each corner, a bone on each edge, a thin pale rule; emblem: a skull |
| Folk / medieval | conifer forest clearing at dusk, two layers of trees, mist on the ground, a small moon, fireflies in the pack green, pine boughs with cones hanging into the top corners, ferns and fallen cones in the bottom corners | oak planks, vertical grain, plank seams, worn | oak, fine vertical grain | wrought-iron corner brackets with a scroll and three nail heads, a pine cone and nails on each edge; emblem: a triple spiral |
| Industrial / cyber | factory floor, perspective grid in dim neon, an orange horizon strip, hanging lamp cones, pipes along the ceiling, neon tubes down both sides in orange and cyan, a neon bolt and ring sign in the top corners, a neon strip along the floor, concrete grain, scanlines | brushed steel, horizontal streaks, a few scratches | knurled chrome, two crossed diagonal line sets | steel plate with a hex bolt in each corner, rivets and an orange neon strip on each edge; emblem: a cog |
| Doom | stone block wall with a vault arch, candle clusters on shelves at the sides and on the floor, warm halos, wax runs, soot, chains from the ceiling, cobwebs in the top corners | rough stone blocks with mortar lines | dripped wax, vertical streaks | an iron ring in each corner, chain links and a wax drip on the edges; emblem: a candle |
| Death | rust-streaked dark red room, meat hooks on chains at the sides, blood splatter and pools in the pack red, skull piles in the corners, barbed wire along the top, flies | pitted rust with dark spots | pitted rust | a knot of barbed wire in each corner, barbed wire along the edges; emblem: a hook |
| Power / symphonic | night sky over a crenellated castle with lit windows, a big moon, stars, two dragons in silhouette, red banners with gold trim hanging at the sides | brocade: fine diamond lattice over soft grain | brushed gold | gold scrollwork corners, beads along the edges; emblem: a crown |
| Thrash | brick garage wall, stickers in six inks with text bars at the sides and top, spray splats with drips in the pack green and red, sharpie scrawls, a cable on the floor | denim twill over grain | denim twill | duct tape across each corner, a sharpie scrawl on each edge; emblem: a lightning bolt |
| Steel (default) | a dark stage, four spotlight beams from the top in white and amber, haze, amp stacks with grilles and a red power LED at both sides, monitor wedges in the bottom corners, cables across the boards | leather grain | brushed steel, vertical | studded leather | a pyramid stud in each corner, a row of studs on each edge; emblem: a plectrum |
| Prog / djent | low-poly mesh of points joined to their three nearest, glowing nodes, isometric wireframe cubes floating at the sides, a waveform of shifting frequency along the floor | matte with a faint hex lattice | matte | nested thin brackets in the corners, ruler ticks on the edges; emblem: a wireframe cube |

Chassis, pad and plate reuse the tile generators: oak, iron, diamond plate, stone, rust, velvet, road-case tolex with rivets, carbon weave for the chassis; parchment, bone, LCD lines, wax, rust, brocade for the pads and plates.

Candidate generator prompt, per pack, for the scene slot: "<scene column above>, 16:9, no text, no people, the lower
middle third empty and dark so a console can sit in front of it". Texture slot: "<panel column>, seamless tile,
top-down, flat lighting, greyscale". Check the image generator's commercial-use terms before a donation link exists
(design doc, Theming).
