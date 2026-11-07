import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ShaderRegistry } from "../../src/index.js";
import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";

// I01: the cluster cell/index formula was copy-pasted into three WebGPU chunks plus the WebGL2
// lights function -- byte-identical today, but with no mechanism forcing them to stay that way.
// The fix moves the WebGPU side into ONE registered chunk (`CLUSTER_INDEX_LOOKUP`) that the three
// shaders splice in (the assembler resolves chunks-in-chunks recursively), leaving a single source
// of truth. The WebGL2 function cannot share byte-code (WGSL vs GLSL), so THIS parity gate pins
// the algebra of both sides in lockstep: any drift on either side fails the test.

const ROOT = join(__dirname, "..", "..", "..", "..");
const CHUNK_DIR = "packages/engine/src/renderers/shaders/source/web_gpu/chunks";
const gl2Lights = readFileSync(
  join(ROOT, "packages/engine/src/renderers/shaders/source/web_gl2/chunks/lights.frag.glsl"),
  "utf8",
);

let chunk: string | undefined;

beforeAll(async () => {
  const registry = new ShaderRegistry();
  await CoreShaderChunks.init(registry);
  chunk = registry.getChunk("CLUSTER_INDEX_LOOKUP", "wgsl");
});

describe("I01: single cluster-lookup implementation with WGSL/WebGL2 formula parity", () => {
  it("registers CLUSTER_INDEX_LOOKUP and resolves it through the assembler", async () => {
    const registry = new ShaderRegistry();
    await CoreShaderChunks.init(registry);
    const assembled = registry.assemble("[CLUSTER_INDEX_LOOKUP]", "wgsl");
    expect(assembled).toContain("let clusterCellIndex = clusterCellX");
    expect(assembled).not.toContain("[CLUSTER_INDEX_LOOKUP]");
  });

  it("the three WebGPU chunks splice the token and contain no inline duplicate", () => {
    for (const name of ["lighting_pbr", "lighting", "glass_pbr_loops"]) {
      const src = readFileSync(join(ROOT, CHUNK_DIR, `${name}.wgsl`), "utf8");
      expect(src, name).toContain("[CLUSTER_INDEX_LOOKUP]");
      expect(src, name).not.toContain("let clusterDimsU ="); // formula lives in the chunk only
      expect(src, name).not.toContain("let clusterLogRatio =");
    }
  });

  it("the shared chunk still carries the J01 divisor guard", () => {
    expect(chunk).toMatch(
      /let clusterLogRatio = max\(log\(global\.cameraNearFar\.y \/ global\.cameraNearFar\.x\), 1e-6\);/,
    );
  });

  // Parity gate: each algebra step exists on BOTH sides with the identical structure. The concrete
  // identifiers differ per language/namespace, but the formula must not drift apart.
  const parityPairs: Array<[RegExp, RegExp]> = [
    // x cell: horizontal screen tile.
    [
      /let clusterCellX = min\(u32\(i\.pos\.x \/ global\.tileSizePx\.x\), clusterDimsU\.x - 1u\);/,
      /int cellX = min\(int\(gl_FragCoord\.x \/ tileSizePx\.x\), dims\.x - 1\);/,
    ],
    // z slice: log-depth slice from the clamped view distance.
    [
      /let clusterSliceF = floor\(log\(clusterViewDist \/ global\.cameraNearFar\.x\) \* f32\(clusterDimsU\.z\) \/ clusterLogRatio\);/,
      /float sliceF = floor\(log\(viewDist \/ cameraNearFar\.x\) \* clusterDims\.z \/ logRatio\);/,
    ],
    // linearised cell index.
    [
      /let clusterCellIndex = clusterCellX \+ clusterDimsU\.x \* \(clusterCellY \+ clusterDimsU\.y \* clusterCellZ\);/,
      /return cellX \+ dims\.x \* \(cellY \+ dims\.y \* cellZ\);/,
    ],
  ];

  for (const [wgsl, glsl] of parityPairs) {
    it("WGSL chunk and WebGL2 function stay formula-identical", () => {
      expect(chunk, "WGSL side").toMatch(wgsl);
      expect(gl2Lights, "WebGL2 side").toMatch(glsl);
    });
  }
});
