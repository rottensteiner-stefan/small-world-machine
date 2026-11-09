import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validate, formatDiagnostic, LIMITS } from "@moreplease/glslang";
import { beforeAll, describe, expect, it } from "vitest";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { Color } from "../../../src/core/colors/Color.js";
import { StandardMaterial } from "../../../src/core/materials/surface/StandardMaterial.js";
import { ShaderFlag } from "../../../src/enums/ShaderFlag.js";
import { preprocessConditionals } from "../../../src/renderers/shaders/preprocessConditionals.js";
import { ShaderBootstrap } from "../../../src/renderers/shaders/ShaderBootstrap.js";
import { ShaderRegistry } from "../../../src/renderers/shaders/ShaderRegistry.js";

const SRC_DIR = join(__dirname, "../../../src");
const read = (relative: string): string => readFileSync(join(SRC_DIR, relative), "utf8");
const lane = (m: StandardMaterial): number[] =>
  (m.getRenderManifest().properties as Record<string, number[]>)["u_matParam1"]!;

describe("StandardMaterial backlight (ADR 0060): lane u_matParam1", () => {
  it("is off at the defaults (black, no compile flag)", () => {
    const manifest = new StandardMaterial().getRenderManifest();
    expect(manifest.flags).not.toContain(ShaderFlag.BACKLIGHT);
  });

  it("packs tint + thickness and sets the compile flag", () => {
    const material = new StandardMaterial({
      backlight: new Color(0.5, 0.6, 0.2),
      backlightThickness: 2,
    });
    expect(lane(material)).toEqual([0.5, 0.6, 0.2, 2]);
    expect(material.getRenderManifest().flags).toContain(ShaderFlag.BACKLIGHT);
  });

  it("re-disables the flag when the tint returns to black", () => {
    const material = new StandardMaterial({ backlight: new Color(0.4, 0.4, 0.4) });
    material.getRenderManifest();
    material.backlight.set(0, 0, 0);
    expect(material.getRenderManifest().flags).not.toContain(ShaderFlag.BACKLIGHT);
  });
});

describe("StandardMaterial backlight: three-tier shader parity", () => {
  const chunks = {
    wgsl: read("renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl"),
    gl2: read("renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl"),
    gl1: read("renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl"),
  };

  for (const [tier, source] of Object.entries(chunks)) {
    it(`${tier}: adds the transmission lobe behind USE_BACKLIGHT`, () => {
      expect(source).toMatch(
        /#ifdef USE_BACKLIGHT[\s\S]*max\(dot\(-N, L\), 0\.0\)[\s\S]*dot\(-V, L\)/,
      );
    });
  }

  it("shadowed tiers sample the transmission shadow toward the sun by the thickness", () => {
    expect(chunks.wgsl).toContain("i.wp + L * obj.matParam1.w");
    expect(chunks.gl2).toContain("v_worldPos + L * u_matParam1.w");
  });

  it("the Decal program sharing the chunk never declares the lane", () => {
    expect(read("core/materials/surface/shaders/Decal.frag.glsl")).not.toContain("u_matParam1;");
  });
});

describe("StandardMaterial backlight: compiles with the flag on", () => {
  const registry = new ShaderRegistry();
  const material = new StandardMaterial({ backlight: new Color(0.5, 0.6, 0.2) });
  const flags = new Set<string>(material.getRenderManifest().flags ?? []);
  const defines = [...flags].map((f) => `#define ${f} 1\n`).join("");

  beforeAll(async () => {
    await ShaderBootstrap.init(registry);
  });

  it("GLSL ES 3.00", async () => {
    const def = material.getShaderDefinition();
    const vs = registry.assemble(def.sources.glsl300!.vs, "glsl300");
    const fs = registry.assemble(def.sources.glsl300!.fs, "glsl300");
    const [version, ...rest] = fs.trimStart().split("\n");
    const res = await validate(
      [
        { name: "standard.vert", source: vs },
        { name: "standard.frag", source: `${version}\n${defines}${rest.join("\n")}` },
      ],
      { target: "webgl2" },
    );
    expect(res.ok, res.diagnostics.map(formatDiagnostic).join("\n")).toBe(true);
  });

  it("GLSL ES 1.00", async () => {
    const def = material.getShaderDefinition();
    const vs = registry.assemble(def.sources.glsl100!.vs, "glsl100");
    const fs = registry.assemble(def.sources.glsl100!.fs, "glsl100");
    const res = await validate(
      [
        { name: "standard.vert", source: vs },
        { name: "standard.frag", source: `${defines}${fs}` },
      ],
      {
        target: "webgl1",
        limits: { ...LIMITS.webgl1, maxFragmentUniformVectors: 1024, maxTextureImageUnits: 16 },
      },
    );
    expect(res.ok, res.diagnostics.map(formatDiagnostic).join("\n")).toBe(true);
  });

  it("WGSL parses", () => {
    const wgsl = preprocessConditionals(
      "const USE_DECAL_GRADIENTS: bool = false;\n" +
        registry.assemble(material.getShaderDefinition().sources.wgsl!, "wgsl"),
      flags,
    );
    expect(wgsl).toContain("backlightShadow");
    expect(() => new WgslReflect(wgsl)).not.toThrow();
  });
});
