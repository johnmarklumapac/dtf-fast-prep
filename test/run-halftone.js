// Fast Halftone test harness: runs the DTF Fast Prep pipeline (knockout, levels,
// Fast Halftone, cleanup) on a PNG and writes three images to inspect:
//   <name>-alpha.png   result on transparency
//   <name>-shirt.png   result composited on the shirt color
//   <name>-mask.png    the dot mask (white = ink)
//
// Usage: node test/run-halftone.js <input.png> [settings-json]
// Example: node test/run-halftone.js test/sample.png "{\"frequency\":45,\"shape\":\"line\"}"

const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const { prepPixels } = require("../js/halftone.js");

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node test/run-halftone.js <input.png> [settings-json]");
  process.exit(1);
}

const settings = Object.assign(
  { halftone: true, knockout: { enabled: true, color: { r: 0, g: 0, b: 0 } } },
  process.argv[3] ? JSON.parse(process.argv[3]) : {}
);
const shirt = settings.shirtColor || settings.knockout.color;

const src = PNG.sync.read(fs.readFileSync(inputPath));
const { width, height } = src;
const source = new Uint8Array(src.data.buffer, src.data.byteOffset, src.data.length);

const start = Date.now();
const { rgba, alpha } = prepPixels(source, width, height, settings);
const ms = Date.now() - start;

// Every output alpha must be 0 or 255 when Fast Halftone is on.
if (settings.halftone) {
  const bad = alpha.findIndex((a) => a !== 0 && a !== 255);
  if (bad !== -1) throw new Error(`Non-binary alpha ${alpha[bad]} at pixel ${bad}`);
}

const outDir = path.join(__dirname, "output");
fs.mkdirSync(outDir, { recursive: true });
const base = path.join(outDir, path.basename(inputPath, ".png"));

function write(file, fill) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) fill(png.data, i * 4, i);
  fs.writeFileSync(file, PNG.sync.write(png));
}

write(`${base}-alpha.png`, (d, p) => {
  d[p] = rgba[p]; d[p + 1] = rgba[p + 1]; d[p + 2] = rgba[p + 2]; d[p + 3] = rgba[p + 3];
});
write(`${base}-shirt.png`, (d, p) => {
  const a = rgba[p + 3] / 255;
  d[p] = rgba[p] * a + shirt.r * (1 - a);
  d[p + 1] = rgba[p + 1] * a + shirt.g * (1 - a);
  d[p + 2] = rgba[p + 2] * a + shirt.b * (1 - a);
  d[p + 3] = 255;
});
write(`${base}-mask.png`, (d, p, i) => {
  d[p] = d[p + 1] = d[p + 2] = alpha[i]; d[p + 3] = 255;
});

console.log(`Fast Halftone: ${width}x${height} in ${ms} ms -> ${base}-{alpha,shirt,mask}.png`);
