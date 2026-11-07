import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  countMaterialFragmentTextures,
  dropNextWebGpuExtensionMapGroup,
  getMaterialTextureBindingNames,
} from "../../src/renderers/WebGPU/managers/GPUPipelineCache.js";
import { ShaderRegistry, preprocessConditionals } from "../../src/renderers/shaders/index.js";
import { StandardMaterial } from "../../src/core/materials/surface/StandardMaterial.js";
import { ShaderPropertyType, ShaderFlag } from "../../src/enums/index.js";
import { Texture } from "../../src/core/textures/index.js";
import { Color } from "../../src/core/colors/index.js";

(globalThis as unknown as { GPUShaderStage: Record<string, number> }).GPUShaderStage ??= {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
};

const SRC = join(__dirname, "../../src");
const read = (relative: string): string => readFileSync(join(SRC, relative), "utf8");

const fake = (): ImageBitmap => ({}) as ImageBitmap;

/** Registers the real Standard layout (incl. every extension map) under id "standard". */
function standardRegistry(): ShaderRegistry {
  const registry = new ShaderRegistry();
  registry.register({
    id: "standard",
    sources: {},
    layout: new StandardMaterial().getShaderDefinition().layout,
  });
  return registry;
}

/** A bare layout declaring exactly the given texture names (all without flags). */
function registryWithNames(...names: string[]): ShaderRegistry {
  const registry = new ShaderRegistry();
  registry.register({
    id: "custom",
    sources: {},
    layout: {
      uniforms: {},
      textures: Object.fromEntries(
        names.map((name) => [name, { type: ShaderPropertyType.TEXTURE }]),
      ),
    },
  });
  return registry;
}

describe("WebGPU extension-map binding names (ADR 0054 revisit)", () => {
  it("keeps binding declared legacy textures with no flag requirement", () => {
    const registry = registryWithNames("u_diffuseMap", "u_metallicMap", "u_aoMap");
    const names = getMaterialTextureBindingNames("custom", registry, []);
    // Legacy "declared => bound" contract survives the per-flag restructure unchanged.
    expect(names).toEqual(["u_diffuseMap", "u_metallicMap", "u_aoMap"]);
  });

  it("binds flag-gated extension maps only under their own compile flag", () => {
    const registry = standardRegistry();
    expect(getMaterialTextureBindingNames("standard", registry, [])).not.toContain(
      "u_clearcoatMap",
    );

    const names = getMaterialTextureBindingNames("standard", registry, [
      ShaderFlag.CLEARCOAT_MAP,
      ShaderFlag.SHEEN_COLOR_MAP,
    ]);
    expect(names).toContain("u_clearcoatMap");
    expect(names).toContain("u_sheenColorMap");
    // Only the activated feature groups are bound, never the whole extension table.
    expect(names).not.toContain("u_transmissionMap");
    expect(names).not.toContain("u_clearcoatNormalMap");
  });

  it("drops the specular weight binding in the shared layout (one unit, not two)", () => {
    const registry = standardRegistry();
    const separate = getMaterialTextureBindingNames("standard", registry, [
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.SPECULAR_COLOR_MAP,
    ]);
    expect(separate).toContain("u_specularWeightMap");
    expect(separate).toContain("u_specularColorMap");

    const shared = getMaterialTextureBindingNames("standard", registry, [
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.SPECULAR_COLOR_MAP,
      ShaderFlag.SPECULAR_MAPS_SHARED,
    ]);
    expect(shared).not.toContain("u_specularWeightMap");
    expect(shared).toContain("u_specularColorMap");
    // The shared flag must not bind anything of its own -- the sampler saving is implicit.
    expect(shared.filter((name) => name.startsWith("u_specular"))).toEqual(["u_specularColorMap"]);
  });

  it("counts exactly the always-bound textures plus the flag-active optional bindings", () => {
    const registry = standardRegistry();
    const base = countMaterialFragmentTextures("standard", registry, []);
    // 3 always-bound (normal 3, env cube 11, emissive 12) + the 7 legacy Standard maps.
    expect(base).toBe(10);

    const withTransmission = countMaterialFragmentTextures("standard", registry, [
      ShaderFlag.TRANSMISSION_MAP,
      ShaderFlag.THICKNESS_MAP,
    ]);
    expect(withTransmission).toBe(base + 2);
  });
});

describe("WebGPU budget fit drop order (ADR 0054 revisit, mirrors WebGL2 ADR 0056)", () => {
  it("drops specular first, then sheen, then clearcoat, then transmission", () => {
    let flags: readonly string[] = [
      ShaderFlag.TRANSMISSION_MAP,
      ShaderFlag.THICKNESS_MAP,
      ShaderFlag.CLEARCOAT_MAP,
      ShaderFlag.SHEEN_COLOR_MAP,
      ShaderFlag.SHEEN_ROUGHNESS_MAP,
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.SPECULAR_COLOR_MAP,
    ];
    const dropped: string[][] = [];
    let next = dropNextWebGpuExtensionMapGroup(flags);
    while (next) {
      const group: string[] = next;
      dropped.push(flags.filter((flag) => !group.includes(flag)));
      flags = group;
      next = dropNextWebGpuExtensionMapGroup(flags);
    }

    expect(dropped).toEqual([
      [ShaderFlag.SPECULAR_WEIGHT_MAP, ShaderFlag.SPECULAR_COLOR_MAP],
      [ShaderFlag.SHEEN_COLOR_MAP, ShaderFlag.SHEEN_ROUGHNESS_MAP],
      [ShaderFlag.CLEARCOAT_MAP],
      [ShaderFlag.TRANSMISSION_MAP, ShaderFlag.THICKNESS_MAP],
    ]);
    expect(flags).toEqual([]);
  });

  it("drops nothing when no extension-map group is present", () => {
    expect(dropNextWebGpuExtensionMapGroup([ShaderFlag.NORMAL_MAP])).toBeUndefined();
    expect(dropNextWebGpuExtensionMapGroup([])).toBeUndefined();
  });

  it("leaves core material flags untouched while dropping an extension group", () => {
    const flags = [ShaderFlag.NORMAL_MAP, ShaderFlag.SPECULAR_COLOR_MAP, ShaderFlag.AO_MAP];
    const next = dropNextWebGpuExtensionMapGroup(flags)!;
    expect(next).toContain(ShaderFlag.NORMAL_MAP);
    expect(next).toContain(ShaderFlag.AO_MAP);
    expect(next).not.toContain(ShaderFlag.SPECULAR_COLOR_MAP);
  });
});

