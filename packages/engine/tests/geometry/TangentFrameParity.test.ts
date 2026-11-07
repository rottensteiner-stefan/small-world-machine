import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Tangent-frame parity contract (G03). The WebGPU base vertex stage must build the fallback
// tangent with the SAME handedness as the WebGL1/WebGL2 stages (`cross(N, up)`, not the mirrored
// `cross(up, N)`) and must Gram-Schmidt-orthogonalize T against N, so a missing-authored-tangent
// normal-mapped mesh shades identically on every tier and a non-uniform scaled/sheared mesh keeps
// an orthonormal TBN. Covers the engine core shader and the byte-clone in vfx-extras (Fire).

const SRC_DIR = join(__dirname, "../../src");
const WGSL_BASE = join(SRC_DIR, "renderers/shaders/source/web_gpu/base.vert.wgsl");
const WGSL_FIRE = join(__dirname, "../../../vfx-extras/src/fire/Fire.vert.wgsl");
const GL2_BASE = join(SRC_DIR, "renderers/shaders/source/web_gl2/chunks/base_vertex_main.vert.glsl");
const GL1_BASE = join(SRC_DIR, "renderers/shaders/source/web_gl1/base.vert.glsl");

describe("Tangent frame parity: WGSL mirrors the GLSL fallback and orthonormalization (G03)", () => {
  it("WGSL fallback uses cross(N, up) -- not the mirrored cross(up, N)", () => {
    for (const file of [WGSL_BASE, WGSL_FIRE]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(/normalize\(cross\(o\.n, up\)\)/);
      expect(source, file).not.toMatch(/cross\(up, o\.n\)/);
    }
  });

  it("WGSL Gram-Schmidt-orthogonalizes the transformed tangent against N", () => {
    for (const file of [WGSL_BASE, WGSL_FIRE]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(/o\.t - dot\(o\.t, o\.n\) \* o\.n/);
    }
  });

  it("GLSL stages keep the canonical cross(N, up) fallback and Gram-Schmidt", () => {
    const gl2 = readFileSync(GL2_BASE, "utf8");
    expect(gl2).toMatch(/tangent = cross\(v_normal, vec3\(0, 1, 0\)\)/);
    expect(gl2).toMatch(/T - dot\(T, N_v\) \* N_v/);

    const gl1 = readFileSync(GL1_BASE, "utf8");
    expect(gl1).toMatch(/tangent = cross\(v_normal, vec3\(0\.0, 1\.0, 0\.0\)\)/);
    expect(gl1).toMatch(/T - dot\(T, N\) \* N/);
  });
});
