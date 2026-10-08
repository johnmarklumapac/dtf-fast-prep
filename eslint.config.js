// ESLint config (flat). Run: npx eslint .
const js = require("@eslint/js");

// Globals the UXP panel scripts see (index.html loads them as plain <script>s).
const uxpGlobals = {
  require: "readonly",
  module: "readonly",
  globalThis: "readonly",
  document: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  localStorage: "readonly",
  // Set by js/halftone.js and js/multislider.js for js/index.js.
  DTFHalftone: "readonly",
  MultiSlider: "readonly",
};

const nodeGlobals = {
  require: "readonly",
  module: "writable",
  process: "readonly",
  console: "readonly",
  __dirname: "readonly",
};

module.exports = [
  { ignores: ["node_modules/**", "test/output/**"] },
  js.configs.recommended,
  {
    files: ["js/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: uxpGlobals },
  },
  {
    files: ["test/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: nodeGlobals },
  },
];