describe("preprocessed Standard WGSL assembly (no GPU needed)", () => {
  const FULL = [
    ShaderFlag.CLEARCOAT_MAP,
    ShaderFlag.CLEARCOAT_ROUGHNESS_MAP,
    ShaderFlag.CLEARCOAT_NORMAL_MAP,
    ShaderFlag.SHEEN_COLOR_MAP,
    ShaderFlag.SHEEN_ROUGHNESS_MAP,
    // The transmission/thickness maps are only read inside the USE_TRANSMISSION block of the PBR
    // chunk; StandardMaterial always sets TRANSMISSION alongside them (transmission > 0 || map).
    ShaderFlag.TRANSMISSION,
    ShaderFlag.TRANSMISSION_MAP,
    ShaderFlag.THICKNESS_MAP,
    ShaderFlag.SPECULAR_WEIGHT_MAP,
    ShaderFlag.SPECULAR_COLOR_MAP,
  ];
  const standardWgsl = (flags: readonly string[]): string =>
    preprocessConditionals(
      [
        read("renderers/shaders/source/web_gpu/chunks/structs.wgsl"),
        read("renderers/shaders/source/web_gpu/chunks/pbr_math.wgsl"),
        read("renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl"),
        read("core/materials/surface/shaders/Standard.frag.wgsl"),
      ].join("\n"),
      flags,
    );

  it("a feature-less Standard carries none of the 9 extension declarations or samples", () => {
    const source = standardWgsl([]);
    expect(source).not.toMatch(/^\s*#/m); // every directive branch stripped, none left behind
    for (const name of [21, 22, 23, 24, 25, 26, 27, 28, 29]) {
      expect(source).not.toContain(`@binding(${name})`);
    }
    expect(source).not.toContain("u_clearcoatMap");
    expect(source).not.toContain("u_transmissionMap");
  });

  it("all four groups assembled leaves no directive line and keeps every sample", () => {
    const source = standardWgsl(FULL);
    expect(source).not.toMatch(/^\s*#/m);
    expect(source).toContain("@binding(21) var u_clearcoatMap");
    expect(source).toContain("@binding(24) var u_sheenColorMap");
    expect(source).toContain("@binding(26) var u_transmissionMap");
    expect(source).toContain("@binding(28) var u_specularWeightMap");
    expect(source).toContain("@binding(29) var u_specularColorMap");
    expect(source).toContain("textureSample(u_clearcoatMap, s, i.uv).r");
    expect(source).toContain("textureSample(u_sheenRoughnessMap, s, i.uv).a");
    expect(source).toContain("textureSample(u_thicknessMap, s, i.uv).g");
    // The clearcoat lobe runs off its own N_cc (only reachable with the normal map).
    expect(source).toContain("let N_cc = normalize(TBN * rawCcNormal);");
    expect(source).toContain("let R_cc = reflect(-V, N_cc);");
  });

  it("the shared specular layout drops the weight binding and reads the alpha of the colour map", () => {
    const shared = standardWgsl([
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.SPECULAR_COLOR_MAP,
      ShaderFlag.SPECULAR_MAPS_SHARED,
    ]);
    expect(shared).toContain("@binding(29) var u_specularColorMap");
    expect(shared).not.toContain("@binding(28)");
    expect(shared).toContain("textureSample(u_specularColorMap, s, i.uv).a");
    expect(shared).not.toContain("textureSample(u_specularWeightMap");
  });
});

describe("StandardMaterial end-to-end flags (ADR 0054 revisit)", () => {
  it("pushes the texture flags the per-flag WebGPU layout consumes", () => {
    const material = new StandardMaterial({
      clearcoat: 1,
      clearcoatMap: Texture.fromImage(fake()),
      clearcoatRoughnessMap: Texture.fromImage(fake()),
      clearcoatNormalMap: Texture.fromImage(fake()),
      sheenColor: new Color(1, 1, 1),
      sheenColorMap: Texture.fromImage(fake()),
      transmission: 1,
      transmissionMap: Texture.fromImage(fake()),
      thicknessMap: Texture.fromImage(fake()),
    });
    const manifest = material.getRenderManifest();

    for (const flag of [
      ShaderFlag.CLEARCOAT_MAP,
      ShaderFlag.CLEARCOAT_ROUGHNESS_MAP,
      ShaderFlag.CLEARCOAT_NORMAL_MAP,
      ShaderFlag.SHEEN_COLOR_MAP,
      ShaderFlag.TRANSMISSION_MAP,
      ShaderFlag.THICKNESS_MAP,
    ]) {
      expect(manifest.flags).toContain(flag);
    }
  });
});
