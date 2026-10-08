// DTFFastPrep panel.
// Run DTF Fast Prep creates a new document from the artwork, then the panel
// switches to edit mode: knockout, levels, Fast Halftone, and cleanup update live
// on that document until Apply or Cancel.

const { app, core, action, imaging, constants } = require("photoshop");
const { shell } = require("uxp");
const { batchPlay } = action;
const H = globalThis.DTFHalftone || require("./halftone.js");

const PRINT_DPI = 300;
const SITE_URL = "https://www.mr300dpi.com";
const DEFAULT_PRESET = "Default";
const STORAGE_LAST = "dtffastprep.last";
const STORAGE_PRESETS = "dtffastprep.presets";
const RENDER_DELAY_MS = 200;

const LAYER_PREVIEW = "DTF Fast Prep Preview";
const LAYER_ORIGINAL = "Original";
const LAYER_RESULT = "DTF Fast Prep";

// Picker order must match the <sp-menu-item>s in index.html.
const SHAPES = ["round", "elliptical", "line"];

const DEFAULT_SETTINGS = {
  halftoneEnabled: true,
  shapeIndex: 0,
  frequency: H.DEFAULTS.frequency,
  angle: H.DEFAULTS.angle,
  knockoutEnabled: true,
  knockoutColor: { r: 0, g: 0, b: 0 },
  previewColor: { r: 0, g: 0, b: 0 },
  linked: true,
  levelsBlack: H.DEFAULTS.levelsBlack,
  levelsGamma: H.DEFAULTS.levelsGamma,
  levelsWhite: H.DEFAULTS.levelsWhite,
  outputLow: H.DEFAULTS.outputLow,
  outputHigh: H.DEFAULTS.outputHigh,
  boostShadow: H.DEFAULTS.boostShadow,
  cleanup: H.DEFAULTS.cleanup,
  cleanupStandardPx: H.DEFAULTS.cleanupStandardPx,
  cleanupHighPx: H.DEFAULTS.cleanupHighPx,
};


const $ = (id) => document.getElementById(id);

const ui = {
  preset: $("preset"),
  presetOptions: $("preset-options"),
  presetMenuToggle: $("preset-menu-toggle"),
  presetMenu: $("preset-menu"),
  presetName: $("preset-name"),
  presetSave: $("preset-save"),
  presetDelete: $("preset-delete"),
  presetReset: $("preset-reset"),
  printSection: $("print-section"),
  printSizeLabel: $("print-size-label"),
  scaleWidth: $("scale-width"),
  scaleHeight: $("scale-height"),
  halftoneSection: $("halftone-section"),
  halftoneEnabled: $("halftone-enabled"),
  halftoneShape: $("halftone-shape"),
  halftoneFrequency: $("halftone-frequency"),
  halftoneAngle: $("halftone-angle"),
  knockoutEnabled: $("knockout-enabled"),
  knockoutSwatch: $("knockout-swatch"),
  previewSwatch: $("preview-swatch"),
  colorLink: $("color-link"),
  setupActions: $("setup-actions"),
  help: $("help"),
  settings: $("settings"),
  run: $("run"),
  editSection: $("edit-section"),
  defaultSliders: $("default-sliders"),
  editHalftones: $("edit-halftones"),
  viewRow: $("view-row"),
  cleanup: $("cleanup"),
  cancel: $("cancel"),
  apply: $("apply"),
  status: $("status"),
  siteLink: $("site-link"),
  helpDialog: $("help-dialog"),
  helpClose: $("help-close"),
  settingsDialog: $("settings-dialog"),
  settingCleanupStandard: $("setting-cleanup-standard"),
  settingCleanupHigh: $("setting-cleanup-high"),
  settingsSave: $("settings-save"),
  settingsCancel: $("settings-cancel"),
};

// Slider values (Levels, Output Levels, Boost Shadow) and their number fields.
// Levels black/white and output levels are 0–255; midtone is a gamma (0.01–9.99).
const MIN_LEVELS_GAP = 2;
const levels = {
  levelsBlack: DEFAULT_SETTINGS.levelsBlack,
  levelsGamma: DEFAULT_SETTINGS.levelsGamma,
  levelsWhite: DEFAULT_SETTINGS.levelsWhite,
  outputLow: DEFAULT_SETTINGS.outputLow,
  outputHigh: DEFAULT_SETTINGS.outputHigh,
  boostShadow: DEFAULT_SETTINGS.boostShadow,
};
const levelFields = {
  levelsBlack: { field: $("levels-black"), places: 0 },
  levelsGamma: { field: $("levels-gamma"), places: 2 },
  levelsWhite: { field: $("levels-white"), places: 0 },
  outputLow: { field: $("output-low"), places: 0 },
  outputHigh: { field: $("output-high"), places: 0 },
  boostShadow: { field: $("boost-shadow"), places: 0 },
};
const SLIDER_VALUE_KEYS = Object.keys(levels);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Like Photoshop Levels: the midtone handle sits where input maps to 50% output.
// With x = its position between black (0) and white (1), x^(1/gamma) = 0.5.
const gammaToPosition = (gamma) => Math.pow(0.5, gamma);
const positionToGamma = (x) => clamp(Math.log(clamp(x, 0.001, 0.999)) / Math.log(0.5), 0.01, 9.99);

// Keeps every value in range and the handles in order.
function normalizeLevels(v) {
  v.levelsWhite = clamp(Math.round(v.levelsWhite), MIN_LEVELS_GAP, 255);
  v.levelsBlack = clamp(Math.round(v.levelsBlack), 0, v.levelsWhite - MIN_LEVELS_GAP);
  v.levelsGamma = Math.round(clamp(v.levelsGamma, 0.01, 9.99) * 100) / 100;
  v.outputLow = clamp(Math.round(v.outputLow), 0, 255);
  v.outputHigh = clamp(Math.round(v.outputHigh), v.outputLow, 255);
  v.boostShadow = clamp(Math.round(v.boostShadow), 0, 100);
}

