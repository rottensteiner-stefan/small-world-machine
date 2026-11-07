import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// G02: glass must be shadowed exactly like the opaque PBR path on WebGL2 -- glass inside a CSM
// cascade or spot shadow previously stayed fully lit on the GL tier while the WebGPU glass loop
// sampled the same shadows. The shared GLASS_PBR_LOOPS body therefore calls GLASS_DIR_SHADOW /
// GLASS_SPOT_SHADOW macros; the glsl300 dialect defines them to the BASE_FRAGMENT_HEADER helpers
// (web_gl2), the glsl100 dialect leaves them undefined so the shared `#ifndef` defaults keep it
// fully lit (WebGL1 has no shadow maps). The 4-argument dir helper receives worldPos/dotNL/normal/
// viewDist through parameters because `u_viewPos` lives in the LIGHT_DEFS UBO declared after the
// header.

const ROOT = path.resolve(__dirname, "../../../..");

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf-8");
}

const GL2_LIGHTS = "packages/engine/src/renderers/shaders/source/web_gl2/chunks/lights.frag.glsl";
const GL2_HEADER =
  "packages/engine/src/renderers/shaders/source/web_gl2/chunks/base_fragment_header.frag.glsl";
const GL1_LIGHTS = "packages/engine/src/renderers/shaders/source/web_gl1/chunks/lights.frag.glsl";
const SHARED_LOOPS =
  "packages/engine/src/renderers/shaders/source/shared/glass_pbr_loops.frag.glsl";

describe("glass directional/spot shadow wiring (G02)", () => {
  it("defines the GLASS_DIR_SHADOW / GLASS_SPOT_SHADOW macros on glsl300 only", () => {
    const gl2 = read(GL2_LIGHTS);
    expect(gl2).toContain(
      "#define GLASS_DIR_SHADOW(wp, nDotL, n, viewDist) glassDirShadowFactor(wp, nDotL, n, viewDist)",
    );
    expect(gl2).toContain("#define GLASS_SPOT_SHADOW(i) glassSpotShadowFactor(i)");
    // glsl100 has no shadow maps: the macros must NOT be defined there, so the shared chunk's
    // `#ifndef` defaults (1.0) apply.
    const gl1 = read(GL1_LIGHTS);
    expect(gl1).not.toContain("GLASS_DIR_SHADOW");
    expect(gl1).not.toContain("GLASS_SPOT_SHADOW");
  });

  it("implements the shadow helpers in BASE_FRAGMENT_HEADER with parameter-passed view distance", () => {
    const header = read(GL2_HEADER);
    expect(header).toContain(
      "float glassDirShadowFactor(vec3 worldPos, float dotNL, vec3 geomN, float viewDist)",
    );
    expect(header).toContain("float glassSpotShadowFactor(int lightIndex)");
    // The helpers must live AFTER the EVSM/PCSS eval chunk placeholder they depend on. The eval
    // functions themselves come from the [DIR_PCSS] chunk, so the raw header can only carry the
    // placeholder -- the position of MY helpers relative to it is what pins the ordering.
    const evalPlaceholderPos = header.indexOf("[DIR_PCSS]");
    const helperPos = header.indexOf("float glassDirShadowFactor(");
    expect(evalPlaceholderPos).toBeGreaterThan(-1);
    expect(helperPos).toBeGreaterThan(evalPlaceholderPos);
  });

  it("samples the shadows in the shared glass loop behind #ifndef defaults", () => {
    const shared = read(SHARED_LOOPS);
    expect(shared).toContain("#ifndef GLASS_DIR_SHADOW");
    expect(shared).toContain("#ifndef GLASS_SPOT_SHADOW");
    expect(shared).toContain(
      "float dirShadow = GLASS_DIR_SHADOW(v_worldPos, dotNL, N, length(u_viewPos - v_worldPos));",
    );
    expect(shared).toContain("float sShadow = GLASS_SPOT_SHADOW(i);");
    // Spot shadow multiply must wrap the radiance like the opaque path, not skip it.
    expect(shared).toContain("vec3 sRadiance = GLASS_SPOT_COLOR(i) * attenuation * sShadow;");
  });
});
