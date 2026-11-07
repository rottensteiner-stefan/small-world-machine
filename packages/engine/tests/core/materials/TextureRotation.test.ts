import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StandardMaterial } from "../../../src/core/materials/surface/StandardMaterial.js";
import { Texture } from "../../../src/core/textures/index.js";

const SHADERS = join(__dirname, "../../../src/renderers/shaders/source");
const read = (relative: string): string => readFileSync(join(SHADERS, relative), "utf8");

/** Khronos KHR_texture_transform reference: `matrix = translation * rotation * scale`, column-major mat3. */
function khronosTransform(
  uv: [number, number],
  offset: [number, number],
  rotation: number,
  scale: [number, number],
): [number, number] {
  const mul = (a: number[], b: number[]): number[] => {
    const out = new Array<number>(9).fill(0);
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) {
        for (let k = 0; k < 3; k++) out[col * 3 + row]! += a[k * 3 + row]! * b[col * 3 + k]!;
      }
    }
    return out;
  };
  const translation = [1, 0, 0, 0, 1, 0, offset[0], offset[1], 1];
  const rot = [
    Math.cos(rotation),
    Math.sin(rotation),
    0,
    -Math.sin(rotation),
    Math.cos(rotation),
    0,
    0,
    0,
    1,
  ];
  const scl = [scale[0], 0, 0, 0, scale[1], 0, 0, 0, 1];
  const m = mul(mul(translation, rot), scl);
  return [m[0]! * uv[0] + m[3]! * uv[1] + m[6]!, m[1]! * uv[0] + m[4]! * uv[1] + m[7]!];
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

type Vec2 = [number, number];
type Vec3 = [number, number, number];

/** Compile a scalar GLSL/WGSL arithmetic expression from the real shader text (only + - * and identifiers). */
function compileScalar(expr: string, params: string[]): (...args: number[]) => number {
  if (!/^[\w\s.+\-*()]+$/.test(expr)) throw new Error(`not a scalar expression: ${expr}`);
  return new Function(...params, `return ${expr};`) as (...args: number[]) => number;
}

interface TierShader {
  /** UV transform exactly as the shader source computes it (uv, offset, rotation, scale -> uv'). */
  uv(uv: Vec2, offset: Vec2, rotation: number, scale: Vec2): Vec2;
  /** Rotated tangent frame exactly as the shader source computes it, per component. */
  frame(t: Vec3, b: Vec3, rotation: number): { t: Vec3; b: Vec3 };
}

/**
 * Builds the CPU evaluation of a tier from its vertex shader TEXT: the uv' line and the T'/B' expressions are
 * regex-extracted and evaluated, so a change in the shader changes this test (not a test-local copy of the maths).
 */