const levelsSlider = new MultiSlider($("levels-slider"), {
  min: 0,
  max: 255,
  handles: ["handle-black", "handle-mid", "handle-white"],
  trackClass: "track-levels",
  fill: [0, 2],
  getValues: () => {
    const { levelsBlack: b, levelsWhite: w, levelsGamma: g } = levels;
    return [b, b + (w - b) * gammaToPosition(g), w];
  },
  onDrag: (index, value) => {
    const { levelsBlack: b, levelsWhite: w } = levels;
    if (index === 0) levels.levelsBlack = clamp(Math.round(value), 0, w - MIN_LEVELS_GAP);
    else if (index === 2) levels.levelsWhite = clamp(Math.round(value), b + MIN_LEVELS_GAP, 255);
    else levels.levelsGamma = Math.round(positionToGamma((value - b) / (w - b)) * 100) / 100;
    onSliderMoved();
  },
});

const outputSlider = new MultiSlider($("output-slider"), {
  min: 0,
  max: 255,
  handles: ["handle-black", "handle-white"],
  trackClass: "track-output",
  fill: [0, 1],
  getValues: () => [levels.outputLow, levels.outputHigh],
  onDrag: (index, value) => {
    if (index === 0) levels.outputLow = clamp(Math.round(value), 0, levels.outputHigh);
    else levels.outputHigh = clamp(Math.round(value), levels.outputLow, 255);
    onSliderMoved();
  },
});

const boostSlider = new MultiSlider($("boost-slider"), {
  min: 0,
  max: 100,
  handles: ["handle-white"],
  trackClass: "track-boost",
  fill: "start",
  getValues: () => [levels.boostShadow],
  onDrag: (index, value) => {
    levels.boostShadow = clamp(Math.round(value), 0, 100);
    onSliderMoved();
  },
});

function renderLevels() {
  for (const key of SLIDER_VALUE_KEYS) {
    levelFields[key].field.value = round(levels[key], levelFields[key].places);
  }
  levelsSlider.render();
  outputSlider.render();
  boostSlider.render();
}

function onSliderMoved() {
  renderLevels();
  onSettingChanged();
}

// Values that live outside form controls.
const state = {
  knockoutColor: { ...DEFAULT_SETTINGS.knockoutColor },
  previewColor: { ...DEFAULT_SETTINGS.previewColor },
  linked: DEFAULT_SETTINGS.linked,
  cleanupStandardPx: DEFAULT_SETTINGS.cleanupStandardPx,
  cleanupHighPx: DEFAULT_SETTINGS.cleanupHighPx,
  presetName: DEFAULT_PRESET,
};

// Aspect ratio of the active document, used to keep "Scale to" proportional.
let aspect = 0;
// Document id + pixel size last shown, so layer clicks don't overwrite typed values.
let shownKey = "";
// Set while the UI is filled in from code, so change events don't save or render.
let applying = false;

// Edit-mode session on the new document, or null in setup mode.
let session = null;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// kind: true or "error" (orange), "busy" (blue), "ok" (neutral), or plain.
function setStatus(message, kind = false) {
  const cls = kind === true ? "error" : kind || "";
  ui.status.textContent = message;
  ui.status.className = cls ? `status ${cls}` : "status";
}

// Custom (div) buttons can't be disabled, so they get a "busy" state instead.
function setBusy(button, busy, busyLabel) {
  if (busy) {
    button.dataset.label = button.textContent;
    if (busyLabel) button.textContent = busyLabel;
    button.classList.add("busy");
  } else {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.classList.remove("busy");
  }
}

const isBusy = (button) => button.classList.contains("busy");

// Step-by-step trace in UXP Developer Tool → ••• → Debug.
function log(message) {
  console.log(`[DTF Fast Prep] ${message}`);
}

function showError(err) {
  console.error("[DTF Fast Prep]", err);
  setStatus((err && err.message) || String(err), true);
}

function round(value, places) {
  const f = Math.pow(10, places);
  return (Math.round(value * f) / f).toString();
}

function readNumber(field) {
  const value = parseFloat(field.value);
  return Number.isFinite(value) ? value : NaN;
}

function cssColor({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}

function rgbDescriptor({ r, g, b }) {
  return { _obj: "RGBColor", red: r, grain: g, blue: b };
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("Could not save settings", err);
  }
}

function show(el, visible) {
  el.classList.toggle("hidden", !visible);
}

// ---------------------------------------------------------------------------
// Settings <-> UI
// ---------------------------------------------------------------------------

function readCleanup() {
  const radios = ui.cleanup.querySelectorAll("sp-radio");
  for (const radio of radios) if (radio.checked) return radio.getAttribute("value");
  return DEFAULT_SETTINGS.cleanup;
}

function writeCleanup(value) {
  ui.cleanup.querySelectorAll("sp-radio").forEach((radio) => {
    radio.checked = radio.getAttribute("value") === value;
  });
}

function settingsFromUI() {
  const shapeIndex = ui.halftoneShape.selectedIndex;
  const s = {
    halftoneEnabled: ui.halftoneEnabled.checked,
    shapeIndex: shapeIndex >= 0 ? shapeIndex : 0,
    frequency: readNumber(ui.halftoneFrequency),
    angle: readNumber(ui.halftoneAngle),
    knockoutEnabled: ui.knockoutEnabled.checked,
    knockoutColor: { ...state.knockoutColor },
    previewColor: { ...state.previewColor },
    linked: state.linked,
    cleanup: readCleanup(),
    cleanupStandardPx: state.cleanupStandardPx,
    cleanupHighPx: state.cleanupHighPx,
  };
  for (const key of SLIDER_VALUE_KEYS) s[key] = levels[key];
  s.levelsUnits = 255;
  return s;
}

