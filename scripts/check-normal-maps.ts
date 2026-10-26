/**
 * Normal-map asset check (asset-pipeline C8): every tangent-space normal map under apps/ and
 * packages/ must be a real normal map whose per-texel detail does not alias. Catches the two
 * defects behind the 2026-10-26 sparkle/dot pattern in showcases 12, 37 and 38:
 *
 * - **greyscale** — a height/edge/specular image saved as `*_normal.*`. Decoded as a normal it
 *   points into the surface (mean blue < 0.5) and lights the material from behind.
 * - **noise** — neighbouring texels differ by more than {@link MAX_NEIGHBOUR_DEG} on average:
 *   every texel tilts the light differently, and mipmaps barely average it out.
 *
 * Decoding uses ImageMagick (`magick`). Exit 0 = clean, 1 = violations, 2 = magick missing.
 * Usage: `npm run check:normal-maps [-- <files...>]`
 */
import { execFileSync } from "child_process";
import { readdirSync, statSync } from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAX_NEIGHBOUR_DEG = 20; // repaired assets sit at 5-11 degrees, the broken ones at 25-50
const NORMAL_NAME = /(^|[_-])normal\.(png|jpe?g|webp)$/i;

function findNormalMaps(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) findNormalMaps(full, out);
    else if (NORMAL_NAME.test(entry)) out.push(full);
  }
  return out;
}

interface Verdict {
  greyscale: number;
  meanBlue: number;
  neighbourDeg: number;
}

function analyse(file: string): Verdict {
  const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", file], {
    encoding: "utf8",
  })
    .split(" ")
    .map(Number) as [number, number];
  const rgb = execFileSync(
    "magick",
    [file, "-alpha", "off", "-depth", "8", "-type", "TrueColor", "rgb:-"],
    {
      maxBuffer: 1 << 28,
    },
  );
  let grey = 0;
  let blue = 0;
  let angle = 0;
  let n = 0;
  const unit = (i: number): [number, number, number] => {
    const x = rgb[i * 3]! / 127.5 - 1;
    const y = rgb[i * 3 + 1]! / 127.5 - 1;
    const z = rgb[i * 3 + 2]! / 127.5 - 1;
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  };
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w - 1; x += 2) {
      const i = y * w + x;
      const r = rgb[i * 3]!;
      const g = rgb[i * 3 + 1]!;
      const b = rgb[i * 3 + 2]!;
      if (Math.abs(r - g) < 6 && Math.abs(g - b) < 6) grey++;
      blue += b / 255;
      const a = unit(i);
      const c = unit(i + 1);
      angle += Math.acos(Math.max(-1, Math.min(1, a[0] * c[0] + a[1] * c[1] + a[2] * c[2])));
      n++;
    }
  }
  return { greyscale: grey / n, meanBlue: blue / n, neighbourDeg: (angle / n) * (180 / Math.PI) };
}

try {
  execFileSync("magick", ["-version"], { stdio: "ignore" });
} catch {
  console.error("check-normal-maps: ImageMagick (`magick`) not found -- skipped.");
  process.exit(2);
}

const args = process.argv.slice(2);
const files = args.length
  ? args.map((f) => path.resolve(f))
  : [
      ...findNormalMaps(path.join(ROOT, "apps"), []),
      ...findNormalMaps(path.join(ROOT, "packages"), []),
    ];

let failures = 0;
for (const file of files) {
  const v = analyse(file);
  const problems: string[] = [];
  if (v.greyscale > 0.9)
    problems.push(`greyscale image (${(v.greyscale * 100).toFixed(0)} % grey texels)`);
  else if (v.meanBlue < 0.5)
    problems.push(`normals point into the surface (mean blue ${v.meanBlue.toFixed(2)})`);
  if (v.neighbourDeg > MAX_NEIGHBOUR_DEG)
    problems.push(
      `per-texel noise: ${v.neighbourDeg.toFixed(1)} deg between neighbours (max ${MAX_NEIGHBOUR_DEG})`,
    );
  if (problems.length) {
    failures++;
    console.log(`✗ ${path.relative(ROOT, file)}: ${problems.join("; ")}`);
  }
}
console.log(`check-normal-maps: ${files.length} normal maps, ${failures} with defects.`);
process.exit(failures ? 1 : 0);
