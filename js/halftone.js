// Fast Halftone: pure pixel processing for DTF Fast Prep.
// No Photoshop, DOM, or Node APIs, so it runs in the UXP panel and in Node tests.

(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Tunable constants (panel defaults; every one can be overridden per run)
  // ---------------------------------------------------------------------------
  const DEFAULTS = {
    // Halftone screen
    dpi: 300, //            document resolution (dots are sized in inches)
    frequency: 30, //       dot lines per inch
    angle: 33, //           screen angle in degrees
    shape: "round", //      "round" | "elliptical" | "line"
    ellipseRatio: 0.6, //   minor/major axis of elliptical dots

    // Alpha shaping (applied before the halftone)
    levelsBlack: 7, //      alpha (0–255) at or below which pixels become clear
    levelsGamma: 1.0, //    midtone; > 1 makes semi-transparent areas more opaque
    levelsWhite: 255, //    alpha (0–255) at or above which pixels become solid
    outputLow: 0, //        lowest output alpha (0–255)
    outputHigh: 255, //     highest output alpha; < 255 forces solid areas into dots
    boostShadow: 0, //      0–100, strengthens faint/soft areas

    // Post cleanup: remove specks smaller than this many pixels
    cleanup: "standard", // "none" | "standard" | "high"
    cleanupStandardPx: 4,
    cleanupHighPx: 12,

  };

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // ---------------------------------------------------------------------------
  // Color knockout ("color to alpha")
  // ---------------------------------------------------------------------------

  // Per-channel distance from the knockout color, scaled so the farthest
  // possible value in that direction is 1. Alpha is the largest channel.
  function knockoutAlpha(rgba, pixelCount, color) {
    const k = [color.r, color.g, color.b];
    const out = new Uint8Array(pixelCount);
    // Lookup tables per channel: value -> 0..1 distance.
    const luts = k.map((kc) => {
      const lut = new Float32Array(256);
      for (let c = 0; c < 256; c++) {
        if (c > kc) lut[c] = (c - kc) / (255 - kc);
        else if (c < kc) lut[c] = (kc - c) / kc;
        else lut[c] = 0;
      }
      return lut;
    });
    const [lr, lg, lb] = luts;
    for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
      let a = lr[rgba[p]];
      const g = lg[rgba[p + 1]];
      const b = lb[rgba[p + 2]];
      if (g > a) a = g;
      if (b > a) a = b;
      out[i] = Math.round(a * 255);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Alpha curve: boost shadow -> levels -> output levels, as a 256-entry table
  // ---------------------------------------------------------------------------

  function buildAlphaLut(s) {
    const lut = new Uint8Array(256);
    const black = s.levelsBlack / 255;
    let white = s.levelsWhite / 255;
    if (white <= black) white = black + 1 / 255;
    const invGamma = 1 / Math.max(0.01, s.levelsGamma);
    const boostExp = 1 + s.boostShadow / 25;
    const low = s.outputLow;
    const high = s.outputHigh;
    for (let v = 1; v < 256; v++) {
      let a = v / 255;
      if (s.boostShadow > 0) a = 1 - Math.pow(1 - a, boostExp);
      a = clamp01((a - black) / (white - black));
      a = Math.pow(a, invGamma);
      lut[v] = Math.round(low + a * (high - low));
    }
    lut[0] = 0; // fully transparent pixels stay transparent
    return lut;
  }

  // ---------------------------------------------------------------------------
  // Halftone
  // ---------------------------------------------------------------------------

  // Turns 0–255 alpha into 0/255 dots. Coverage of each dot matches the alpha.
  // originX/originY anchor the grid to document pixel (0, 0).
  function halftoneAlpha(alpha, width, height, options) {
    const s = Object.assign({}, DEFAULTS, options);
    const out = new Uint8Array(width * height);
    const cell = s.dpi / s.frequency;
    const inv = 1 / cell;
    const theta = (s.angle * Math.PI) / 180;
    const cos = Math.cos(theta) * inv;
    const sin = Math.sin(theta) * inv;
    const ox = s.originX || 0;
    const oy = s.originY || 0;
    const shape = s.shape;
    const k = s.ellipseRatio;
    const PI = Math.PI;

    for (let y = 0, i = 0; y < height; y++) {
      const py = y + oy + 0.5;
      let u = (ox + 0.5) * cos + py * sin;
      let v = -(ox + 0.5) * sin + py * cos;
      for (let x = 0; x < width; x++, i++, u += cos, v -= sin) {
        const a = alpha[i];
        if (a === 0) continue;
        if (a === 255) {
          out[i] = 255;
          continue;
        }
        const fu = u - Math.floor(u) - 0.5;
        const fv = v - Math.floor(v) - 0.5;
        let threshold;
        if (shape === "line") threshold = 2 * Math.abs(fv);
        else if (shape === "elliptical") threshold = PI * (k * fu * fu + (fv * fv) / k);
        else threshold = PI * (fu * fu + fv * fv);
        if (a / 255 > threshold) out[i] = 255;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Post cleanup
  // ---------------------------------------------------------------------------

  // Clears 4-connected specks (alpha > 0) smaller than minSize pixels, in place.
  // Each search stops as soon as a piece is known to be big enough, so memory
  // stays small even on large images.
  function cleanupAlpha(alpha, width, height, minSize) {
    if (minSize <= 1) return alpha;
    const KEEP = 1;
    const state = new Uint8Array(width * height);
    const queue = new Int32Array(minSize + 4);
    const total = width * height;

    for (let start = 0; start < total; start++) {
      if (alpha[start] === 0 || state[start] !== 0) continue;
      let head = 0;
      let tail = 0;
      let big = false;
      queue[tail++] = start;
      state[start] = 2; // in progress

      while (head < tail && !big) {
        const p = queue[head++];
        const x = p % width;
        for (let n = 0; n < 4; n++) {
          let q;
          if (n === 0) {
            if (x === 0) continue;
            q = p - 1;
          } else if (n === 1) {
            if (x === width - 1) continue;
            q = p + 1;
          } else {
            q = n === 2 ? p - width : p + width;
          }
          if (q < 0 || q >= total || alpha[q] === 0) continue;
          if (state[q] === KEEP) {
            big = true;
            break;
          }
          if (state[q] !== 0) continue;
          if (tail >= minSize) {
            big = true;
            break;
          }
          state[q] = 2;
          queue[tail++] = q;
        }
      }

      if (big) {
        for (let j = 0; j < tail; j++) state[queue[j]] = KEEP;
      } else {
        for (let j = 0; j < tail; j++) {
          alpha[queue[j]] = 0;
          state[queue[j]] = 3; // removed
        }
      }
    }
    return alpha;
  }

  // ---------------------------------------------------------------------------
  // Edge color extension (used on Apply)
  // ---------------------------------------------------------------------------

  // Growable Int32 list (pixel indexes) without per-push allocation.
  function makeList(capacity) {
    return { data: new Int32Array(capacity), length: 0 };
  }
  function push(list, value) {
    if (list.length === list.data.length) {
      const bigger = new Int32Array(list.data.length * 2);
      bigger.set(list.data);
      list.data = bigger;
    }
    list.data[list.length++] = value;
  }

  // Fills the colors of pixels outside `shape` with the nearest shape pixel's color
  // (multi-source flood fill), in place, so a layer mask edited later never reveals
  // dark background under the edges. Alpha is untouched.
  function extendEdgeColors(rgba, shape, width, height) {
    const n = width * height;
    const filled = new Uint8Array(shape);
    let frontier = makeList(4096);
    for (let i = 0; i < n; i++) if (filled[i]) push(frontier, i);
    while (frontier.length) {
      const next = makeList(Math.max(1024, frontier.length));
      for (let f = 0; f < frontier.length; f++) {
        const p = frontier.data[f];
        const x = p % width;
        for (let k = 0; k < 4; k++) {
          let q;
          if (k === 0) {
            if (x === 0) continue;
            q = p - 1;
          } else if (k === 1) {
            if (x === width - 1) continue;
            q = p + 1;
          } else {
            q = k === 2 ? p - width : p + width;
          }
          if (q < 0 || q >= n || filled[q]) continue;
          filled[q] = 1;
          rgba[q * 4] = rgba[p * 4];
          rgba[q * 4 + 1] = rgba[p * 4 + 1];
          rgba[q * 4 + 2] = rgba[p * 4 + 2];
          push(next, q);
        }
      }
      frontier = next;
    }
    return rgba;
  }

  // ---------------------------------------------------------------------------
  // Full DTF Fast Prep pipeline
  // ---------------------------------------------------------------------------

  // source: RGBA Uint8Array (unpremultiplied). Returns { rgba, alpha, shape }:
  //   rgba  = source colors + final 0/255 alpha
  //   alpha = final alpha
  //   shape = 1 where the art is visible before the halftone (the artwork outline)
  // settings: DEFAULTS keys plus
  //   halftone: boolean, knockout: { enabled, color: {r,g,b} },
  //   originX/originY: offset of this region in the document.
  // cache: optional object reused between calls; the knockout and shape are only
  // recomputed when their inputs change.
  function prepPixels(source, width, height, settings, cache) {
    const s = Object.assign({}, DEFAULTS, settings);
    const count = width * height;
    cache = cache || {};

    // 1. Base alpha = source alpha x knockout alpha.
    const knock = s.knockout && s.knockout.enabled ? s.knockout.color : null;
    const key = knock ? `${knock.r},${knock.g},${knock.b}` : "none";
    if (cache.key !== key || cache.source !== source) {
      cache.knockAlpha = knock ? knockoutAlpha(source, count, knock) : null;
      const base = new Uint8Array(count);
      for (let i = 0, p = 3; i < count; i++, p += 4) {
        base[i] = cache.knockAlpha ? Math.round((source[p] * cache.knockAlpha[i]) / 255) : source[p];
      }
      cache.base = base;
      cache.key = key;
      cache.source = source;
    }

    // 2. Alpha curve.
    const lut = buildAlphaLut(s);
    let alpha = new Uint8Array(count);
    const base = cache.base;
    for (let i = 0; i < count; i++) alpha[i] = lut[base[i]];

    // Artwork outline before the halftone. It only depends on which base alpha values
    // survive the curve, so it is cached on that.
    let firstVisible = 256;
    for (let v = 1; v < 256; v++) {
      if (lut[v] > 0) {
        firstVisible = v;
        break;
      }
    }
    const shapeKey = `${key}|${firstVisible}`;
    if (cache.shapeKey !== shapeKey || cache.shapeSource !== source) {
      const shape = new Uint8Array(count);
      for (let i = 0; i < count; i++) shape[i] = base[i] >= firstVisible ? 1 : 0;
      cache.shape = shape;
      cache.shapeKey = shapeKey;
      cache.shapeSource = source;
    }
    // 3. Halftone.
    if (s.halftone !== false) alpha = halftoneAlpha(alpha, width, height, s);

    // 4. Cleanup.
    const minSize = s.cleanup === "high" ? s.cleanupHighPx : s.cleanup === "standard" ? s.cleanupStandardPx : 0;
    if (minSize > 1) cleanupAlpha(alpha, width, height, minSize);

    // 5. Source colors + new alpha.
    const rgba = new Uint8Array(source);
    for (let i = 0, p = 3; i < count; i++, p += 4) rgba[p] = alpha[i];
    return { rgba, alpha, shape: cache.shape };
  }

  const api = {
    DEFAULTS,
    knockoutAlpha,
    buildAlphaLut,
    halftoneAlpha,
    cleanupAlpha,
    extendEdgeColors,
    prepPixels,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DTFHalftone = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