// Settings saved before Levels black/white moved from % to 0–255.
function migrateSettings(settings) {
  if (!settings || settings.levelsUnits === 255) return settings;
  const s = { ...settings };
  if (Number.isFinite(s.levelsBlack)) s.levelsBlack = Math.round(s.levelsBlack * 2.55);
  if (Number.isFinite(s.levelsWhite)) s.levelsWhite = Math.round(s.levelsWhite * 2.55);
  s.levelsUnits = 255;
  return s;
}

function applySettings(settings) {
  const s = { ...DEFAULT_SETTINGS, ...migrateSettings(settings) };
  applying = true;
  ui.halftoneEnabled.checked = s.halftoneEnabled;
  ui.halftoneShape.selectedIndex = s.shapeIndex;
  ui.halftoneFrequency.value = String(s.frequency);
  ui.halftoneAngle.value = String(s.angle);
  ui.knockoutEnabled.checked = s.knockoutEnabled;
  for (const key of SLIDER_VALUE_KEYS) levels[key] = Number(s[key]);
  normalizeLevels(levels);
  renderLevels();
  writeCleanup(s.cleanup);
  state.knockoutColor = { ...s.knockoutColor };
  state.previewColor = { ...s.previewColor };
  state.linked = s.linked;
  state.cleanupStandardPx = s.cleanupStandardPx;
  state.cleanupHighPx = s.cleanupHighPx;
  applying = false;
  renderColors();
}

function renderColors() {
  ui.knockoutSwatch.style.backgroundColor = cssColor(state.knockoutColor);
  ui.previewSwatch.style.backgroundColor = cssColor(state.previewColor);
  ui.colorLink.className = state.linked ? "link-btn active" : "link-btn";
}

function saveLast() {
  if (applying) return;
  saveJSON(STORAGE_LAST, { preset: state.presetName, settings: settingsFromUI() });
}

// Any setting change: remember it and refresh the live result.
function onSettingChanged() {
  if (applying) return;
  saveLast();
  scheduleRender();
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function loadPresets() {
  return loadJSON(STORAGE_PRESETS, {});
}

function presetNames() {
  return [DEFAULT_PRESET, ...Object.keys(loadPresets()).sort()];
}

function renderPresetPicker() {
  const names = presetNames();
  if (!names.includes(state.presetName)) state.presetName = DEFAULT_PRESET;
  applying = true;
  ui.presetOptions.innerHTML = "";
  names.forEach((name) => {
    const item = document.createElement("sp-menu-item");
    item.textContent = name;
    if (name === state.presetName) item.setAttribute("selected", "");
    ui.presetOptions.appendChild(item);
  });
  ui.preset.selectedIndex = names.indexOf(state.presetName);
  applying = false;
}

async function selectPreset(name) {
  const presets = loadPresets();
  state.presetName = name;
  applySettings(name === DEFAULT_PRESET ? DEFAULT_SETTINGS : presets[name]);
  renderPresetPicker();
  saveLast();
  await syncShirtLayer();
  scheduleRender();
}

function savePreset() {
  const name = (ui.presetName.value || "").trim();
  if (!name) return setStatus("Type a preset name first.", true);
  if (name === DEFAULT_PRESET) return setStatus(`"${DEFAULT_PRESET}" can't be overwritten.`, true);
  const presets = loadPresets();
  presets[name] = settingsFromUI();
  saveJSON(STORAGE_PRESETS, presets);
  state.presetName = name;
  ui.presetName.value = "";
  renderPresetPicker();
  saveLast();
  setStatus(`Saved preset "${name}".`, "ok");
}

async function deletePreset() {
  const name = state.presetName;
  if (name === DEFAULT_PRESET) return setStatus(`"${DEFAULT_PRESET}" can't be deleted.`, true);
  const presets = loadPresets();
  delete presets[name];
  saveJSON(STORAGE_PRESETS, presets);
  await selectPreset(DEFAULT_PRESET);
  setStatus(`Deleted preset "${name}".`, "ok");
}

// ---------------------------------------------------------------------------
// Print size
// ---------------------------------------------------------------------------

function updatePrintSize() {
  if (session) return;
  const doc = app.activeDocument;
  const key = doc ? `${doc.id}:${doc.width}x${doc.height}` : "";
  if (key === shownKey) return;
  shownKey = key;
  if (!doc) {
    aspect = 0;
    ui.printSizeLabel.textContent = "Current 300 DPI Print Size: – x – in";
    ui.scaleWidth.value = "";
    ui.scaleHeight.value = "";
    return;
  }
  // Print size at 300 DPI is the pixel size divided by 300.
  const widthIn = doc.width / PRINT_DPI;
  const heightIn = doc.height / PRINT_DPI;
  aspect = doc.width / doc.height;
  ui.printSizeLabel.textContent =
    `Current 300 DPI Print Size: ${round(widthIn, 3)} x ${round(heightIn, 3)} in`;
  ui.scaleWidth.value = round(widthIn, 2);
  ui.scaleHeight.value = round(heightIn, 2);
}

// ---------------------------------------------------------------------------
// Photoshop helpers (call inside executeAsModal)
// ---------------------------------------------------------------------------

async function selectLayer(id) {
  await batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: id }], makeVisible: false }], {});
}

