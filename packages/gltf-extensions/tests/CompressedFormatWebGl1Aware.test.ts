import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { detectBestBlockFormat, resetCachedBlockFormat } from "../src/basisu/compressedFormats.js";
import { BasisTranscoderFormat } from "../src/basisu/basisTypes.js";

// K01 (a): `detectBestBlockFormatUncached` must be WebGL1-aware. The decoded KTX2 bytes fan out to
// whichever renderer the APP uses, and a WebGL1 context cannot consume every WebGL2 candidate --
// ETC2/EAC is WebGL2-core-only (`WEBGL_compressed_texture_etc` is rarely exposed on WebGL1) and
// BC7 needs `EXT_texture_compression_bptc`. When the hidden WebGL1 probe cannot consume the chosen
// candidate, `null` is returned so callers decode to RGBA8 -- correct on every tier -- instead of
// handing WebGL1 a block format its upload path renders as a white placeholder (K01).

const SOURCE = fileURLToPath(new URL("../src/basisu/compressedFormats.ts", import.meta.url));

describe("WebGL1-aware block-format detection (K01 a)", () => {
  it("consults a hidden WebGL1 probe and demotes unconsumable candidates to null", () => {
    const src = readFileSync(SOURCE, "utf-8");
    // The WebGL1 probe exists and is wired into the candidate decision.
    expect(src).toContain("tryHiddenWebGl1()");
    expect(src).toContain("webGl1Consumes(webgl1, candidate)");
    expect(src).toContain("if (!webGl1Consumes(webgl1, candidate)) candidate = null;");
    // The WebGL1 consume gates use the per-format extensions.
    expect(src).toContain('gl.getExtension("EXT_texture_compression_bptc")');
    expect(src).toContain('gl.getExtension("WEBGL_compressed_texture_astc")');
    expect(src).toContain('gl.getExtension("WEBGL_compressed_texture_etc")');
    // The probe context is released like the WebGL2 probe (context-cap doctrine).
    expect(src).toContain('webgl1.getExtension("WEBGL_lose_context")?.loseContext();');
  });

  it("returns null (RGBA8 fallback) in a canvas-less environment", () => {
    // vitest runs in a node environment without `document`: no probe context can exist, so the
    // contract is the uncompressed RGBA8 fallback -- never a format guess the tier cannot consume.
    expect(typeof document).toBe("undefined");
    resetCachedBlockFormat();
    expect(detectBestBlockFormat()).toBeNull();
  });

  it("detects WebGPU, WebGL2, and WebGL1 formats independently when capabilities are supplied (AS01/AS02)", () => {
    expect(
      detectBestBlockFormat({
        tier: "webgpu",
        gpuFeatures: new Set(["texture-compression-bc"]),
      }),
    ).toBe(BasisTranscoderFormat.BC7);

    expect(
      detectBestBlockFormat({
        tier: "webgpu",
        gpuFeatures: new Set(["texture-compression-astc"]),
      }),
    ).toBe(BasisTranscoderFormat.ASTC_4x4);

    expect(
      detectBestBlockFormat({
        tier: "webgpu",
        gpuFeatures: new Set(["texture-compression-etc2"]),
      }),
    ).toBe(BasisTranscoderFormat.ETC2);

    expect(detectBestBlockFormat({ tier: "webgpu", gpuFeatures: new Set() })).toBeNull();

    // WebGL2 with no BPTC/ASTC still selects core ETC2 without being downgraded by WebGL1.
    const fakeGl2 = { getExtension: () => null } as unknown as WebGL2RenderingContext;
    expect(detectBestBlockFormat({ tier: "webgl2", gl: fakeGl2 })).toBe(BasisTranscoderFormat.ETC2);

    // WebGL1 with S3TC selects BC3 rather than dropping to RGBA8.
    const fakeGl1 = {
      getExtension: (name: string) => (name === "WEBGL_compressed_texture_s3tc" ? {} : null),
    } as unknown as WebGLRenderingContext;
    expect(detectBestBlockFormat({ tier: "webgl1", gl: fakeGl1 })).toBe(BasisTranscoderFormat.BC3);
  });
});
