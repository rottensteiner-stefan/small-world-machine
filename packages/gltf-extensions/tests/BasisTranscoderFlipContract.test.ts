import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// K02: KTX2-decoded content must share the pipeline decode orientation ("Human Convention First",
// `Texture.fromUrl` defaults to `flipY: true` -- every PNG/JPEG asset is decode-flipped). Before
// the fix, KTX2 outputs were never flipped and rendered vertically inverted against the rest of the
// asset pipeline: (a) the non-KTX2 blob path explicitly passed `flipY: false`, (b) the RGBA8
// canvas fallback (`_planeToTexture`) wrote decoded rows as-is. Both sites now apply the same
// flip the asset pipeline applies at decode time.

const SOURCE = fileURLToPath(new URL("../src/basisu/BasisTranscoder.ts", import.meta.url));

describe("KTX2 decode orientation (K02)", () => {
  it("loads non-KTX2 blobs with the engine's default decode flip (flipY: true)", () => {
    const src = readFileSync(SOURCE, "utf-8");
    expect(src).toContain("Texture.fromUrl(url, { flipY: true })");
    expect(src).not.toContain("Texture.fromUrl(url, { flipY: false })");
    expect(src).not.toContain("fromUrl(url, { flipY: false })");
  });

  it("flips decoded RGBA rows before the canvas wrap in _planeToTexture", () => {
    const src = readFileSync(SOURCE, "utf-8");
    // In-place top/bottom row swap mirroring `imageOrientation: "flipY"` at decode time.
    expect(src).toContain("for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--)");
    expect(src).toContain("const stride = width * 4;");
    // The flipped buffer (not the raw plane) is put onto the canvas.
    const putIdx = src.indexOf("ctx.putImageData");
    const swapIdx = src.indexOf("top < bottom");
    expect(putIdx).toBeGreaterThan(-1);
    expect(swapIdx).toBeGreaterThan(-1);
    expect(swapIdx).toBeLessThan(putIdx);
  });
});