function loadTier(source: string, tbn: "glsl" | "wgsl"): TierShader {
  const code = stripComments(source);
  const uvMatch =
    /v_uv\s*=\s*vec2\(([^;]+?),\s*(uvSin \* uvScaled\.x \+ uvCos \* uvScaled\.y)\)\s*\+\s*u_texOffset;|o\.uv\s*=\s*vec2f\(([^;]+?),\s*(uvSin \* uvScaled\.x \+ uvCos \* uvScaled\.y)\)\s*\+\s*obj\.texOffset;/.exec(
      code,
    );
  if (!uvMatch) throw new Error("uv' assignment not found");
  const ex = (uvMatch[1] ?? uvMatch[3])!
    .replace(/uvScaled\.x/g, "ux")
    .replace(/uvScaled\.y/g, "uy");
  const ey = (uvMatch[2] ?? uvMatch[4])!
    .replace(/uvScaled\.x/g, "ux")
    .replace(/uvScaled\.y/g, "uy");
  const fx = compileScalar(ex, ["uvCos", "uvSin", "ux", "uy"]);
  const fy = compileScalar(ey, ["uvCos", "uvSin", "ux", "uy"]);

  let te: string;
  let be: string;
  if (tbn === "glsl") {
    const m = /v_tbn\s*=\s*mat3\(([^,]+),\s*([^,]+),\s*N(?:_v)?\);/.exec(code);
    if (!m) throw new Error("v_tbn assignment not found");
    te = m[1]!.trim();
    be = m[2]!.trim();
  } else {
    const mt = /o\.t\s*=\s*(uvCos[^;]+);/.exec(code);
    const mb = /o\.b\s*=\s*(uvSin[^;]+);/.exec(code);
    if (!mt || !mb) throw new Error("o.t / o.b rotation not found");
    te = mt[1]!.replace(/uvT/g, "T").replace(/uvB/g, "B");
    be = mb[1]!.replace(/uvT/g, "T").replace(/uvB/g, "B");
  }
  const ft = compileScalar(te, ["uvCos", "uvSin", "T", "B"]);
  const fb = compileScalar(be, ["uvCos", "uvSin", "T", "B"]);

  return {
    uv(uv, offset, rotation, scale): Vec2 {
      const ux = uv[0] * scale[0];
      const uy = uv[1] * scale[1];
      const c = Math.cos(rotation);
      const s = Math.sin(rotation);
      return [fx(c, s, ux, uy) + offset[0], fy(c, s, ux, uy) + offset[1]];
    },
    frame(t, b, rotation): { t: Vec3; b: Vec3 } {
      const c = Math.cos(rotation);
      const s = Math.sin(rotation);
      const outT = [0, 1, 2].map((i) => ft(c, s, t[i]!, b[i]!)) as Vec3;
      const outB = [0, 1, 2].map((i) => fb(c, s, t[i]!, b[i]!)) as Vec3;
      return { t: outT, b: outB };
    },
  };
}

const TIERS: ReadonlyArray<readonly [string, string, "glsl" | "wgsl"]> = [
  ["WGSL", "web_gpu/base.vert.wgsl", "wgsl"],
  ["WebGL2", "web_gl2/chunks/base_vertex_main.vert.glsl", "glsl"],
  ["WebGL1", "web_gl1/base.vert.glsl", "glsl"],
];

/**
 * Independent reference for the normal-map tangent frame. The sampled coordinate is uv' = L * uv + offset with L
 * the linear part of the Khronos matrix (R * S). A surface point is P(uv) = u * T + v * B, so the tangent frame
 * the normal map is authored in (dP/du', dP/dv') is the columns of L^-1 applied to (T, B). Computed by a plain
 * 2x2 inverse of the Khronos matrix: no shader expression involved. Exact for uniform scale 1 (the engine frame
 * is orthonormal by contract; non-uniform repeat is not part of the tangent frame).
 */
function referenceFrame(t: Vec3, b: Vec3, rotation: number): { t: Vec3; b: Vec3 } {
  const l = khronosTransform([1, 0], [0, 0], rotation, [1, 1]);
  const l2 = khronosTransform([0, 1], [0, 0], rotation, [1, 1]);
  // L columns: (l[0], l[1]) and (l2[0], l2[1]).
  const det = l[0] * l2[1] - l2[0] * l[1];
  const inv00 = l2[1] / det;
  const inv01 = -l2[0] / det;
  const inv10 = -l[1] / det;
  const inv11 = l[0] / det;
  const mix = (x: number, y: number, i: number): number => x * t[i]! + y * b[i]!;
  return {
    t: [0, 1, 2].map((i) => mix(inv00, inv10, i)) as Vec3,
    b: [0, 1, 2].map((i) => mix(inv01, inv11, i)) as Vec3,
  };
}