function findLayer(doc, id) {
  return doc.layers.find((layer) => layer.id === id) || null;
}

// Deleting/editing a Background layer is limited, so convert it to a normal layer.
async function ensureNotBackground(doc) {
  const layer = doc.activeLayers[0];
  if (layer && layer.isBackgroundLayer) {
    await batchPlay(
      [
        {
          _obj: "set",
          _target: [{ _ref: "layer", _property: "background" }],
          to: { _obj: "layer", opacity: { _unit: "percentUnit", _value: 100 }, mode: { _enum: "blendMode", _value: "normal" } },
        },
      ],
      {}
    );
  }
}

async function readLayerRGBA(doc, layerId) {
  const { imageData, sourceBounds } = await imaging.getPixels({
    documentID: doc.id,
    layerID: layerId,
    componentSize: 8,
    applyAlpha: false,
    colorSpace: "RGB",
  });
  const { width, height, components } = imageData;
  const data = await imageData.getData();
  imageData.dispose();
  if (components === 4) return { rgba: data, width, height, bounds: sourceBounds };
  // Opaque layer without alpha: expand to RGBA.
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, p = 0, q = 0; i < width * height; i++, p += 3, q += 4) {
    rgba[q] = data[p];
    rgba[q + 1] = data[p + 1];
    rgba[q + 2] = data[p + 2];
    rgba[q + 3] = 255;
  }
  return { rgba, width, height, bounds: sourceBounds };
}

async function writeLayerRGBA(doc, layerId, rgba, width, height, bounds) {
  const options = { width, height, components: 4, chunky: true, colorSpace: "RGB" };
  // Tag the pixels with the document's profile so Photoshop doesn't reject or convert them.
  let imageData;
  try {
    imageData = await imaging.createImageDataFromBuffer(
      rgba,
      doc.colorProfileName ? { ...options, colorProfile: doc.colorProfileName } : options
    );
  } catch (err) {
    console.warn("[DTF Fast Prep] image data with document profile failed; retrying without", err);
    imageData = await imaging.createImageDataFromBuffer(rgba, options);
  }
  await imaging.putPixels({
    documentID: doc.id,
    layerID: layerId,
    imageData,
    targetBounds: { left: bounds.left, top: bounds.top },
    replace: true,
  });
  imageData.dispose();
}

// ---------------------------------------------------------------------------
// Run DTF Fast Prep: build the new document and enter edit mode
// ---------------------------------------------------------------------------

function validateHalftone(s) {
  if (!s.halftoneEnabled) return;
  if (!(s.frequency > 0)) throw new Error("Frequency / Inch must be a number greater than 0.");
  if (!Number.isFinite(s.angle) || s.angle < -180 || s.angle > 180) throw new Error("Angle must be between -180 and 180.");
}

async function runFastPrep() {
  if (isBusy(ui.run)) return;
  const doc = app.activeDocument;
  if (!doc) return setStatus("Open a document first.", true);

  const widthIn = readNumber(ui.scaleWidth);
  const heightIn = readNumber(ui.scaleHeight);
  try {
    validateHalftone(settingsFromUI());
    if (!(widthIn > 0 && heightIn > 0)) throw new Error("Enter a valid Scale to size.");
  } catch (err) {
    return setStatus(err.message, true);
  }

  setBusy(ui.run, true, "WORKING…");
  setStatus("Creating the DTF Fast Prep document…", "busy");
  try {
    session = await core.executeAsModal(
      async () => {
        const baseName = doc.title.replace(/\.[^.]+$/, "");
        // Merged copy: one layer with the visible artwork, transparency kept.
        const newDoc = await doc.duplicate(`${baseName} - DTF Fast Prep`, true);
        app.activeDocument = newDoc;
        log(`duplicated "${doc.title}" -> document ${newDoc.id} (${newDoc.layers.length} layer(s), mode ${newDoc.mode})`);

        if (newDoc.mode !== constants.DocumentMode.RGB) await newDoc.changeMode(constants.ChangeMode.RGB);
        if (newDoc.bitsPerChannel !== constants.BitsPerChannelType.EIGHT) {
          newDoc.bitsPerChannel = constants.BitsPerChannelType.EIGHT;
        }
        await newDoc.resizeImage(Math.round(widthIn * PRINT_DPI), Math.round(heightIn * PRINT_DPI), PRINT_DPI);
        log(`resized to ${newDoc.width}x${newDoc.height} px at ${newDoc.resolution} DPI`);

        await selectLayer(newDoc.layers[0].id);
        await ensureNotBackground(newDoc);
        // While editing, the document has just this one locked preview layer.
        // The source pixels stay in memory; Apply rebuilds the real layers.
        const preview = newDoc.activeLayers[0];
        preview.name = LAYER_PREVIEW;
        const source = await readLayerRGBA(newDoc, preview.id);
        let softSource = 0;
        for (let p = 3; p < source.rgba.length; p += 4) if (source.rgba[p] !== 0 && source.rgba[p] !== 255) softSource++;
        log(`read source: ${source.width}x${source.height} px, ${softSource} semi-transparent px`);
        preview.allLocked = true;

        return {
          doc: newDoc,
          previewId: preview.id,
          source: source.rgba,
          width: source.width,
          height: source.height,
          bounds: source.bounds,
          cache: {},
          rgba: null,
          alpha: null,
          view: "alpha",
          closing: false,
        };
      },
      { commandName: "DTF Fast Prep" }
    );
    log(`edit session ready: ${session.width}x${session.height} px at (${session.bounds.left}, ${session.bounds.top})`);
    enterEditMode();
    // Show the Fast Halftone result first; hiding panels must never block it.
    await renderNow();
    hidePanelsSafely();
  } catch (err) {
    session = null;
    showError(err);
  } finally {
    setBusy(ui.run, false);
  }
}

