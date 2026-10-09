# Bitmap slot overrides

Drop generated images here and name them in `manifest.json` to replace a procedural slot for a pack:

```json
{ "folk": { "scene": "skins/folk/scene.webp", "panel": "skins/folk/panel.webp" } }
```

Sizes and rules per slot are in `docs/designs/skins.md` (the prompt sets are there too). Tiles must be seamless and
grey (they are overlay-blended with the pack colour); the ornament is a 120 x 120 9-slice with 24 px slices and a
transparent middle; the scene is 1600 x 900 with the middle covered by the desk. Any slot not named stays procedural.