describe("KHR_texture_transform rotation", () => {
  for (const [tier, file, kind] of TIERS) {
    const shader = loadTier(read(file), kind);

    it(`${tier}: the shader's uv' expression equals the Khronos T * R * S matrix (non-uniform scale, any angle)`, () => {
      const cases: Array<[Vec2, Vec2, number, Vec2]> = [
        [[0.3, 0.8], [0.25, -0.5], 0.9, [2, 3]],
        [[1, 0], [0, 0], Math.PI / 2, [1, 1]],
        [[0.5, 0.5], [0.1, 0.2], -1.3, [4, 0.5]],
      ];

      for (const [uv, offset, rotation, scale] of cases) {
        const expected = khronosTransform(uv, offset, rotation, scale);
        const actual = shader.uv(uv, offset, rotation, scale);

        expect(actual[0]).toBeCloseTo(expected[0], 10);
        expect(actual[1]).toBeCloseTo(expected[1], 10);
      }
    });

    it(`${tier}: rotates counter-clockwise (+90 degrees maps +u onto +v) and is the identity at rotation 0`, () => {
      const [u, v] = shader.uv([1, 0], [0, 0], Math.PI / 2, [1, 1]);
      expect(u).toBeCloseTo(0, 10);
      expect(v).toBeCloseTo(1, 10);
      expect(shader.uv([0.3, 0.8], [0, 0], 0, [1, 1])).toEqual([0.3, 0.8]);
    });

    it(`${tier}: the shader's rotated tangent frame matches dP/du', dP/dv' from the inverted Khronos matrix`, () => {
      // Arbitrary orthonormal mesh frame (T, B) incl. a mirrored one (B sign folded in, as in the vertex stage).
      const frames: Array<[Vec3, Vec3]> = [
        [
          [1, 0, 0],
          [0, 0, -1],
        ],
        [
          [0, 1, 0],
          [0, 0, 1],
        ],
        [
          [0.6, 0.8, 0],
          [0, 0, 1],
        ],
        [
          [1, 0, 0],
          [0, 0, 1],
        ],
      ];
      for (const rotation of [0, 0.4, Math.PI / 2, -2.2, 3.5]) {
        for (const [t, b] of frames) {
          const got = shader.frame(t, b, rotation);
          const want = referenceFrame(t, b, rotation);
          for (let i = 0; i < 3; i++) {
            expect(got.t[i]).toBeCloseTo(want.t[i]!, 10);
            expect(got.b[i]).toBeCloseTo(want.b[i]!, 10);
          }
        }
      }
    });
  }

  it("ships the carrier texture's rotation in u_texRotation and resets it without a texture", () => {
    const texture = Texture.fromImage({} as ImageBitmap);
    texture.rotation = 0.5;
    const material = new StandardMaterial({ diffuseMap: texture });

    expect(material.getRenderManifest().properties["u_texRotation"]).toBe(0.5);

    material.diffuseMap = undefined;
    expect(material.getRenderManifest().properties["u_texRotation"]).toBe(0);
  });

  for (const [tier, file] of TIERS) {
    it(`${tier} vertex shader skips cos/sin at rotation 0 (no per-vertex trigonometry for the identity)`, () => {
      const source = stripComments(read(file));
      expect(source).toMatch(/if \((?:u_texRotation|obj\.texRotation) != 0\.0\)/);
      expect(source).not.toMatch(/(?:float|let) uvCos = cos\(/);
    });
  }

  it("Standard fragment shaders sample the alpha map with the transformed UV in all tiers (no `/ texRepeat` reconstruction)", () => {
    for (const file of ["Standard.frag.glsl", "Standard.frag.glsl100", "Standard.frag.wgsl"]) {
      const source = stripComments(
        readFileSync(join(__dirname, "../../../src/core/materials/surface/shaders", file), "utf8"),
      );
      expect(source, file).not.toContain("original_uv");
      expect(source, file).toMatch(/u_alphaMap,\s*(?:s,\s*)?(?:v_uv|i\.uv)\)/);
    }
  });

  it("declares the rotation uniform in every WebGL vertex program and the WebGPU object struct", () => {
    expect(read("web_gl2/chunks/base_vertex_header.vert.glsl")).toContain(
      "uniform float u_texRotation;",
    );
    expect(read("web_gl1/base.vert.glsl")).toContain("uniform float u_texRotation;");
    expect(read("web_gpu/chunks/structs.wgsl")).toMatch(/texRotation: f32/);
  });
});