// ---------------------------------------------------------------------------
// Live rendering
// ---------------------------------------------------------------------------

let renderTimer = null;
let rendering = false;
let renderAgain = false;

function scheduleRender() {
  if (!session) return;
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderNow();
  }, RENDER_DELAY_MS);
}

function pipelineSettings(s) {
  return {
    dpi: PRINT_DPI,
    frequency: s.frequency,
    angle: s.angle,
    shape: SHAPES[s.shapeIndex],
    halftone: s.halftoneEnabled,
    knockout: { enabled: s.knockoutEnabled, color: s.knockoutColor },
    levelsBlack: s.levelsBlack,
    levelsGamma: s.levelsGamma,
    levelsWhite: s.levelsWhite,
    outputLow: s.outputLow,
    outputHigh: s.outputHigh,
    boostShadow: s.boostShadow,
    cleanup: s.cleanup,
    cleanupStandardPx: s.cleanupStandardPx,
    cleanupHighPx: s.cleanupHighPx,
    originX: session.bounds.left,
    originY: session.bounds.top,
  };
}

async function renderNow() {
  if (!session || session.closing) return;
  if (rendering) {
    renderAgain = true;
    return;
  }
  const s = settingsFromUI();
  try {
    validateHalftone(s);
  } catch (err) {
    return setStatus(err.message, true);
  }

  rendering = true;
  setStatus("Updating…", "busy");
  let stage = "Processing pixels";
  try {
    const current = session;
    const started = Date.now();
    const { rgba, alpha, shape } = H.prepPixels(current.source, current.width, current.height, pipelineSettings(s), current.cache);
    current.rgba = rgba;
    current.alpha = alpha;
    current.shape = shape;
    log(`processed in ${Date.now() - started} ms (halftone ${s.halftoneEnabled ? "on" : "off"}, knockout ${s.knockoutEnabled ? "on" : "off"})`);

    stage = "Writing the preview layer";
    await core.executeAsModal(
      async () => {
        await writePreview(current);
        // The first time, read the layer back to prove Photoshop took the new pixels.
        if (!current.verified) {
          stage = "Checking the preview layer";
          await verifyPreview(current, s);
          current.verified = true;
        }
      },
      { commandName: "Fast Halftone Preview" }
    );
    log(`preview written in ${Date.now() - started} ms total`);
    setStatus("");
  } catch (err) {
    showError(new Error(`${stage}: ${(err && err.message) || err}`));
  } finally {
    rendering = false;
    if (renderAgain) {
      renderAgain = false;
      renderNow();
    }
  }
}

// Pixels the preview layer shows for the current view, as { rgba, width, height, bounds }.
function viewPixels(current) {
  const { view, source, rgba, alpha, width, height, bounds } = current;
  const region = { width, height, bounds };
  if (view === "original" || !rgba) return { rgba: source, ...region };
  if (view === "alpha") return { rgba, ...region };

  const count = width * height;
  if (view === "mask") {
    // White = ink, black = clear.
    const out = new Uint8Array(count * 4);
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      out[p] = out[p + 1] = out[p + 2] = alpha[i];
      out[p + 3] = 255;
    }
    return { rgba: out, ...region };
  }

  // Shirt: the result over the shirt color, filling the whole document.
  const docW = current.doc.width;
  const docH = current.doc.height;
  const { r, g, b } = state.previewColor;
  const out = new Uint8Array(docW * docH * 4);
  for (let p = 0; p < out.length; p += 4) {
    out[p] = r;
    out[p + 1] = g;
    out[p + 2] = b;
    out[p + 3] = 255;
  }
  for (let y = 0; y < height; y++) {
    const dy = y + bounds.top;
    if (dy < 0 || dy >= docH) continue;
    for (let x = 0; x < width; x++) {
      const dx = x + bounds.left;
      if (dx < 0 || dx >= docW) continue;
      const s = (y * width + x) * 4;
      const a = rgba[s + 3] / 255;
      if (a === 0) continue;
      const d = (dy * docW + dx) * 4;
      out[d] = rgba[s] * a + r * (1 - a);
      out[d + 1] = rgba[s + 1] * a + g * (1 - a);
      out[d + 2] = rgba[s + 2] * a + b * (1 - a);
    }
  }
  return { rgba: out, width: docW, height: docH, bounds: { left: 0, top: 0 } };
}

// Call inside executeAsModal. Reads the preview layer back and throws if it doesn't hold
// what was just written (e.g. still the original soft, unknocked-out artwork).
async function verifyPreview(current, s) {
  if (current.view !== "alpha" && current.view !== "mask") return;
  const back = await readLayerRGBA(current.doc, current.previewId);
  let expectedVisible = 0;
  for (let i = 0; i < current.alpha.length; i++) if (current.alpha[i]) expectedVisible++;
  let visible = 0;
  let soft = 0;
  for (let p = 3; p < back.rgba.length; p += 4) {
    const a = back.rgba[p];
    if (a) visible++;
    if (a !== 0 && a !== 255) soft++;
  }
  log(`check: ${visible} visible px (expected ${expectedVisible}), ${soft} semi-transparent px`);
  if (current.view === "mask") return;
  const tolerance = Math.max(50, expectedVisible * 0.01);
  if ((s.halftoneEnabled && soft > tolerance) || Math.abs(visible - expectedVisible) > tolerance) {
    throw new Error(
      `Fast Halftone preview didn't update. Photoshop still shows ${visible} visible / ${soft} semi-transparent px; ` +
        `expected ${expectedVisible} / 0. See ••• → Debug for details.`
    );
  }
}

