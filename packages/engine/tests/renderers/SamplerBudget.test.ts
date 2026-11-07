import { afterEach, describe, expect, it, vi } from "vitest";
import { ShaderFlag } from "../../src/enums/index.js";
import { StandardMaterial } from "../../src/core/materials/surface/StandardMaterial.js";
import { WebGLProgramCache } from "../../src/renderers/gl/managers/WebGLProgramCache.js";
import {
  countMaterialSamplers,
  dropNextExtensionMapGroup,
  fitFlagsToTextureUnits,
  nextUnitAfter,
} from "../../src/renderers/gl/managers/SamplerBudget.js";
import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";

describe("countMaterialSamplers (the preprocessor the budget check runs before linking)", () => {
  it("counts samplers, array sizes and honours precision qualifiers", () => {
    const source = [
      "uniform sampler2D u_a;",
      "uniform highp samplerCube u_b;",
      "uniform mediump sampler2DArray u_c;",
      "uniform sampler2D u_d[3];",
    ].join("\n");

    expect(countMaterialSamplers(source)).toBe(1 + 1 + 1 + 3);
  });

  it("ignores the renderer-owned shadow samplers and non-material sampler kinds", () => {
    const source = [
      "uniform sampler2DShadow u_dirShadowMap;",
      "uniform sampler2D u_dirShadowMapRaw;",
      "uniform sampler2DArrayShadow u_spotShadowMap;",
      "uniform usampler2D u_clusterGrid;",
      "uniform sampler2D u_real;",
    ].join("\n");

    expect(countMaterialSamplers(source)).toBe(1);
  });

  it("follows #define, #ifdef, #ifndef, #else and #undef like the compiler", () => {
    const source = [
      "#define USE_A 1",
      "#ifdef USE_A",
      "uniform sampler2D u_a;",
      "#else",
      "uniform sampler2D u_notA;",
      "#endif",
      "#ifndef USE_B",
      "uniform sampler2D u_notB;",
      "#endif",
      "#undef USE_A",
      "#ifdef USE_A",
      "uniform sampler2D u_gone;",
      "#endif",
    ].join("\n");

    expect(countMaterialSamplers(source)).toBe(2);
  });

  it("evaluates #if expressions: defined(), !, &&, || and __VERSION__ == 300", () => {
    const source = [
      "#define X 1",
      "#if defined(X) && !defined(Y)",
      "uniform sampler2D u_one;",
      "#endif",
      "#if defined(Y) || defined(X)",
      "uniform sampler2D u_two;",
      "#endif",
      "#if defined(Y) && defined(X)",
      "uniform sampler2D u_never;",
      "#endif",
      "#if __VERSION__ == 300",
      "uniform sampler2D u_version;",
      "#endif",
      "#if X == 1 && (defined(X) || defined(Y))",
      "uniform sampler2D u_paren;",
      "#endif",
    ].join("\n");

    expect(countMaterialSamplers(source)).toBe(4);
  });

  it("nests blocks and never revives an inner branch under an inactive parent", () => {
    const source = [
      "#ifdef OUTER",
      "#ifdef INNER",
      "uniform sampler2D u_inner;",
      "#else",
      "uniform sampler2D u_outerOnly;",
      "#endif",
      "#else",
      "uniform sampler2D u_noOuter;",
      "#endif",
    ].join("\n");

    expect(countMaterialSamplers(`#define OUTER 1\n#define INNER 1\n${source}`)).toBe(1);
    expect(countMaterialSamplers(`#define OUTER 1\n${source}`)).toBe(1);
    expect(countMaterialSamplers(source)).toBe(1);
  });

  it("ignores function-like #define macros without confusing later conditions", () => {
    const source = [
      "#define SAMPLE(x) texture(u_a, x)",
      "#ifdef SAMPLE",
      "uniform sampler2D u_a;",
      "#endif",
    ].join("\n");

    expect(countMaterialSamplers(source)).toBe(1);
  });
});

describe("nextUnitAfter (the allocator skips the renderer's units 11..15)", () => {
  it("is the sampler count below the reserved range and jumps over it above", () => {
    expect(nextUnitAfter(0)).toBe(0);
    expect(nextUnitAfter(11)).toBe(11);
    expect(nextUnitAfter(12)).toBe(17);
    expect(nextUnitAfter(14)).toBe(19);
  });
});

