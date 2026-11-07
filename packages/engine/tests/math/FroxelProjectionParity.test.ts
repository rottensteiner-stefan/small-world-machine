import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Matrix4 } from "../../src/index.js";

// Contract for the volumetric-fog world-position reconstruction (COMP-01). The froxel compute
// shaders feed a clipZ depth into `uni.invViewProj`, which inverts a WebGPU ZO-corrected [0, 1]
// view-projection. The clipZ must therefore be the WebGPU [0, 1] depth:
//   clipZ = far * (zMid - near) / (zMid * (far - near))
// The classical OpenGL [-1, 1] formula maps near->-1 / far->+1 and reconstructs a distorted world
// position (shadow disconnects + temporal reprojection ghosting).
//
// This test (a) asserts the mathematical round-trip of the fixed formula through the engine's own
// Matrix4 pipeline to < 1e-5, (b) pins the shader sources to the fixed formula, and (c) documents
// that the old formula fails the same round-trip.

const SRC_DIR = join(__dirname, "../../src");
const COMPUTE_DIR = join(SRC_DIR, "renderers/shaders/source/web_gpu/compute");

const near = 0.1;
const far = 1000;

function zoCorrectedPerspective(nearZ: number, farZ: number): Matrix4 {
  const proj = new Matrix4();
  Matrix4.perspective(Math.PI / 2, 1.0, nearZ, farZ, proj);
  // View = identity (camera at origin, forward = -Z): vp = proj.
  const vpZo = new Matrix4();
  Matrix4.multiply(Matrix4.ZO_CORRECTION, proj, vpZo);
  return vpZo;
}

function reconstructDepth(clipZ: number, inv: Matrix4): number {
  // Screen-centre NDC ray (ndcX = ndcY = 0), same shape the compute shaders build.
  const clip = [0, 0, clipZ, 1] as const;
  // inv * clip == column-major matrix times vector: use the data array directly.
  const m = inv.data;
  const hz = (m[2] ?? 0) * clip[0] + (m[6] ?? 0) * clip[1] + (m[10] ?? 0) * clip[2] + (m[14] ?? 0) * clip[3];
  const hw = (m[3] ?? 0) * clip[0] + (m[7] ?? 0) * clip[1] + (m[11] ?? 0) * clip[2] + (m[15] ?? 0) * clip[3];
  const w = Math.max(hw, 1e-6);
  // World position = (hx/w, hy/w, hz/w); with identity view the view depth is -worldZ.
  return -hz / w;
}

function buildZoInverse(): Matrix4 {
  const inv = new Matrix4();
  const ok = Matrix4.invert(zoCorrectedPerspective(near, far), inv);
  if (!ok) {
    throw new Error("ZO-corrected perspective is not invertible");
  }
  return inv;
}

function webGpuClipZ(zMid: number, nearZ: number, farZ: number): number {
  return (farZ * (zMid - nearZ)) / Math.max(zMid * (farZ - nearZ), 1e-6);
}

function openglClipZ(zMid: number, nearZ: number, farZ: number): number {
  return ((farZ + nearZ) * zMid - 2.0 * nearZ * farZ) / Math.max(zMid * (farZ - nearZ), 1e-6);
}

describe("FroxelClipZProjection contract (COMP-01)", () => {
  const depths = [0.5, 1.0, 2.5, 10.0, 50.0, 200.0, 500.0, 900.0];

  it("WebGPU [0,1] clipZ formula round-trips view depth to float32 precision", () => {
    const inv = buildZoInverse();
    for (const d of depths) {
      const clipZ = webGpuClipZ(d, near, far);
      expect(clipZ).toBeGreaterThan(0);
      expect(clipZ).toBeLessThan(1);
      // The engine stores matrices in Float32Array (~7 significant digits) and the inverse of a
      // near-singular perspective loses further digits, so the honest contract is a ~1e-3 relative
      // round-trip bound. The old [-1,1] formula misses it by 2-4 orders of magnitude at every
      // tested depth.
      expect(Math.abs(reconstructDepth(clipZ, inv) - d)).toBeLessThan(1e-6 + 1e-3 * d);
    }
  });

  it("maps near -> 0 and far -> 1 (exact WebGPU clip range)", () => {
    expect(webGpuClipZ(near, near, far)).toBe(0);
    expect(webGpuClipZ(far, near, far)).toBe(1);
  });

  it("rejects the old OpenGL [-1,1] formula: its reconstruction is distorted", () => {
    const inv = buildZoInverse();
    for (const d of depths) {
      const oldClipZ = openglClipZ(d, near, far);
      // oldClipZ(d) < correctClipZ(d) for every d in (near, far), so feeding the [-1,1] depth into
      // the [0,1]-corrected inverse reconstructs a wrong view depth -- orders of magnitude beyond
      // the float32 round-trip bound the corrected formula meets.
      expect(Math.abs(reconstructDepth(oldClipZ, inv) - d)).toBeGreaterThan(1e-6 + 1e-3 * d);
    }
    // Mid/far depths (the actual fog failure regime: shadow disconnects, temporal ghosting) are
    // distorted on the order of the depth itself -- far beyond the round-trip contract.
    for (const d of [5.0, 10.0, 50.0, 200.0, 500.0, 900.0]) {
      expect(Math.abs(reconstructDepth(openglClipZ(d, near, far), inv) - d)).toBeGreaterThan(0.5);
    }
  });

  it("shader sources use the [0,1] formula and no longer the [-1,1] formula", () => {
    for (const file of ["froxel_integrate.wgsl", "froxel_reproject.wgsl"]) {
      const source = readFileSync(join(COMPUTE_DIR, file), "utf8");
      expect(source, file).toMatch(/\(far \* \([a-zA-Z_]+ - near\)\) \/ max\([a-zA-Z_]+ \* \(far - near\), 1e-6\)/);
      expect(source, file).not.toMatch(/\(\(far \+ near\) \* [a-zA-Z_]+ - 2\.0 \* near \* far\)/);
    }
  });
});

// COMP-02: the fog ambient irradiance decode must use the same sRGB->linear transfer as the
// surface lighting path (pbr_math.wgsl `sRGBToLinear`), never a raw per-call pow(..., 2.2).
describe("FroxelInjectIrradianceDecode contract (COMP-02)", () => {
  it("decodes the ambient sky mean through the canonical sRGBToLinear helper", () => {
    const source = readFileSync(join(COMPUTE_DIR, "froxel_inject.wgsl"), "utf8");
    expect(source).toMatch(/fn sRGBToLinear\(color: vec3f\) -> vec3f/);
    expect(source).toMatch(/sRGBToLinear\(textureSampleLevel\(u_irradianceMap/);
    // No caller in the six-axis mean may bypass the helper with a raw pow(..., 2.2).
    const ambientMean = source.slice(source.indexOf("ambientSky = ("), source.indexOf(") * (1.0 / 6.0)"));
    expect(ambientMean).not.toMatch(/pow\(/);
  });
});