// Call inside executeAsModal. The preview layer is unlocked only while it is written.
async function writePreview(current) {
  const layer = findLayer(current.doc, current.previewId);
  if (!layer) throw new Error("The DTF Fast Prep preview layer is missing.");
  const { rgba, width, height, bounds } = viewPixels(current);
  layer.allLocked = false;
  try {
    await writeLayerRGBA(current.doc, current.previewId, rgba, width, height, bounds);
  } finally {
    layer.allLocked = true;
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

async function setView(view) {
  if (!session) return;
  session.view = view;
  ui.viewRow.querySelectorAll(".seg").forEach((btn) => {
    btn.classList.toggle("selected", btn.getAttribute("data-view") === view);
  });
  const current = session;
  try {
    await core.executeAsModal(() => writePreview(current), { commandName: "DTF Fast Prep View" });
  } catch (err) {
    showError(err);
  }
}

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

function enterEditMode() {
  show(ui.printSection, false);
  show(ui.setupActions, false);
  show(ui.halftoneSection, false);
  show(ui.editSection, true);
  ui.viewRow.querySelectorAll(".seg").forEach((btn) => {
    btn.classList.toggle("selected", btn.getAttribute("data-view") === "alpha");
  });
  setStatus("");
}

function exitEditMode() {
  session = null;
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = null;
  show(ui.editSection, false);
  show(ui.printSection, true);
  show(ui.setupActions, true);
  show(ui.halftoneSection, true);
  shownKey = "";
  updatePrintSize();
  restoreEditingPanels().catch((err) => console.warn("Could not restore panels", err));
}

function sessionAlive() {
  return session && app.documents.some((d) => d.id === session.doc.id);
}

// ---------------------------------------------------------------------------
// Hide the Layers and Properties panels while editing (restored on exit)
// ---------------------------------------------------------------------------

const PANELS_TO_HIDE = [
  { title: "Layers", idHint: "layers" },
  { title: "Properties", idHint: "properties" },
];
const STORAGE_MENU_IDS = "dtffastprep.menuCommandIds";
// Window-menu command IDs aren't documented, so they're found by title once.
const MENU_SCAN_FROM = 1000;
const MENU_SCAN_TO = 4000;
let hiddenPanelCommands = [];

// Photoshop's panel list: [{ name, ID, visible, obscured }, …].
async function panelVisibility() {
  const result = await batchPlay(
    [{ _obj: "get", _target: [{ _property: "panelList" }, { _ref: "application", _enum: "ordinal", _value: "targetEnum" }] }],
    {}
  );
  const list = (result && result[0] && result[0].panelList) || [];
  return list;
}

function isPanelVisible(list, panel) {
  const entry = list.find(
    (p) => (p.name || "").toLowerCase() === panel.title.toLowerCase() || (p.ID || "").toLowerCase().includes(panel.idHint)
  );
  return entry ? Boolean(entry.visible) && !entry.obscured : null;
}

async function findMenuCommand(title) {
  const cached = loadJSON(STORAGE_MENU_IDS, {});
  if (cached[title]) {
    const check = await core.getMenuCommandTitle({ commandID: cached[title] });
    if (check === title) return cached[title];
  }
  for (let start = MENU_SCAN_FROM; start < MENU_SCAN_TO; start += 100) {
    const ids = [];
    for (let id = start; id < start + 100; id++) ids.push(id);
    const titles = await Promise.all(ids.map((id) => core.getMenuCommandTitle({ commandID: id }).catch(() => "")));
    const index = titles.findIndex((t) => (t || "").replace(/&/g, "").trim() === title);
    if (index !== -1) {
      cached[title] = ids[index];
      saveJSON(STORAGE_MENU_IDS, cached);
      return ids[index];
    }
  }
  return null;
}

const withTimeout = (promise, ms, label) =>
  Promise.race([promise, new Promise((resolve, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms))]);

// Hides the panels in the background with a time limit; failures only log a warning.
async function hidePanelsSafely() {
  enforcing = true;
  try {
    await withTimeout(hideEditingPanels(), 3000, "Hiding the Layers/Properties panels");
    log(`panels hidden: ${hiddenPanelCommands.length}`);
  } catch (err) {
    console.warn("[DTF Fast Prep] Could not hide the Layers/Properties panels", err);
  } finally {
    enforcing = false;
  }
}

async function hideEditingPanels() {
  const list = await panelVisibility();
  for (const panel of PANELS_TO_HIDE) {
    if (isPanelVisible(list, panel) !== true) continue;
    const commandID = await findMenuCommand(panel.title);
    if (!commandID) {
      console.warn(`No Window menu command found for the ${panel.title} panel`);
      continue;
    }
    await core.executeAsModal(() => core.performMenuCommand({ commandID }), { commandName: `Hide ${panel.title}` });
    hiddenPanelCommands.push(commandID);
  }
}

async function restoreEditingPanels() {
  const commands = hiddenPanelCommands;
  hiddenPanelCommands = [];
  for (const commandID of commands) {
    await core.executeAsModal(() => core.performMenuCommand({ commandID }), { commandName: "Show panel" });
  }
}

// While editing, keep the user on the preview layer of the new document,
// like a modal dialog: Apply or Cancel first.
const LEAVE_WARNING = "Please add your edits within the DTF FAST PREP Plugin before continuing";
let enforcing = false;
async function keepSessionFocus() {
  if (!session || session.closing || enforcing || !sessionAlive()) return;
  const current = session;
  const doc = app.activeDocument;
  const onDoc = doc && doc.id === current.doc.id;
  const active = onDoc ? doc.activeLayers : [];
  if (onDoc && active.length === 1 && active[0].id === current.previewId) return;

  enforcing = true;
  try {
    // Blocks until the user clicks OK.
    await app.showAlert(LEAVE_WARNING);
    if (!session || session.closing || !sessionAlive()) return;
    await core.executeAsModal(
      async () => {
        if (!app.activeDocument || app.activeDocument.id !== current.doc.id) app.activeDocument = current.doc;
        await selectLayer(current.previewId);
      },
      { commandName: "DTF Fast Prep" }
    );
  } catch (err) {
    console.warn("Could not return to the DTF Fast Prep document", err);
  } finally {
    enforcing = false;
  }
}

async function flushRender() {
  if (renderTimer) {
    clearTimeout(renderTimer);
    renderTimer = null;
    await renderNow();
  }
  while (rendering) await new Promise((resolve) => setTimeout(resolve, 50));
}

// Apply: the preview layer becomes the hidden "Original", and a "DTF Fast Prep"
// layer gets the solid colors with the Fast Halftone dots as its layer mask.
async function applyResult() {
  if (!sessionAlive()) return exitEditMode();
  if (session.closing || isBusy(ui.apply)) return;
  setBusy(ui.apply, true, "APPLYING…");
  setStatus("Applying…", "busy");
  try {
    await applyNow();
  } finally {
    setBusy(ui.apply, false);
  }
}

async function applyNow() {
  await flushRender();
  const current = session;
  if (!current.rgba) return setStatus("Nothing to apply yet.", true);
  current.closing = true;
  const { doc, width, height, bounds } = current;
  let masked = true;

  try {
    await core.executeAsModal(
      async (executionContext) => {
        app.activeDocument = doc;
        const suspensionID = await executionContext.hostControl.suspendHistory({
          documentID: doc.id,
          name: "Apply DTF Fast Prep",
        });
        try {
          const original = findLayer(doc, current.previewId);
          original.allLocked = false;
          await writeLayerRGBA(doc, original.id, current.source, width, height, bounds);
          original.name = LAYER_ORIGINAL;

          // Result layer above the original: colors fully opaque, dots from the mask.
          await selectLayer(original.id);
          await batchPlay([{ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name: LAYER_RESULT } }], {});
          const result = doc.activeLayers[0];
          // Colors under the mask take the nearest artwork color, so
          // editing the mask later never reveals the old dark background.
          const solid = new Uint8Array(current.rgba);
          H.extendEdgeColors(solid, current.shape, width, height);
          for (let p = 3; p < solid.length; p += 4) solid[p] = 255;
          await writeLayerRGBA(doc, result.id, solid, width, height, bounds);

          try {
            await batchPlay(
              [
                {
                  _obj: "make",
                  new: { _class: "channel" },
                  at: { _ref: "channel", _enum: "channel", _value: "mask" },
                  using: { _enum: "userMaskEnabled", _value: "revealAll" },
                },
              ],
              {}
            );
            const maskData = await imaging.createImageDataFromBuffer(current.alpha, {
              width,
              height,
              components: 1,
              chunky: true,
              colorSpace: "Grayscale",
            });
            await imaging.putLayerMask({
              documentID: doc.id,
              layerID: result.id,
              imageData: maskData,
              targetBounds: { left: bounds.left, top: bounds.top },
              replace: true,
            });
            maskData.dispose();
          } catch (err) {
            // No layer mask support: put the dots in the layer's transparency instead.
            console.warn("Layer mask failed; writing transparency instead", err);
            masked = false;
            try {
              await batchPlay([{ _obj: "delete", _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }] }], {});
            } catch (ignored) {
              // No mask was created.
            }
            await writeLayerRGBA(doc, result.id, current.rgba, width, height, bounds);
          }

          original.visible = false;
          await selectLayer(result.id);
          await executionContext.hostControl.resumeHistory(suspensionID, true);
        } catch (err) {
          await executionContext.hostControl.resumeHistory(suspensionID, false);
          throw err;
        }
      },
      { commandName: "Apply DTF Fast Prep" }
    );
    exitEditMode();
    setStatus(
      masked
        ? "Applied. Fast Halftone is the DTF Fast Prep layer's mask; Original is hidden below."
        : "Applied. Fast Halftone is in the DTF Fast Prep layer's transparency; Original is hidden below.",
      "ok"
    );
  } catch (err) {
    current.closing = false;
    showError(err);
  }
}