describe("dropNextExtensionMapGroup / fitFlagsToTextureUnits", () => {
  it("drops one whole feature group at a time, iridescence first, and never a core map", () => {
    const flags = [
      ShaderFlag.METALLIC_MAP,
      ShaderFlag.NORMAL_MAP,
      ShaderFlag.IRIDESCENCE,
      ShaderFlag.IRIDESCENCE_MAP,
      ShaderFlag.IRIDESCENCE_THICKNESS_MAP,
      ShaderFlag.IRIDESCENCE_MAPS_SHARED,
      ShaderFlag.SPECULAR_COLOR_MAP,
      ShaderFlag.ANISOTROPY_MAP,
    ];

    const first = dropNextExtensionMapGroup(flags)!;
    const second = dropNextExtensionMapGroup(first)!;
    const third = dropNextExtensionMapGroup(second)!;

    expect(first).toEqual([
      ShaderFlag.METALLIC_MAP,
      ShaderFlag.NORMAL_MAP,
      ShaderFlag.IRIDESCENCE,
      ShaderFlag.SPECULAR_COLOR_MAP,
      ShaderFlag.ANISOTROPY_MAP,
    ]);
    expect(second).not.toContain(ShaderFlag.SPECULAR_COLOR_MAP);
    expect(third).not.toContain(ShaderFlag.ANISOTROPY_MAP);
    expect(dropNextExtensionMapGroup(third)).toBeUndefined();
    expect(third).toEqual([ShaderFlag.METALLIC_MAP, ShaderFlag.NORMAL_MAP, ShaderFlag.IRIDESCENCE]);
  });

  it("stops as soon as the program fits and reports what it dropped", () => {
    const flags = [
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.ANISOTROPY_MAP,
      ShaderFlag.SHEEN_COLOR_MAP,
    ];
    // each present flag costs 3 units, the limit allows exactly two flags
    const unitsNeeded = (candidate: readonly string[]): number => candidate.length * 3;

    const fitted = fitFlagsToTextureUnits(flags, unitsNeeded, 6);

    expect(fitted.flags).toEqual([ShaderFlag.ANISOTROPY_MAP, ShaderFlag.SHEEN_COLOR_MAP]);
    expect(fitted.dropped).toEqual([ShaderFlag.SPECULAR_WEIGHT_MAP]);
  });

  it("leaves a program that already fits untouched", () => {
    const flags = [ShaderFlag.SPECULAR_WEIGHT_MAP];

    expect(fitFlagsToTextureUnits(flags, () => 3, 16)).toEqual({ flags, dropped: [] });
  });

  it("gives up without dropping core flags when nothing droppable is left", () => {
    const flags = [ShaderFlag.NORMAL_MAP, ShaderFlag.METALLIC_MAP];

    const fitted = fitFlagsToTextureUnits(flags, () => 99, 16);

    expect(fitted.flags).toEqual(flags);
    expect(fitted.dropped).toEqual([]);
  });
});

describe("the budget check on the real GLSL 300 Standard program", () => {
  const registry = new ShaderRegistry();
  CoreShaderChunks.init(registry);
  const definition = new StandardMaterial().getShaderDefinition();
  registry.register(definition);

  const stubGl = (maxUnits: number): WebGL2RenderingContext =>
    ({
      MAX_TEXTURE_IMAGE_UNITS: 0x8872,
      getParameter: () => maxUnits,
    }) as unknown as WebGL2RenderingContext;

  const fit = (flags: string[], maxUnits: number): string[] =>
    (
      new WebGLProgramCache(stubGl(maxUnits), registry) as unknown as {
        _fitTextureUnits: (
          def: unknown,
          id: string,
          instanced: boolean,
          flags: string[],
        ) => string[];
      }
    )._fitTextureUnits(definition, definition.id, false, flags);

  const pbrBase = [
    ShaderFlag.NORMAL_MAP,
    ShaderFlag.METALLIC_MAP,
    ShaderFlag.ROUGHNESS_MAP,
    ShaderFlag.AO_MAP,
    ShaderFlag.EMISSIVE_MAP,
    ShaderFlag.IBL,
  ];
  const everything = [
    ...pbrBase,
    ShaderFlag.MATERIAL_SPECULAR,
    ShaderFlag.SPECULAR_WEIGHT_MAP,
    ShaderFlag.SPECULAR_COLOR_MAP,
    ShaderFlag.ANISOTROPY,
    ShaderFlag.ANISOTROPY_MAP,
    ShaderFlag.IRIDESCENCE,
    ShaderFlag.IRIDESCENCE_MAP,
    ShaderFlag.IRIDESCENCE_THICKNESS_MAP,
  ];

  afterEach(() => vi.restoreAllMocks());

  it("a device with 16 units drops iridescence, then specular maps, and keeps the anisotropy map", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const fitted = fit(everything, 16);

    expect(fitted).toEqual(
      expect.arrayContaining([
        ShaderFlag.ANISOTROPY,
        ShaderFlag.ANISOTROPY_MAP,
        ShaderFlag.IRIDESCENCE,
      ]),
    );
    for (const gone of [
      ShaderFlag.IRIDESCENCE_MAP,
      ShaderFlag.IRIDESCENCE_THICKNESS_MAP,
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.SPECULAR_COLOR_MAP,
    ]) {
      expect(fitted).not.toContain(gone);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(ShaderFlag.IRIDESCENCE_MAP);
  });

  it("keeps every flag on a device with 32 units, without a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(fit(everything, 32)).toEqual(everything);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not even assemble the shader for a material without extension maps", () => {
    const flags = [...pbrBase, ShaderFlag.MATERIAL_SPECULAR];
    const assembleSpy = vi.spyOn(registry, "assemble");

    expect(fit(flags, 16)).toEqual(flags);
    expect(assembleSpy).not.toHaveBeenCalled();
  });

  it("the shared metallic/roughness sampler is what lets helmet + EVSM + both specular maps fit 16 units", () => {
    const withSpecular = [
      ...pbrBase,
      "USE_EVSM",
      ShaderFlag.MATERIAL_SPECULAR,
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.SPECULAR_COLOR_MAP,
    ];

    expect(fit([...withSpecular, ShaderFlag.METALLIC_ROUGHNESS_SHARED], 16)).toEqual([
      ...withSpecular,
      ShaderFlag.METALLIC_ROUGHNESS_SHARED,
    ]);
    expect(fit(withSpecular, 16)).not.toContain(ShaderFlag.SPECULAR_COLOR_MAP);
  });

  it("packed specular maps share one sampler: the anisotropy map fits next to them on 16 units", () => {
    const helmet = [
      ...pbrBase,
      "USE_EVSM",
      ShaderFlag.METALLIC_ROUGHNESS_SHARED,
      ShaderFlag.MATERIAL_SPECULAR,
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.SPECULAR_COLOR_MAP,
      ShaderFlag.ANISOTROPY,
      ShaderFlag.ANISOTROPY_MAP,
    ];
    const shared = [...helmet, ShaderFlag.SPECULAR_MAPS_SHARED];

    expect(fit(shared, 16)).toEqual(shared);
    expect(fit(helmet, 16)).not.toContain(ShaderFlag.SPECULAR_COLOR_MAP);
  });

  it("dropping the specular group takes its sharing flag along", () => {
    const flags = [
      ...pbrBase,
      ShaderFlag.MATERIAL_SPECULAR,
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.SPECULAR_COLOR_MAP,
      ShaderFlag.SPECULAR_MAPS_SHARED,
    ];

    expect(dropNextExtensionMapGroup(flags)).toEqual([...pbrBase, ShaderFlag.MATERIAL_SPECULAR]);
  });
});

