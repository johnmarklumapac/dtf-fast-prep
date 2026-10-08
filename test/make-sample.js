// Writes test/sample.png: orange disc with a soft glow, a white bar fading out,
// and a gray drop shadow, all on solid black (like art made for a black shirt).
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const width = 600;
const height = 400;
const png = new PNG({ width, height });

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    let r = 0, g = 0, b = 0;
    // Gray drop shadow under the disc, soft edge.
    const ds = Math.hypot(x - 215, y - 215) / 120;
    const shadow = Math.max(0, Math.min(1, (1.25 - ds) / 0.6)) * 0.45;
    r = g = b = 255 * shadow;
    // Orange disc with glow fading to black.
    const d = Math.hypot(x - 200, y - 200);
    const disc = d < 90 ? 1 : Math.max(0, 1 - (d - 90) / 60);
    r = r * (1 - disc) + 255 * disc;
    g = g * (1 - disc) + 120 * disc;
    b = b * (1 - disc) + 20 * disc;
    // White bar fading left to right.
    if (y > 300 && y < 360 && x > 330 && x < 580) {
      const t = 1 - (x - 330) / 250;
      r = r * (1 - t) + 255 * t;
      g = g * (1 - t) + 255 * t;
      b = b * (1 - t) + 255 * t;
    }
    png.data[p] = r;
    png.data[p + 1] = g;
    png.data[p + 2] = b;
    png.data[p + 3] = 255;
  }
}

const out = path.join(__dirname, "sample.png");
fs.writeFileSync(out, PNG.sync.write(png));
console.log("Wrote " + out);
