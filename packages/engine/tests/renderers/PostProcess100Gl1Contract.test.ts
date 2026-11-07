import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// A03: the WebGL1 post pass treats its input as DISPLAY-REFERRED. The GL1 HDR target is
// deliberately RGBA8 (half-float FBO rendering is unreliable on many WebGL1 devices), so the
// forward stage already clamped, tone-mapped (its own guard) and sRGB-encoded the frame. Tone
// mapping or a second linearToSRGB encode in post would double-darken the image. `u_exposure`
// survives as the single display-referred gain. `PostProcessPassGL` still fetches the removed
// uniforms (and compiles `#define u_toneMappingMode`); both are null-guarded/replace-no-ops, so
// only this shader is touched by the fix.

const ROOT = path.resolve(__dirname, "../../../..");

const FILE = "packages/engine/src/renderers/post/shaders/PostProcess100.frag.glsl";

describe("WebGL1 post is display-referred (A03)", () => {
  it("no re-tone-map and no re-encode on the GL1 post pass", () => {
    // Comments are stripped: the A03 note above `vec3 srgb = hdr * u_exposure;` mentions the
    // removed uniform names for documentation, and a comment must neither satisfy nor break a guard.
    const src = fs
      .readFileSync(path.join(ROOT, FILE), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // Helpers and uniforms are gone -- re-tonemapping/encoding already-encoded pixels double-darkens.
    expect(src).not.toMatch(/\btoneMap[A-Za-z]*\s*\(/);
    expect(src).not.toMatch(/\blinearToSRGB\s*\(/);
    expect(src).not.toMatch(/\bu_toneMappingMode\b/);
    expect(src).not.toMatch(/\bu_inverseGamma\b/);
    // The pass applies the display-referred gain only.
    expect(src).toContain("vec3 srgb = hdr * u_exposure;");
  });
});