describe("the budget check on the real GLSL 100 Standard program (H03)", () => {
  const registry = new ShaderRegistry();
  CoreShaderChunks.init(registry);
  const definition = new StandardMaterial().getShaderDefinition();
  registry.register(definition);

  const fit = (flags: string[], maxUnits: number): string[] => {
    const gl = {
      MAX_TEXTURE_IMAGE_UNITS: 0x8872,
      getParameter: () => maxUnits,
    } as unknown as WebGLRenderingContext;
    const cache = new WebGLProgramCache(gl, registry, { dialect: "glsl100" }) as unknown as {
      _fitTextureUnits: (def: unknown, id: string, instanced: boolean, f: string[]) => string[];
    };
    return cache._fitTextureUnits(definition, definition.id, false, flags);
  };

  afterEach(() => vi.restoreAllMocks());

  it("an 8-unit WebGL1 device drops extension maps instead of throwing at link time", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flags = [
      ShaderFlag.NORMAL_MAP,
      ShaderFlag.METALLIC_MAP,
      ShaderFlag.ROUGHNESS_MAP,
      ShaderFlag.AO_MAP,
      ShaderFlag.EMISSIVE_MAP,
      ShaderFlag.MATERIAL_SPECULAR,
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.SPECULAR_COLOR_MAP,
      ShaderFlag.ANISOTROPY,
      ShaderFlag.ANISOTROPY_MAP,
    ];

    const tight = fit(flags, 8);
    const roomy = fit(flags, 32);

    expect(roomy).toEqual(flags);
    expect(tight.length).toBeLessThan(flags.length);
    expect(tight).toContain(ShaderFlag.NORMAL_MAP);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("the scene BRDF LUT is the first thing to go: dropped silently, analytic fit takes over", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = [
      ShaderFlag.NORMAL_MAP,
      ShaderFlag.METALLIC_MAP,
      ShaderFlag.ROUGHNESS_MAP,
      ShaderFlag.AO_MAP,
      ShaderFlag.EMISSIVE_MAP,
    ];
    const withLut = [...base, ShaderFlag.BRDF_LUT];

    const count = (flags: string[]): number => {
      const defines = flags.map((flag) => `#define ${flag} 1\n`).join("");
      return countMaterialSamplers(
        defines + registry.assemble(definition.sources.glsl100!.fs, "glsl100"),
      );
    };
    const need = count(base);
    expect(count(withLut)).toBe(need + 1); // the LUT really costs exactly one unit

    // the LUT is the only droppable group here; core maps are never dropped
    expect(fit(withLut, need + 1)).toEqual(withLut); // one spare unit: LUT stays
    expect(fit(withLut, need)).toEqual(base); // exactly full: LUT (and only it) goes
    expect(warn).not.toHaveBeenCalled(); // quality upgrade, not a lost material feature
  });
});
