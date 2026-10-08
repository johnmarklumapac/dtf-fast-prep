# DTFFastPrep

Photoshop UXP panel plugin that prepares artwork for DTF (direct-to-film) printing.
Its main feature is **Fast Halftone**: it converts semi-transparent pixels in the artwork
 (soft shadows, glows, feathered edges, gradients to transparent) into a pattern of
fully opaque dots on a fully transparent background.

Why this matters for DTF: the printer lays a white underbase under every pixel with any
opacity. Partially transparent pixels print as muddy, white-backed haze and the adhesive
powder sticks unevenly. A Fast Halftone result has only alpha 0 or 255, so every printed
pixel is solid and the original fade comes from dot size.

## Naming rules (strict)

- Every user-facing label says **"Fast Halftone"**: panel UI, buttons, history states,
  README, and comments that describe the feature.
- Internal names stay as they are: the file is `js/halftone.js` and the function is
  `halftoneAlpha()`.
- Never use the phrase "halftone engine" anywhere.

## Working rules

- Show a short plan and wait for the user's OK before writing files.
- Ask before installing any dependency.
- Never commit, push, or tag unless the user asks. Work on `main` (tracks `origin/main`,
  https://github.com/johnmarklumapac/dtf-fast-prep). Commits use the repo-local identity
  `johnmarklumapac <johnmarklumapac@users.noreply.github.com>`.
- After each step, tell the user exactly how to test it (Node command and/or UXP
  Developer Tool steps).
- Do one build-order step at a time unless told otherwise.

## Tech stack and constraints

- Photoshop UXP, manifest v5, host `PS` minVersion `24.2.0` with `apiVersion: 2`
  (24.2 is the first version with the `imaging` pixel API).
  Plugin id `com.mr300dpi.dtffastprep`, name `DTFFastPrep`, panel entrypoint `mainPanel`.
- Plain HTML/CSS/JS. No bundler, no framework, no TypeScript. UI uses Spectrum UXP widgets
  (`sp-picker`, `sp-checkbox`, `sp-textfield`, `sp-button`, …).
- Node (v24) is used only for offline testing and linting. Dev dependencies: `pngjs`
  (tests), `eslint` + `@eslint/js` (lint). Nothing from `node_modules` ships in the plugin.
- Lint with `npm run lint` (config: `eslint.config.js`, recommended rules; UXP globals for
  `js/`, Node globals for `test/`). Keep it at zero problems.
- `js/halftone.js` must stay **pure**: no `require("photoshop")`, no DOM, no Node APIs.
  It must load both in UXP (via `<script>`) and in Node (via `require`). Export with:
  It exports via `module.exports` (Node) and always sets `globalThis.DTFHalftone` (UXP).
  `index.html` loads it with a `<script>` tag before `js/index.js`.
- Photoshop document edits must run inside `core.executeAsModal`.
- Never modify the user's original document; all work happens in the new document.
- UI is a dark neon theme (colors listed at the top of `css/styles.css`):
  base `#15171c`, cards `#1f222a` / border `#2c3040`, text `#e8ecf2`, dim `#8a93a6`,
  **neon blue `#00d4ff`** = primary actions and selected states (Run, Apply, selected view,
  slider handles and active range, busy status), **neon orange `#ff7a18`** = accents
  (card labels, Fast Halftone tab and border, Cancel, linked-colors ring, warnings).
  Layout: each group is a rounded card with a small orange caps label; edit mode keeps the
  DTPrep-style structure (Default Sliders / Edit Halftones, three multi-handle sliders with
  number fields, Original/Shirt/Alpha/Mask segmented control, Post Cleanup, Cancel/Apply).
  Panel tab label is "Mr300dpi FastPrep".
- Panel layout is a full-height flex column: `.scroll` (everything, scrolls with
  `overflow-y: auto`) above a pinned `.action-bar` that is always visible. The bar holds
  the status pill plus `#setup-actions` (? / Run / ⚙) in setup mode or `#edit-actions`
  (Cancel / Apply) in edit mode. Never put the main action buttons inside `.scroll`.
  Edit mode adds `body.editing` for a compact layout (smaller logo row, tighter cards).
- Buttons are styled `div`s (`.btn`, `.btn-primary`, `.btn-ghost`, `.btn-outline-orange`,
  `.round-btn`, `.icon-btn`) because Spectrum `sp-button` colors can't be changed. They have
  hover/active states and a `busy` class (`setBusy()` in `js/index.js`) instead of `disabled`.
  Spectrum checkboxes, pickers, radios, and text fields keep their native look.
- Stick to CSS that UXP renders (flex, borders, radius, linear-gradient); don't rely on
  box-shadow glows or transitions for the look.
- The dotted "DTF FAST PREP" logo is `images/title.png`, rendered by `tools/make-title.ps1`
  (UXP can't clip a pattern to text): dots fade neon blue -> near-white -> neon orange.
  Re-run the script to change it.
- Never use a competitor's product name (e.g. "DTPrep") in the UI; the button says
  "Run DTF Fast Prep".

## Project layout

```
manifest.json          UXP manifest (v5)
eslint.config.js       ESLint flat config
index.html             Panel markup (setup + edit mode, help/settings dialogs)
css/styles.css         Panel styles
images/title.png       Dotted logo (generated)
tools/make-title.ps1   Regenerates images/title.png (Windows PowerShell + System.Drawing)
js/index.js            Panel wiring and all Photoshop calls
js/multislider.js      Multi-handle slider (Levels, Output Levels, Boost Shadow)
js/halftone.js         Pure pipeline: knockout, alpha curve, halftoneAlpha(), cleanup, edge extension
test/make-sample.js    Writes test/sample.png (gitignored)
test/run-halftone.js   Node harness: PNG -> prepPixels() -> alpha/shirt/mask PNGs
test/output/           Test results (gitignored)
```

## Workflow (`js/index.js`)

**Setup mode** (preset, print size, Scale to, Fast Halftone box, color tools, Run).
**Run DTF Fast Prep** never touches the open document. It:

1. Duplicates it merged (`doc.duplicate(name, true)`) as "<name> - DTF Fast Prep".
2. Converts to RGB 8-bit, resizes to the Scale to inches at 300 DPI.
3. Unlocks the Background, renames the merged layer "DTF Fast Prep Preview", reads its
   RGBA into memory, and locks the layer (`allLocked`). During editing this is the only
   layer; it is unlocked only while the plugin writes it.
4. Switches the panel to **edit mode** and renders.

Edit mode behaves like a modal dialog, as in DTPrep:
- The Layers and Properties panels are hidden on entering edit mode and shown again on
  Apply / Cancel / close. Only panels that were visible (per the application's
  `panelList`) are toggled. Their Window-menu command IDs are undocumented, so they are
  found once by scanning `core.getMenuCommandTitle` (IDs 1000–4000, exact English titles
  "Layers" / "Properties"), cached in `localStorage` (`dtffastprep.menuCommandIds`), and
  toggled with `core.performMenuCommand`. This runs **after** the first render, in the
  background with a 3 s time limit (`hidePanelsSafely`); it must never block or delay the
  Fast Halftone preview. Failures only log a warning.
- On any `select` / `make` / `open` notification away from the preview layer, an
  `app.showAlert` says exactly "Please add your edits within the DTF FAST PREP Plugin
  before continuing"; after OK the plugin switches back to the new document and its
  preview layer.

**Edit mode** re-renders (200 ms debounce, one render at a time) whenever any setting
changes: the pure pipeline runs on the cached source pixels, then `imaging.putPixels`
writes the current view into the preview layer (tagged with the document's color profile).
The first render reads the layer back (`verifyPreview`) and shows "Fast Halftone preview
didn't update…" if Photoshop still holds soft/unchanged pixels. Errors name the failing step
("Processing pixels", "Writing the preview layer", "Checking the preview layer"), and every
step logs a `[DTF Fast Prep]` line to the UXP Developer Tool console.
- `.hidden` is the last rule in `css/styles.css` and uses `!important`, so layout rules
  (e.g. `.action-row { display: flex }`) can't un-hide setup controls in edit mode.

- **Sliders** work like Photoshop Levels (`js/multislider.js`, since `sp-slider` has one
  handle): Levels is one track with black / midtone / white handles, Output Levels one
  track with low / high, Boost Shadow one track. Number fields sit under each track.
  The midtone handle is at `black + (white - black) * 0.5^gamma`, so moving black or white
  keeps gamma; dragging it sets `gamma = ln(x) / ln(0.5)`. Handles can't cross.
  Saved settings carry `levelsUnits: 255`; older ones (black/white in %) are converted.
- **Default Sliders** resets levels, output levels, boost, and cleanup.
- **Edit Halftones** shows/hides the Fast Halftone box (enable, shape, frequency, angle).
- **Views** redraw the preview layer: Original = source pixels; Shirt = result composited
  on the preview color over the whole document; Alpha = result on transparency;
  Mask = dots as white on black.
- **Apply** builds the final layers (bottom to top):
  - `Original`: the source pixels, hidden.
  - `DTF Fast Prep`: the colors fully opaque (extended under the mask), with the Fast Halftone
    dots as its **layer mask** (`make` mask revealAll + `imaging.putLayerMask`), so the
    halftone stays editable. If the mask can't be written, the dots go into the layer's
    transparency instead and the status says so.
- **Cancel** closes the new document without saving. Closing it manually also exits edit mode.

Other panel features:
- **Presets:** picker + ☰ menu (save as, delete, reset to Default). Stored in
  `localStorage` (`dtffastprep.presets`); the last used settings are restored on load
  (`dtffastprep.last`). Presets hold every setting except Scale to.
- **Swatches:** click to open Photoshop's color picker (`showColorPicker`). In edit mode
  the preview color switches to (and redraws) the Shirt view.
- **Link button:** when on, the knockout and preview colors stay the same.
- **? / ⚙:** Help dialog; Settings dialog (cleanup speck sizes for Standard / High).

## Pipeline (`js/halftone.js`, `prepPixels`)

Per pixel, in order:

1. **Color Knockout** ("color to alpha", if enabled). For each channel, distance from the
   knockout color scaled to 0–1 (`(c-k)/(255-k)` above, `(k-c)/k` below); knockout alpha
   is the largest. Base alpha = source alpha × knockout alpha. Cached until the source or
   knockout color changes.
2. **Alpha curve** (256-entry table): Boost Shadow `a = 1-(1-a)^(1+boost/25)`, then
   Levels (black/white 0–255, midtone as gamma), then Output Levels (low/high, 0–255).
   Alpha 0 always stays 0.
3. **Fast Halftone** (`halftoneAlpha`, if enabled). Rotated grid, `cell = dpi / frequency`,
   anchored to document pixel (0, 0) via `originX/originY`. Per pixel offset `(fu, fv)` from
   the cell center; on if `a/255 > threshold`, where threshold is
   round `π(fu²+fv²)`, elliptical `π(k·fu² + fv²/k)` (k = 0.6), line `2|fv|`.
   Alpha 0 → 0 and 255 → 255. Dot area equals coverage.
4. **Post Cleanup:** removes 4-connected specks smaller than N px (bounded flood fill).
   Colors always come straight from the source (there is no de-fringe step).
5. **Edge extension on Apply** (`extendEdgeColors`): pixels outside the shape (the
   artwork outline before the halftone, cached on knockout + first visible alpha value)
   take the nearest shape pixel's color, so editing the mask never reveals dark background.

### Tunable constants (`DEFAULTS`, top of `js/halftone.js`)

| Constant | Default | Meaning |
|---|---|---|
| `dpi` | 300 | Document resolution |
| `frequency` | 30 | Dot lines per inch |
| `angle` | 33 | Screen angle (degrees) |
| `shape` | round | round / elliptical / line |
| `ellipseRatio` | 0.6 | Minor/major axis of elliptical dots |
| `levelsBlack` | 7 | Alpha (0–255) at or below which pixels become clear |
| `levelsGamma` | 1.0 | Midtone; > 1 makes soft areas more opaque |
| `levelsWhite` | 255 | Alpha (0–255) at or above which pixels become solid |
| `outputLow` / `outputHigh` | 0 / 255 | Output range; High < 255 forces solid areas into dots |
| `boostShadow` | 0 | 0–100, strengthens faint areas |
| `cleanup` | standard | none / standard / high |
| `cleanupStandardPx` / `cleanupHighPx` | 4 / 12 | Speck size limits |

Performance: 4500 × 5400 px takes about 1.4 s first run, about 0.9 s per later update in Node.

## Build order

1. **Skeleton + test harness.** Done.
2. **Setup panel + presets + color tools + dialogs.** Done.
3. **New-document workflow + live edit mode** (knockout, levels, Fast Halftone, cleanup,
   views, Apply/Cancel). Done.
4. **Neon UI.** Done (De-Fringe removed).
5. **Polish and package.** Faster preview for very large files (e.g. downsampled preview),
   progress indicator, README, `.ccx` packaging via UXP Developer Tool.

## Testing

- Node: `node test/make-sample.js`, then `node test/run-halftone.js test/sample.png [settings-json]`.
  Writes `test/output/<name>-{alpha,shirt,mask}.png` and fails if Fast Halftone leaves any
  alpha other than 0/255. Settings JSON uses `DEFAULTS` keys plus `halftone`, `knockout`,
  `shirtColor`.
- Check the output: every alpha value must be 0 or 255, dots should get smaller toward
  transparency, and there should be no visible seams or moiré.
- Photoshop: UXP Developer Tool → Add Plugin → select `manifest.json` → ••• → Load.
  Use ••• → Reload after edits and ••• → Debug for the console.
