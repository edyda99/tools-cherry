# Canvas Engine Design — shared client-side image core

## Plain-language summary

The image tools (passport photo maker, circle-crop, resize, format-convert, compress-to-KB)
all do the same three things: **load an image, frame/transform it on a canvas, export a file.**
Rather than rewrite that five times, we build **one reusable module — `CanvasEditor`** — that
owns load + crop/zoom/pan + export, and each tool is a thin page that configures it (aspect ratio,
output size, file type) and adds its own controls. Build the engine once (~1 day); each marginal
image tool is then ~0.5 day, exactly the "component cluster" economics in the handoff.

Most formats we care about (PNG, JPEG, WebP) need **no libraries** — the browser's native canvas
decodes and encodes them. Only the exotic inputs (HEIC, AVIF, RAW/CR2, TIFF) need WASM decoders,
and **only those** trigger the COOP/COEP `_headers` requirement. So we ship the native-format tools
first with zero new dependencies, and gate the WASM formats behind a clearly separated tier.

---

## Goals / non-goals

**Goals**
- One module reused by every image tool; marginal tool cost ≈ 0.5 day.
- 100% client-side (matches the "nothing uploaded" privacy promise the other tools make).
- Pure, unit-testable math (crop geometry, fit/cover, quality search) separated from DOM/canvas.

**Non-goals (v1)**
- No server-side processing, no accounts.
- No RAW/HEIC/AVIF decode in tier 1 (deferred to tier 2 behind WASM).
- No multi-layer editing — single image in, single image out.

---

## Tools that reuse the engine

| Tool | Crop | Output | Notes |
|---|---|---|---|
| Passport/ID photo | fixed aspect (per spec) | exact px @ 300 DPI, white bg | + print-sheet composer (tile N copies on 4×6) |
| Circle crop | aspect 1:1, circular mask | PNG with transparency | export must keep alpha |
| Resize image | free / locked | target W×H | optional "fit" vs "fill" |
| Convert (png/jpg/webp) | none | same dims, new type | toBlob with chosen MIME |
| Compress to KB | none | target file size | binary-search JPEG quality |

---

## Architecture — `CanvasEditor` (src/engine/canvas-editor.js)

A framework-free class. Interaction state is just `{ scale, offsetX, offsetY }`; everything else
is derived. DOM events (drag, wheel) only mutate that state and call `render()`.

```js
new CanvasEditor(canvasEl, { background: '#fff' });

editor.loadFile(file);                       // File -> decode -> fit to view
editor.setCrop({ aspect: 2/2, shape: 'rect' }); // aspect=w/h or null; shape 'rect'|'circle'
editor.setOutput({ width, height, dpi, background }); // target export dims
editor.on('change', () => updatePreview());

// interaction handled internally: drag = pan, wheel/slider = zoom (clamped to cover crop)

await editor.toBlob({ type: 'image/png', quality: 0.92 }); // -> Blob at output dims
editor.toCanvas();   // offscreen canvas at output dims (for the print-sheet composer)
editor.reset();
```

### Pure helpers (src/engine/canvas-math.js) — unit-tested in Node

- `coverScale(imgW, imgH, boxW, boxH)` / `containScale(...)` — fit math.
- `clampOffset(state, imgDims, cropRect)` — keep the crop window inside the image.
- `cropRectFor(viewW, viewH, aspect)` — centered crop rect for an aspect.
- `qualityForTargetBytes(encodeFn, targetBytes)` — binary search over JPEG quality (compress tool).

These have **no canvas/DOM dependency**, so they're testable in `scripts/test-canvas.js`
the same way the paycheck engine is. The canvas rendering itself is verified in-browser.

### Export pipeline

1. Allocate an offscreen canvas at `output.width × output.height`.
2. If `background`, fill it (white for photos; skip for transparent circle-crop PNG).
3. Draw the source image transformed by the current crop window into the output rect.
4. For `circle` shape, apply a circular clip before drawing (alpha preserved → PNG only).
5. `canvas.toBlob(type, quality)`. For compress-to-KB, loop quality via `qualityForTargetBytes`.

---

## Format tiers

**Tier 1 — native canvas, zero dependencies (ship first):**
decode + encode PNG / JPEG / WebP (and decode GIF/BMP). Covers resize, circle-crop, jpg↔png↔webp
convert, compress-to-KB, and the passport photo maker. **No `_headers` / COOP/COEP needed.**

**Tier 2 — needs a WASM decoder (defer, isolate):**
HEIC (libheif-wasm), AVIF decode (where unsupported), RAW/CR2, TIFF, SVG→raster (drawable via
`<img>` but sizing differs). These pull a WASM blob and **only here** do we add the COOP/COEP
`_headers` template the handoff mentioned. Keep each decoder lazy-loaded so tier-1 tools stay light.

---

## File structure

```
src/engine/
  canvas-editor.js      # the shared class (DOM + canvas)
  canvas-math.js        # pure helpers (unit-tested)
src/assets/
  photo-maker.js        # composes CanvasEditor + specs + print sheet
  circle-crop.js
  image-resize.js
  image-convert.js
src/templates/
  passport-photo-maker.html
  circle-crop.html
  ...
src/data/
  photo-specs.json      # country/ID photo presets (px, mm, DPI, bg) — sourced like tax data
scripts/test-canvas.js  # unit tests for canvas-math.js
docs/canvas-engine-design.md
```

`photo-specs.json` is the photo-maker's equivalent of `tax-data` — the per-country dimensions
(US 2×2 in @ 300 DPI = 600×600 px white bg; Schengen 35×45 mm; etc.) must be **sourced from
official guidance, not memory**, same discipline as the tax figures.

---

## Build order on top of the engine

1. `canvas-math.js` + `canvas-editor.js` + Node tests for the math.
2. **Circle-crop** first as the engine's smoke test — simplest consumer (1:1, circular, PNG),
   proves load/crop/export end-to-end with the least surface area.
3. **Passport photo maker** — adds spec presets + print-sheet composer (the handoff's seed tool).
4. Resize / convert / compress — thin configs over the same engine.

Rationale: circle-crop validates the engine cheaply before the more involved photo maker rides on it.