async function cancelSession() {
  if (!sessionAlive()) return exitEditMode();
  if (session.closing) return;
  const current = session;
  current.closing = true;
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = null;
  while (rendering) await new Promise((resolve) => setTimeout(resolve, 50));
  try {
    await core.executeAsModal(() => current.doc.closeWithoutSaving(), { commandName: "Cancel DTF Fast Prep" });
  } catch (err) {
    showError(err);
  }
  exitEditMode();
  setStatus("Cancelled.", "ok");
}

async function resetSliders() {
  applying = true;
  for (const key of SLIDER_VALUE_KEYS) levels[key] = DEFAULT_SETTINGS[key];
  renderLevels();
  writeCleanup(DEFAULT_SETTINGS.cleanup);
  applying = false;
  onSettingChanged();
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

// Opens Photoshop's color picker. Returns {r, g, b}, or null if cancelled.
async function pickColor(initial, title) {
  const result = await core.executeAsModal(
    () => batchPlay([{ _obj: "showColorPicker", context: title, color: rgbDescriptor(initial) }], {}),
    { commandName: title }
  );
  const c = result && result[0] && (result[0].RGBFloatColor || result[0].color);
  if (!c || c.red === undefined) return null;
  return { r: Math.round(c.red), g: Math.round(c.grain), b: Math.round(c.blue) };
}

// The Shirt view is drawn from the preview color, so just redraw it.
function syncShirtLayer() {
  if (session && session.view === "shirt") scheduleRender();
}

async function onPickKnockoutColor() {
  try {
    const color = await pickColor(state.knockoutColor, "Knockout Color");
    if (!color) return;
    state.knockoutColor = color;
    if (state.linked) {
      state.previewColor = { ...color };
      await syncShirtLayer();
    }
    renderColors();
    onSettingChanged();
  } catch (err) {
    showError(err);
  }
}

async function onPickPreviewColor() {
  try {
    const color = await pickColor(state.previewColor, "Shirt/BG Preview Color");
    if (!color) return;
    state.previewColor = color;
    if (state.linked) state.knockoutColor = { ...color };
    renderColors();
    if (session) await setView("shirt");
    onSettingChanged();
  } catch (err) {
    showError(err);
  }
}

async function onToggleLink() {
  state.linked = !state.linked;
  try {
    if (state.linked) {
      state.previewColor = { ...state.knockoutColor };
      await syncShirtLayer();
    }
  } catch (err) {
    showError(err);
  }
  renderColors();
  saveLast();
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function showHelp() {
  ui.helpDialog.uxpShowModal({ title: "DTF Fast Prep Help", resize: "none" });
}

function showSettings() {
  ui.settingCleanupStandard.value = String(state.cleanupStandardPx);
  ui.settingCleanupHigh.value = String(state.cleanupHighPx);
  ui.settingsDialog.uxpShowModal({ title: "DTF Fast Prep Settings", resize: "none" });
}

function saveSettingsDialog() {
  const standard = Math.round(readNumber(ui.settingCleanupStandard));
  const high = Math.round(readNumber(ui.settingCleanupHigh));
  if (!(standard >= 1 && standard <= 500) || !(high >= 1 && high <= 500)) {
    setStatus("Cleanup sizes must be between 1 and 500 px.", true);
    return;
  }
  state.cleanupStandardPx = standard;
  state.cleanupHighPx = high;
  ui.settingsDialog.close();
  onSettingChanged();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

// Keep "Scale to" proportional to the document.
ui.scaleWidth.addEventListener("input", () => {
  const w = readNumber(ui.scaleWidth);
  if (aspect && w > 0) ui.scaleHeight.value = round(w / aspect, 2);
});
ui.scaleHeight.addEventListener("input", () => {
  const h = readNumber(ui.scaleHeight);
  if (aspect && h > 0) ui.scaleWidth.value = round(h * aspect, 2);
});

// Typing in a slider's number field moves its handle.
for (const key of SLIDER_VALUE_KEYS) {
  const { field } = levelFields[key];
  field.addEventListener("change", () => {
    if (applying) return;
    const value = readNumber(field);
    if (Number.isFinite(value)) levels[key] = value;
    normalizeLevels(levels);
    onSliderMoved();
  });
}

[ui.halftoneEnabled, ui.knockoutEnabled, ui.halftoneShape, ui.cleanup].forEach((el) =>
  el.addEventListener("change", onSettingChanged)
);
[ui.halftoneFrequency, ui.halftoneAngle].forEach((el) => el.addEventListener("input", onSettingChanged));

ui.preset.addEventListener("change", () => {
  if (applying) return;
  const name = presetNames()[ui.preset.selectedIndex];
  if (name) selectPreset(name).catch(showError);
});
ui.presetMenuToggle.addEventListener("click", () => ui.presetMenu.classList.toggle("hidden"));
ui.presetSave.addEventListener("click", savePreset);
ui.presetDelete.addEventListener("click", () => deletePreset().catch(showError));
ui.presetReset.addEventListener("click", () => selectPreset(DEFAULT_PRESET).catch(showError));

ui.knockoutSwatch.addEventListener("click", onPickKnockoutColor);
ui.previewSwatch.addEventListener("click", onPickPreviewColor);
ui.colorLink.addEventListener("click", onToggleLink);

ui.run.addEventListener("click", runFastPrep);
ui.defaultSliders.addEventListener("click", resetSliders);
ui.editHalftones.addEventListener("click", () => ui.halftoneSection.classList.toggle("hidden"));
ui.viewRow.querySelectorAll(".seg").forEach((btn) =>
  btn.addEventListener("click", () => setView(btn.getAttribute("data-view")))
);
ui.apply.addEventListener("click", applyResult);
ui.cancel.addEventListener("click", cancelSession);

ui.help.addEventListener("click", showHelp);
ui.helpClose.addEventListener("click", () => ui.helpDialog.close());
ui.settings.addEventListener("click", showSettings);
ui.settingsSave.addEventListener("click", saveSettingsDialog);
ui.settingsCancel.addEventListener("click", () => ui.settingsDialog.close());

ui.siteLink.addEventListener("click", () => {
  shell.openExternal(SITE_URL, "Open the Mr300dpi website");
});

// Refresh the print size on document changes. While editing, keep the user on the
// preview layer, and leave edit mode if its document is closed.
action.addNotificationListener(["select", "open", "close", "make", "imageSize", "canvasSize"], (event) => {
  if (session) {
    if (event === "close" && !sessionAlive()) {
      exitEditMode();
      setStatus("The DTF Fast Prep document was closed.");
      return;
    }
    if (event === "select" || event === "make" || event === "open") keepSessionFocus();
    return;
  }
  updatePrintSize();
});

// Restore the last session's settings.
const last = loadJSON(STORAGE_LAST, null);
if (last) state.presetName = last.preset || DEFAULT_PRESET;
renderPresetPicker();
applySettings(last ? last.settings : DEFAULT_SETTINGS);
updatePrintSize();
