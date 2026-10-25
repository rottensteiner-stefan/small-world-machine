import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * @invariant SHADOW-PCSS-MONOTONICITY: Der Penumbra-Radius von `getShadowPCSS` (`pbr_math.wgsl`)
 *   ist monoton in der Empfänger/Blocker-Distanzlücke und kontakt-verhärtet: Δd₁ ≤ Δd₂ ⇒
 *   R(Δd₁) ≤ R(Δd₂); bei Kontakt (Δd = 0) gilt `pcfRadius = 1` und der hart codierte 3×3-PCF-Pfad
 *   (`pcfRadius <= 1.2`) greift. Math-Mirror der SHIPPED WGSL-Formel (Konstanten identisch), plus
 *   Struktur-Guard gegen Formel-Drift im Kern.
 */

const dims = { x: 2048, y: 2048 };
const SOFTSHADOW_X = 1.0;
const SOFTSHADOW_Y = 16.0;

/** Exakter Math-Mirror der `pcfRadius`-Ableitung aus `getShadowPCSS` (pbr_math.wgsl). */
function pcssRadius(
  dz: number,
  depthRef: number,
  dimsX: number,
  softnessX: number,
  softnessY: number,
): number {
  const gap = Math.max(dz, 0); // dz = max(depthRef - avgBlockerDepth, 0)
  const radial = gap / Math.max(depthRef, 0.00001); // / max(depthRef, 1e-5)
  return Math.min(Math.max(1.0 + radial * dimsX * 0.12 * softnessX, 1.0), Math.max(softnessY, 1.0));
}

describe("SHADOW-PCSS-MONOTONICITY (mirror of shipped pcfRadius math)", () => {
  it("is contract-hard at contact (dz = 0 => radius 1, the 3x3 hard PCF path)", () => {
    for (const depthRef of [0.2, 0.5, 0.9, 100]) {
      const r = pcssRadius(0, depthRef, dims.x, SOFTSHADOW_X, SOFTSHADOW_Y);
      expect(r).toBe(1);
      // Der Shader wählt bei pcfRadius <= 1.2 die kompakte 3×3-PCF (Kontaktschatten).
      expect(r).toBeLessThanOrEqual(1.2);
    }
  });

  it("is monotonically non-decreasing in the receiver/blocker gap (harder at contact, softer away)", () => {
    const depthRef = 0.5;
    let prev = -Infinity;
    for (let i = 0; i <= 200; i++) {
      const dz = (i / 200) * 0.5; // 0 .. 0.5
      const r = pcssRadius(dz, depthRef, dims.x, SOFTSHADOW_X, SOFTSHADOW_Y);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it("stays inside the clamped [1, softnessY] texel range for all gaps", () => {
    for (let i = -20; i <= 400; i++) {
      const dz = i / 100;
      const r = pcssRadius(dz, 0.5, dims.x, SOFTSHADOW_X, SOFTSHADOW_Y);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(Math.max(SOFTSHADOW_Y, 1));
    }
  });

  it("still uses the exact shipped formula constants (drift guard against the real WGSL)", () => {
    const pbrMath = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "packages/engine/src/renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl",
      ),
      "utf-8",
    );
    expect(pbrMath).toContain("let radial = dz / max(depthRef, 0.00001);");
    expect(pbrMath).toContain("let pcfRadius = clamp(");
    expect(pbrMath).toContain("1.0 + radial * f32(dims.x) * 0.12 * global.shadowSoftness.x");
    expect(pbrMath).toContain("max(global.shadowSoftness.y, 1.0)");
    // Kontakt-Härtungspfad unverändert vorhanden.
    expect(pbrMath).toContain("if (pcfRadius <= 1.2) {");
  });
});
