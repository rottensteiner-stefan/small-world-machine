import { describe, it, expect } from "vitest";
import { Matrix4, sliceCenterViewDepth } from "../../src/math/index.js";
import injectWGSL from "../../src/renderers/shaders/source/web_gpu/compute/froxel_inject.wgsl?raw";
import reprojectWGSL from "../../src/renderers/shaders/source/web_gpu/compute/froxel_reproject.wgsl?raw";
import integrateWGSL from "../../src/renderers/shaders/source/web_gpu/compute/froxel_integrate.wgsl?raw";

/**
 * Compiles a pure scalar WGSL function (f32 params/locals, `max/min/pow/sqrt/log/clamp`) from the
 * REAL shader source into a JS function, so the tests exercise the shipped math instead of a copy.
 */
function wgslScalarFn(source: string, name: string): (...args: number[]) => number {
  const m = new RegExp(`fn\\s+${name}\\s*\\(([^)]*)\\)\\s*->\\s*f32\\s*\\{([\\s\\S]*?)\\n\\}`).exec(
    source,
  );
  if (!m) throw new Error(`fn ${name} not found in WGSL`);
  const params = m[1]!
    .split(",")
    .map((p) => p.split(":")[0]!.trim())
    .filter(Boolean);
  const body = m[2]!
    .replace(/\blet\b/g, "const")
    .replace(/\bvar\b/g, "let")
    .replace(/:\s*f32/g, "")
    .replace(/\b(max|min|pow|sqrt|log|abs|floor)\(/g, "Math.$1(")
    .replace(/\bclamp\(([^,]+),\s*([^,]+),\s*([^;]+)\);/g, "Math.min(Math.max($1, $2), $3);");
  return new Function(...params, body) as (...args: number[]) => number;
}

/** Extracts the right-hand side of `let clipZ = ...;` from a WGSL shader as a JS function of (zMid, near, far). */
function wgslClipZ(source: string): (zMid: number, near: number, far: number) => number {
  const m = /let clipZ = ([^;]+);/.exec(source);
  if (!m) throw new Error("clipZ not found in WGSL");
  const expr = m[1]!.replace(/\bmax\(/g, "Math.max(");
  return new Function("zMid", "near", "far", `return ${expr};`) as (
    zMid: number,
    near: number,
    far: number,
  ) => number;
}

describe("Froxel WGSL slicing matches froxel.ts (single source of truth)", () => {
  const near = 0.1;
  const far = 100.0;
  const slices = 64;
  const shaders: [string, (...a: number[]) => number][] = [
    ["froxel_inject.wgsl", wgslScalarFn(injectWGSL, "sliceCenterDepth")],
    ["froxel_reproject.wgsl", wgslScalarFn(reprojectWGSL, "sliceDepth")],
    ["froxel_integrate.wgsl", wgslScalarFn(integrateWGSL, "sliceDepth")],
  ];

  it.each(shaders)("%s slice centre depth equals sliceCenterViewDepth", (_n, fn) => {
    for (let s = 0; s < slices; s++) {
      expect(fn(s, near, far, slices)).toBeCloseTo(sliceCenterViewDepth(s, near, far, slices), 3);
    }
  });

  it("reprojection's depth->slice coordinate inverts the slice centre to texel centre (s + 0.5)/N", () => {
    const toSlice = wgslScalarFn(reprojectWGSL, "depthToNormalizedSlice");
    for (let s = 0; s < slices; s += 7) {
      const z = sliceCenterViewDepth(s, near, far, slices);
      expect(toSlice(z, near, far) * slices).toBeCloseTo(s + 0.5, 1);
    }
    // Out-of-range depths clamp to the volume (reprojection treats them as outside via range check).
    expect(toSlice(1e6, near, far)).toBeCloseTo(1, 6);
    expect(toSlice(1e-6, near, far)).toBeCloseTo(0, 6);
  });

  it.each([
    ["froxel_reproject.wgsl", reprojectWGSL],
    ["froxel_integrate.wgsl", integrateWGSL],
  ])("%s unprojects view depth through the engine's GL-clip perspective matrix", (_n, src) => {
    const clipZ = wgslClipZ(src);
    const proj = new Matrix4();
    Matrix4.perspective(Math.PI / 3, 16 / 9, near, far, proj);
    const invProj = new Matrix4();
    expect(Matrix4.invert(proj, invProj)).toBe(true);
    for (const zTest of [0.5, 2.0, 10.0, 50.0, 95.0]) {
      const cz = clipZ(zTest, near, far);
      expect(cz).toBeGreaterThanOrEqual(-1.001);
      expect(cz).toBeLessThanOrEqual(1.001);
      const m = invProj.data;
      const z = m[10]! * cz + m[14]!;
      const w = m[11]! * cz + m[15]!;
      expect(z / w).toBeCloseTo(-zTest, 2);
    }
  });
});

describe("Froxel reprojection shader structure", () => {
  it("clamps history to the 7-tap neighbourhood AABB before the EMA blend", () => {
    expect(reprojectWGSL).toMatch(/let clampedHistory = clamp\(historySample, boxMin, boxMax\);/);
    expect(reprojectWGSL).toMatch(/mix\(currentSample, clampedHistory, alpha\)/);
    expect(reprojectWGSL.match(/vec3i\(-?\d, -?\d, -?\d\)/g)).toHaveLength(6);
  });

  it("caps the history weight below 1 so the history can never freeze", () => {
    expect(reprojectWGSL).toMatch(/clamp\(uni\.reprojectParams\.x, 0\.0, 0\.98\)/);
  });
});

describe("Froxel reprojection teleport branch (FROXEL-TELEPORT-MATH)", () => {
  /**
   * @invariant FROXEL-TELEPORT-MATH: Beim Teleport liegt die prev-Projection eines Frames außerhalb
   *   des Vorgänger-Frustums (`prevClip.w <= 0.001` bzw. NDC/Slice-Fenster verfehlt). Der
   *   Reproject-Kern initialisiert `blendedResult` mit `currentSample` und verlässt es in genau
   *   diesen Fällen, damit KEIN ungeclamptes Stale-History-Sample durchblutet (Variance-Clamp
   *   hätte sonst keinen gültigen AABB-Anker). Nur für gültig reprojezierbare Vorpositionen wird
   *   EMA-geblendet.
   */
  it("guards the history blend behind a strict previous-frustum test (teleport => pure currentSample)", () => {
    // Struktureller Guard gegen Regressions: Der Kern muss out-of-frustum hart auf currentSample
    // fallen, sonst blutet History vom alten Kamerastandort in den neuen.
    expect(reprojectWGSL).toContain("var blendedResult = currentSample;");
    expect(reprojectWGSL).toContain("if (prevClip.w > 0.001) {");
    expect(reprojectWGSL).toMatch(
      /prevUV\.x >= 0\.0 && prevUV\.x <= 1\.0[\s\S]*prevUV\.y >= 0\.0 && prevUV\.y <= 1\.0[\s\S]*prevSliceW >= 0\.0 && prevSliceW <= 1\.0/,
    );
    expect(reprojectWGSL).toContain("textureStore(outputVolume, coord, blendedResult);");
    // Ohne gültige Vorposition darf der Blend-Pfad gar nicht erst ausgeführt werden.
    const mixCallIndex = reprojectWGSL.indexOf("mix(currentSample, clampedHistory, alpha)");
    const guardIndex = reprojectWGSL.indexOf("if (prevUV.x >= 0.0");
    expect(mixCallIndex).toBeGreaterThan(guardIndex);
  });

  it("mirrors the branch decision: out-of-frustum prev position keeps the current sample bit-exact", () => {
    // Math-Mirror der exakten WGSL-Entscheidung (Konstanten + Relationale Semantik aus dem
    // SHIPPED Kern). Der Mirror erzeugt denselben "blend oder nicht"-Pfad.
    const mirrorReproject = (
      currentSample: number,
      clampedHistory: number,
      alpha: number,
      prevClipW: number,
      prevUVx: number,
      prevUVy: number,
      prevSliceW: number,
    ): number => {
      // `var blendedResult = currentSample;` (Shader-Zeile, unverändert von Kern übernommen)
      let result = currentSample;
      if (prevClipW > 0.001) {
        const prevUVIn = prevUVx >= 0.0 && prevUVx <= 1.0 && prevUVy >= 0.0 && prevUVy <= 1.0;
        const prevSliceIn = prevSliceW >= 0.0 && prevSliceW <= 1.0;
        if (prevUVIn && prevSliceIn) {
          const clampedAlpha = Math.min(Math.max(alpha, 0), 0.98); // clamp(uni.reprojectParams.x, 0, 0.98)
          result = currentSample * (1 - clampedAlpha) + clampedHistory * clampedAlpha;
        }
      }
      return result;
    };

    // 1) Teleport-Fall: prevClip.w <= 0.001 (hinter der Vor-Kamera) => gar kein Blend.
    for (const w of [0.001, 0.0, -1.0, -1e9]) {
      const out = mirrorReproject(0.1234, 0.9876, 0.9, w, 0.5, 0.5, 0.5);
      expect(out).toBe(0.1234); // bit-exakt = currentSample, kein Stale-Einfluss
    }

    // 2) Out-of-Normalized-Range (verfehltes Vorgänger-NDC) => ebenfalls reiner currentSample.
    const outOfRange = [
      [-0.01, 0.5, 0.5],
      [1.01, 0.5, 0.5],
      [0.5, -0.01, 0.5],
      [0.5, 1.01, 0.5],
      [0.5, 0.5, -0.01],
      [0.5, 0.5, 1.01],
    ] as const;
    for (const [x, y, s] of outOfRange) {
      const out = mirrorReproject(0.5, 0.9, 0.98, 5.0, x, y, s);
      expect(out).toBe(0.5);
    }

    // 3) Gültige Vorposition => Blend findet statt (History-Clamp-Anker, EMA).
    const blended = mirrorReproject(0.5, 0.9, 0.98, 5.0, 0.5, 0.4, 0.6);
    expect(blended).toBeCloseTo(0.892, 3); // 0.5*(1-0.98) + 0.9*0.98 = 0.892

    // 4) Alpha ist hart auf 0.98 gedeckelt (Kap self-history-freeze aus dem realen Kern).
    const capped = mirrorReproject(0.0, 1.0, 5.0, 5.0, 0.5, 0.5, 0.5);
    expect(capped).toBeCloseTo(0.98, 6);
  });
});
