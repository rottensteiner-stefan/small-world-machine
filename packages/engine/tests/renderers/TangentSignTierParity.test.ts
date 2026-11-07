import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "../../src");
const WGSL = join(SRC_DIR, "renderers/shaders/source/web_gpu/base.vert.wgsl");
const GL2 = join(SRC_DIR, "renderers/shaders/source/web_gl2/chunks/base_vertex_main.vert.glsl");
const GL1 = join(SRC_DIR, "renderers/shaders/source/web_gl1/base.vert.glsl");
const COMPUTE_TOYS = join(SRC_DIR, "core/materials/importers/ComputeToysImporter.ts");

function read(p: string): string {
  return readFileSync(p, "utf8");
}

// EP-1 vec4-tangent contract (w = ±1) must behave IDENTICALLY on every tier: valid tangents
// keep their authored/derived w sign, degenerate/absent tangents fold to +1. WGSL has no
// ternary; `select(f, t, c) = c ? t : f` — so the corrected WebGPU form is
// `select(w, 1.0, degenerate)` (degenerate -> 1.0). A swapped argument pair silently turns
// EP-1 into a no-op on that tier (mirrored-UV meshes lose their relief), which is exactly the
// cross-tier inconsistency this test guards against.
describe("EP-1 bitangent w-sign tier parity", () => {
  it("web_gpu folds degenerate tangents to +1 and valid ones to w (select corrected)", () => {
    const wgsl = read(WGSL);
    expect(wgsl).toContain("let tangentSign = select(tangent.w, 1.0, dot(localTangent, localTangent) < 0.0001);");
  });

  it("web_gl2 folds degenerate tangents to +1 and valid ones to w", () => {
    const gl2 = read(GL2);
    expect(gl2).toContain("float bitangentSign = dot(tangent, tangent) < 0.0001 ? 1.0 : a_tangent.w;");
  });

  it("web_gl1 folds degenerate tangents to +1 and valid ones to w", () => {
    const gl1 = read(GL1);
    expect(gl1).toContain("float bitangentSign = length(tangent) < 0.0001 ? 1.0 : a_tangent.w;");
  });

  it("ComputeToysImporter wgsl shares the corrected contract (select swapped)", () => {
    const src = read(COMPUTE_TOYS);
    expect(src).toContain("let tangentSign = select(a_tangent.w, 1.0, dot(a_tangent.xyz, a_tangent.xyz) < 0.0001);");
  });
});
