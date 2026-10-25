import { describe, expect, it } from "vitest";
import { DirectionalLight } from "../../src/core/lights/DirectionalLight.js";
import { Camera } from "../../src/core/cameras/Camera.js";
import { PerspectiveProjection } from "../../src/math/projections/index.js";
import { Vector3D } from "../../src/math/index.js";
import lightingPbrWGSL from "../../src/renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl?raw";
import pbrMathWGSL from "../../src/renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl?raw";

/**
 * @invariant CSM-C0-CONTINUITY: Cascade-Shadow ist über die Split-Kreise hinweg kontinuierlich
 *   gehalten: Der Blend-Gewicht `blendToNext` ist eine stetige, monotone smoothstep-Rampe über
 *   ein Blend-Band (`max(splitFar*0.2, 0.0001)`), und der Penumbra-Radius wird über die Cascades
 *   mit `cascadeScale = clamp(splits[0]/splits[layer], 0.2, 1.0)` normalisiert, damit die
 *   Welt-Penumbra-Breite an der Split-Grenze nicht springt. Split-Abstände sind strikt monoton
 *   aufsteigend (Real-Probe `DirectionalLight.updateCascades`).
 */

describe("CSM-C0-CONTINUITY: cascade split ordering is monotone (real probe)", () => {
  it("computes strictly increasing cascade splits for a fixed perspective camera", () => {
    const camera = new Camera(
      new PerspectiveProjection({ fov: Math.PI / 3, aspect: 1.5, near: 0.1, far: 200 }),
    );
    camera.position.set(3, 2, 8);
    camera.target.set(0, 1, 0);
    camera.updateViewMatrix();

    const light = new DirectionalLight({
      direction: new Vector3D(-0.45, -0.75, -0.45).normalize(),
      numCascades: 4,
      castShadow: true,
    });
    light.updateCascades(camera);

    const splits = light.cascadeSplits;
    expect(splits).toHaveLength(light.numCascades);
    for (let i = 1; i < splits.length; i++) {
      // Strikte Monotonie: ohne sie gäbe es keinen wohldefinierten "nächsten" Cascade-Layer und
      // die Blend-Rampe hätte kein ankernbares Intervall.
      expect(splits[i]!).toBeGreaterThan(splits[i - 1]!);
      // Physikalisch sinnvolle Werte: näher als der Camera-Near, ferner als die erste Scheibe.
      expect(splits[i - 1]!).toBeGreaterThan(0.1);
    }
  });
});

describe("CSM-C0-CONTINUITY: the shader keeps the shadow function continuous across split circles", () => {
  it("blends the two cascade samples with a continuous weight (mix, not a hard switch)", () => {
    expect(lightingPbrWGSL).toContain("shadow = mix(shadowA, shadowB, blendToNext);");
    // Das Gewicht ist eine stetige smoothstep-Rampe über ein explizites Blend-Band.
    expect(lightingPbrWGSL).toContain("var blendToNext: f32 = 0.0;");
    expect(lightingPbrWGSL).toMatch(/blendBand = max\(splitFar \* 0\.2, 0\.0001\);/);
    expect(lightingPbrWGSL).toMatch(
      /blendToNext = smoothstep\(0\.0, 1\.0, 1\.0 - clamp\(\(splitFar - viewDist\) \/ blendBand, 0\.0, 1\.0\)\);/,
    );
  });

  it("normalizes the PCSS penumbra search across ortho cascades (no world-radius seam)", () => {
    expect(pbrMathWGSL).toMatch(/cascadeScale = select\(/);
    expect(pbrMathWGSL).toMatch(
      /clamp\(global\.cascadeSplits\[0\] \/ max\(global\.cascadeSplits\[layer\], 0\.001\), 0\.2, 1\.0\)/,
    );
  });
});

describe("CSM-C0-CONTINUITY: blend-weight math mirror is continuous and monotone", () => {
  // Math-Mirror der schiffsgestützten `blendToNext`-Formel (Konstanten exakt aus dem Kern).
  const blendWeight = (viewDist: number, splitFar: number): number => {
    const blendBand = Math.max(splitFar * 0.2, 0.0001);
    const t = Math.min(Math.max((splitFar - viewDist) / blendBand, 0), 1);
    const ramp = 1 - t; // 1.0 - clamp(...)
    const s = ramp * ramp * (3 - 2 * ramp); // smoothstep(0,1,ramp)
    return s;
  };

  const splitFar = 50;
  const bandFrom = splitFar - Math.max(splitFar * 0.2, 0.0001); // 40
  const bandTo = splitFar; // 50

  it("is exactly 0 before the blend band and exactly 1 from the split boundary inward", () => {
    expect(blendWeight(bandFrom - 10, splitFar)).toBe(0);
    expect(blendWeight(bandTo + 10, splitFar)).toBe(1);
  });

  it("is monotonically non-decreasing across the band and fully inside [0,1]", () => {
    let prev = -1;
    for (let d = bandFrom - 1; d <= bandTo + 1; d += 0.1) {
      const w = blendWeight(d, splitFar);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      prev = w;
    }
  });

  it("cascadeScale is monotone non-increasing with the split distance (resolution normalization)", () => {
    // splits strictly increasing (real engine probe) -> splits[0]/splits[layer] is monotone
    // non-increasing; the clamp keeps it in [0.2, 1.0]. This is the anti-seam normalization.
    const splits = [10, 25, 60, 130];
    let prev = 1; // splits[0]/splits[0] == 1
    for (const split of splits) {
      const scale = Math.min(Math.max(splits[0]! / Math.max(split, 0.001), 0.2), 1.0);
      expect(scale).toBeLessThanOrEqual(prev + 1e-9);
      expect(scale).toBeGreaterThanOrEqual(0.2);
      expect(scale).toBeLessThanOrEqual(1.0);
      prev = scale;
    }
  });
});
