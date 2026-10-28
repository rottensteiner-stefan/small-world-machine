// Node ESM loader hook: emulate Vite's `?raw` for shader assets so tsx scripts can import the
// engine's real chunk registry (CoreShaderChunks) unchanged under plain Node.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const RAW_SUFFIX_RE = /\.(wgsl|glsl|vert\.glsl|frag\.glsl|glsl100|vs\.glsl|fs\.glsl)\?raw$/;

export function resolve(specifier, context, nextResolve) {
  const m = RAW_SUFFIX_RE.exec(specifier);
  if (m) {
    const url = pathToFileURL(
      path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier.replace(/\?raw$/, "")),
    ).href;
    return { url, shortCircuit: true, format: "module" };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url.includes("?raw")) {
    const file = fileURLToPath(url.split("?")[0]);
    const code = readFileSync(file, "utf8");
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(code)};`,
    };
  }
  return nextLoad(url, context);
}
