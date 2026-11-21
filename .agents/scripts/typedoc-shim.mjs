// Compatibility shim for TypeDoc 0.28 with minimatch 11+.
// Minimatch 11 dropped `Minimatch.prototype.matchOne`, which TypeDoc's glob helper
// invokes in `shouldRecurse()`. This restores the contract via `Minimatch#match(path, partial)`.

const paths = [
  new URL("../../node_modules/typedoc/node_modules/minimatch/dist/esm/index.js", import.meta.url),
  new URL("../../node_modules/typedoc/node_modules/minimatch/dist/commonjs/index.js", import.meta.url),
  new URL("../../node_modules/minimatch/dist/esm/index.js", import.meta.url),
  new URL("../../node_modules/minimatch/dist/commonjs/index.js", import.meta.url),
];

for (const url of paths) {
  try {
    const mod = await import(url.href);
    const targets = [mod.Minimatch, mod.default?.Minimatch, mod.default].filter(
      (fn) => typeof fn === "function" && fn.prototype,
    );
    for (const m of targets) {
      if (!m.prototype.matchOne) {
        m.prototype.matchOne = function (fileArray, _patternArray, partial = false) {
          const pathStr = Array.isArray(fileArray) ? fileArray.join("/") : fileArray;
          return this.match(pathStr, partial);
        };
      }
    }
  } catch {
    // Path may not exist depending on npm tree layout; safe to ignore.
  }
}
