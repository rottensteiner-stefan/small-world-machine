import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { ImpastoStrokeMaterial } from "../src/materials/ImpastoStrokeMaterial.js";
import { MetalReliefMaterial } from "../src/materials/MetalReliefMaterial.js";
import { MetalReliefScreenMaterial } from "../src/materials/MetalReliefScreenMaterial.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const ENGINE_WGSL = resolve(HERE, "../../engine/src/renderers/shaders/source/web_gpu");

const MATERIALS = [
  { name: "MetalRelief", dir: "materials/shaders" },
  { name: "MetalReliefScreen", dir: "materials/shaders" },
  { name: "ImpastoStroke", dir: "materials/shaders" },
] as const;

type Dialect = "glsl" | "glsl100" | "wgsl";
const DIALECTS: readonly Dialect[] = ["glsl", "glsl100", "wgsl"];

function read(dir: string, name: string, dialect: Dialect): string {
  return readFileSync(resolve(SRC, dir, `${name}.frag.${dialect}`), "utf8");
}

/** `matParam2.x` style accesses, with the dialect prefix (`obj.` / `u_`) stripped. */
function laneAccesses(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/(?:obj\.|u_)(matParam\d+\.[xyzw])/g)) found.add(m[1]!);
  return [...found].sort();
}

describe("artistic shader dialect parity (real source files)", () => {
  for (const { name, dir } of MATERIALS) {
    describe(name, () => {
      it("reads the same lane components in WGSL, GLSL300 and GLSL100", () => {
        const [a, b, c] = DIALECTS.map((d) => laneAccesses(read(dir, name, d)));
        expect(a!.length).toBeGreaterThan(0);
        expect(b).toEqual(a);
        expect(c).toEqual(a);
      });

      it("never reads generic slots (ADR 0039)", () => {
        for (const d of DIALECTS) {
          expect(read(dir, name, d)).not.toMatch(/styleA|styleB|extraParams|liquidParams/);
        }
      });

      it("applies fog in every dialect (WebGL tiers must not lose fog)", () => {
        expect(read(dir, name, "glsl")).toContain("[FOG_DEFS]");
        expect(read(dir, name, "glsl")).toContain("[FOG_CALC]");
        expect(read(dir, name, "glsl100")).toContain("[FOG_DEFS]");
        expect(read(dir, name, "glsl100")).toContain("[FOG_CALC]");
        expect(read(dir, name, "wgsl")).toContain("[WGSL_FOG_CALC]");
      });

      it("uses a sine-free hash identical across dialects", () => {
        for (const d of DIALECTS) {
          const src = read(dir, name, d);
          if (!/_hash\(/.test(src)) continue;
          expect(src).toContain("0.1031");
          expect(src).toContain("0.0973");
          expect(src).not.toContain("43758");
        }
      });
    });
  }

  for (const name of ["MetalRelief", "ImpastoStroke"] as const) {
    it(`${name} derives the view vector from the camera position, not the origin`, () => {
      for (const d of DIALECTS) {
        const src = read("materials/shaders", name, d);
        expect(src).not.toMatch(/normalize\(-\s*(?:v_worldPos|i\.wp)\)/);
      }
      expect(read("materials/shaders", name, "wgsl")).toContain("global.viewPos");
      expect(read("materials/shaders", name, "glsl")).toContain("u_viewPos - v_worldPos");
      expect(read("materials/shaders", name, "glsl100")).toContain("u_viewPos - v_worldPos");
    });
  }

  it("MetalRelief curvature uses the same metric on WebGL1 and WebGL2 (WebGL1 extension-less fallback is 0)", () => {
    const g300 = read("materials/shaders", "MetalRelief", "glsl");
    const g100 = read("materials/shaders", "MetalRelief", "glsl100");
    const metric = "length(abs(dFdx(perturbedN)) + abs(dFdy(perturbedN))) * 6.0";
    expect(g300).toContain(metric);
    expect(g100).toContain(metric);
    expect(g100).toMatch(/#else\s+float curvature = 0\.0;/);
  });

  it("post WGSL fetches through the V-flipping helper only", () => {
    const wgsl = readFileSync(resolve(SRC, "post/shaders/MetalReliefPost.frag.wgsl"), "utf8");
    // The only raw textureSample is the one inside sampleUp: WebGPU row 0 is the top row while the
    // shader math (like the GLSL variants) is y-up.
    expect(wgsl.match(/textureSample\(uTexture/g)).toHaveLength(1);
    expect(wgsl).toMatch(/fn sampleUp[\s\S]*?1\.0 - uv\.y/);
  });
});

describe("WGSL assembly parses (same approach as scripts/lint-wgsl.ts)", () => {
  const chunk = (file: string): string => readFileSync(resolve(ENGINE_WGSL, file), "utf8");
  const chunks = new Map<string, string>([
    ["WGSL_STRUCTS", chunk("chunks/structs.wgsl")],
    ["WGSL_VS", chunk("base.vert.wgsl")],
    ["WGSL_FOG_CALC", chunk("chunks/fog_calc.wgsl")],
  ]);
  const assemble = (code: string): string =>
    code.replace(/\[([A-Z_]+)\]/g, (match, key: string) => chunks.get(key) ?? match);

  const materials = [
    ["MetalReliefMaterial", new MetalReliefMaterial()],
    ["MetalReliefScreenMaterial", new MetalReliefScreenMaterial()],
    ["ImpastoStrokeMaterial", new ImpastoStrokeMaterial()],
  ] as const;

  for (const [label, material] of materials) {
    it(`${label} WGSL has no unresolved chunk and parses`, () => {
      const code = assemble(material.getShaderDefinition().sources.wgsl as string);
      expect(code).not.toMatch(/\[[A-Z_]{4,}\]/);
      expect(() => new WgslReflect(code)).not.toThrow();
    });
  }

  it("MetalReliefPost WGSL parses", () => {
    const code = readFileSync(resolve(SRC, "post/shaders/MetalReliefPost.frag.wgsl"), "utf8");
    expect(() => new WgslReflect(code)).not.toThrow();
  });
});
