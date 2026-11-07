import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// J01: the cluster slice math divides by `log(far/near)` in five places. On a degenerate
// `near == far` camera that divisor is log(1) = 0, producing 0/0 NaN slice values, wrong cluster
// cells and light bleed/removal. The fix guards every divisor with `max(..., 1e-6)` (the same
// guard froxel_inject/froxel_reproject already used). This test pins the guard at all five sites
// and rejects any future unguarded `log(A / B)` divisor in the clustered-lighting code.

const ROOT = join(__dirname, "..", "..", "..", "..");
const CHUNKS = join(ROOT, "packages/engine/src/renderers/shaders/source");
const sites: Array<{ file: string; pattern: RegExp }> = [
  {
    // Shared I01 chunk consumed by lighting_pbr/lighting/glass_pbr_loops.
    file: join(CHUNKS, "web_gpu/chunks/cluster_index_lookup.wgsl"),
    pattern:
      /let clusterLogRatio = max\(log\(global\.cameraNearFar\.y \/ global\.cameraNearFar\.x\), 1e-6\);/,
  },
  {
    file: join(CHUNKS, "web_gpu/compute/cluster_cull.wgsl"),
    pattern: /let logRatio = max\(log\(far \/ near\), 1e-6\);/,
  },
  {
    // WebGL2 twin of the cluster lookup (I01): the computeClusterCellIndex function.
    file: join(CHUNKS, "web_gl2/chunks/lights.frag.glsl"),
    pattern: /float logRatio = max\(log\(cameraNearFar\.y \/ cameraNearFar\.x\), 1e-6\);/,
  },
];

const UNGUARDED_DIVISOR = /(?:=|return)\s*(?:let\s+|float\s+|var\s+)?log\([^);\n]*\/[^);\n]*\)\s*;/;

describe("J01: every log(far/near) cluster divisor is guarded", () => {
  for (const site of sites) {
    it(`${site.file} keeps the 1e-6 guard`, () => {
      expect(readFileSync(site.file, "utf8")).toMatch(site.pattern);
    });
  }

  it("no clustered-lighting source defines an unguarded log-divisor anywhere", () => {
    const scanned = [
      join(CHUNKS, "web_gpu/chunks"),
      join(CHUNKS, "web_gpu/compute"),
      join(CHUNKS, "web_gl2/chunks/lights.frag.glsl"),
      join(CHUNKS, "web_gl1/chunks/lights.frag.glsl"),
    ];
    const violations: string[] = [];
    for (const target of scanned) {
      const files = target.endsWith(".glsl") ? [target] : requireDir(target);
      for (const file of files) {
        const src = readFileSync(file, "utf8");
        for (const line of src.split("\n")) {
          if (/max\(\s*log\(/.test(line)) continue; // guarded definition
          if (/\/\s*log\s*\(/.test(line)) continue; // division BY log(…) is safe post-guard
          if (UNGUARDED_DIVISOR.test(line)) {
            violations.push(`${relative(file)}: ${line.trim()}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

function requireDir(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isFile() && /\.wgsl$/.test(entry)) out.push(full);
  }
  return out;
}

function relative(file: string): string {
  return file.replace(`${ROOT}/`, "");
}
