import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ShaderFlag } from "../../../src/enums/index.js";
import { StandardMaterial } from "../../../src/core/materials/surface/StandardMaterial.js";
import { Texture } from "../../../src/core/textures/index.js";

const SRC = join(__dirname, "../../../src");
const read = (relative: string): string => readFileSync(join(SRC, relative), "utf8");

// WebGL2 hands out texture units 0..10 to every non-reserved sampler; 11..15 belong to the renderer (spot
// shadows, directional shadow + raw depth, cluster grid + indices) and the linker rejects a program that needs
// more than MAX_TEXTURE_IMAGE_UNITS (16). See WebGLProgramCache._RESERVED_GLOBAL_UNIT_START and ADR 0055.
const FREE_UNITS = 11;
const RESERVED_SAMPLERS = new Set([
  "u_dirShadowMap",
  "u_dirShadowMapRaw",
  "u_spotShadowMap",
  "u_clusterGrid",
  "u_clusterIndices",
]);

/** Evaluates `#ifdef` / `#ifndef` / `#if defined(..)` / `#else` / `#endif` for a define set (enough for sampler gates). */
function activeLines(source: string, defined: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const stack: { active: boolean; taken: boolean; parent: boolean }[] = [];
  const isActive = (): boolean => stack.every((frame) => frame.active);
  const evaluate = (expression: string): boolean =>
    Function(
      "defined",
      `return (${expression.replace(/defined\(\s*(\w+)\s*\)/g, 'defined("$1")')});`,
    )((name: string) => defined.has(name)) as boolean;

  for (const line of source.split("\n")) {
    const directive = /^\s*#\s*(ifdef|ifndef|if|else|endif)\b\s*(.*)$/.exec(line);
    if (!directive) {
      if (isActive()) out.push(line);
      continue;
    }
    const [, kind, rest] = directive as unknown as [string, string, string];
    const parent = isActive();
    if (kind === "ifdef" || kind === "ifndef" || kind === "if") {
      const value =
        kind === "ifdef"
          ? defined.has(rest.trim())
          : kind === "ifndef"
            ? !defined.has(rest.trim())
            : evaluate(rest.trim());
      stack.push({ active: value, taken: value, parent });
    } else if (kind === "else") {
      const frame = stack[stack.length - 1]!;
      frame.active = !frame.taken;
      frame.taken = true;
    } else {
      stack.pop();
    }
  }
  return out;
}

/** Non-reserved samplers a GL2 Standard program declares for a flag set (header + material + light chunks). */
function declaredSamplers(flags: readonly string[]): string[] {
  const defined = new Set(flags);
  const source = [
    read("renderers/shaders/source/web_gl2/chunks/base_fragment_header.frag.glsl"),
    read("core/materials/surface/shaders/Standard.frag.glsl"),
    read("renderers/shaders/source/web_gl2/chunks/lights.frag.glsl"),
  ].join("\n");
  const names: string[] = [];
  for (const line of activeLines(source, defined)) {
    const match = /^\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?[iu]?sampler\w+\s+(\w+)\s*;/.exec(
      line,
    );
    if (match && !RESERVED_SAMPLERS.has(match[1]!)) names.push(match[1]!);
  }
  return names;
}

const pbrBase = [
  ShaderFlag.NORMAL_MAP,
  ShaderFlag.METALLIC_MAP,
  ShaderFlag.ROUGHNESS_MAP,
  ShaderFlag.AO_MAP,
  ShaderFlag.EMISSIVE_MAP,
  "USE_IBL",
];

describe("WebGL2 sampler budget (11 free texture units)", () => {
  it("counts a glTF PBR material (diffuse, normal, M+R, AO, emissive, 3 IBL) at 9 samplers, 8 with the shared MR sampler", () => {
    expect(declaredSamplers(pbrBase)).toHaveLength(9);
    expect(declaredSamplers([...pbrBase, ShaderFlag.METALLIC_ROUGHNESS_SHARED])).toHaveLength(8);
  });

  it("adds exactly one sampler for the EVSM shadow variant", () => {
    expect(declaredSamplers([...pbrBase, "USE_EVSM"])).toHaveLength(10);
  });

  it("reads roughness through the metallic sampler when they are shared and declares no roughness sampler", () => {
    const shared = declaredSamplers([...pbrBase, ShaderFlag.METALLIC_ROUGHNESS_SHARED]);

    expect(shared).toContain("u_metallicMap");
    expect(shared).not.toContain("u_roughnessMap");
  });

  it("fits the helmet-class material plus anisotropy and shared iridescence textures", () => {
    const flags = [
      ...pbrBase,
      ShaderFlag.METALLIC_ROUGHNESS_SHARED,
      "USE_EVSM",
      ShaderFlag.ANISOTROPY,
      ShaderFlag.ANISOTROPY_MAP,
      ShaderFlag.IRIDESCENCE,
      ShaderFlag.IRIDESCENCE_MAP,
      ShaderFlag.IRIDESCENCE_THICKNESS_MAP,
      ShaderFlag.IRIDESCENCE_MAPS_SHARED,
    ];

    expect(declaredSamplers(flags).length).toBeLessThanOrEqual(FREE_UNITS);
  });

  it("fits a helmet-class material with EVSM and both specular maps exactly (ADR 0054 on WebGL2)", () => {
    const flags = [
      ...pbrBase,
      ShaderFlag.METALLIC_ROUGHNESS_SHARED,
      "USE_EVSM",
      ShaderFlag.MATERIAL_SPECULAR,
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.SPECULAR_COLOR_MAP,
    ];

    expect(declaredSamplers(flags)).toHaveLength(FREE_UNITS);
    expect(
      declaredSamplers(flags.filter((f) => f !== ShaderFlag.METALLIC_ROUGHNESS_SHARED)),
    ).toHaveLength(FREE_UNITS + 1);
  });

  it("documents the worst case that does NOT fit (specular maps and separate iridescence textures on top)", () => {
    const flags = [
      ...pbrBase,
      ShaderFlag.METALLIC_ROUGHNESS_SHARED,
      "USE_EVSM",
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.SPECULAR_COLOR_MAP,
      ShaderFlag.MATERIAL_SPECULAR,
      ShaderFlag.IRIDESCENCE,
      ShaderFlag.IRIDESCENCE_MAP,
      ShaderFlag.IRIDESCENCE_THICKNESS_MAP,
    ];

    expect(declaredSamplers(flags).length).toBeGreaterThan(FREE_UNITS);
  });

  it("declares the anisotropy and iridescence samplers only behind their own flags", () => {
    const none = declaredSamplers(pbrBase);
    const all = declaredSamplers([
      ...pbrBase,
      ShaderFlag.ANISOTROPY,
      ShaderFlag.ANISOTROPY_MAP,
      ShaderFlag.IRIDESCENCE,
      ShaderFlag.IRIDESCENCE_MAP,
      ShaderFlag.IRIDESCENCE_THICKNESS_MAP,
    ]);

    for (const name of ["u_anisotropyMap", "u_iridescenceMap", "u_iridescenceThicknessMap"]) {
      expect(none).not.toContain(name);
      expect(all).toContain(name);
    }
  });

  it("a map without its feature flag declares nothing (the map flags sit inside the feature gates)", () => {
    expect(declaredSamplers([ShaderFlag.ANISOTROPY_MAP])).not.toContain("u_anisotropyMap");
    expect(declaredSamplers([ShaderFlag.IRIDESCENCE_MAP])).not.toContain("u_iridescenceMap");
  });
});

describe("Still-WebGL2-only extension maps stay out of WebGPU (ADR 0055 follow-up)", () => {
  const webGl2OnlyMaps = ["u_anisotropyMap", "u_iridescenceMap", "u_iridescenceThicknessMap"];

  it.each(webGl2OnlyMaps)(
    "%s is neither in the WebGPU binding table nor in the WGSL structs",
    (name) => {
      expect(read("renderers/WebGPU/managers/GPUPipelineCache.ts")).not.toContain(name);
      expect(read("renderers/shaders/source/web_gpu/chunks/structs.wgsl")).not.toContain(name);
    },
  );

  it.each(webGl2OnlyMaps)("%s is not sampled by the WGSL or WebGL1 chunks", (name) => {
    expect(read("renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl")).not.toContain(name);
    expect(read("renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl")).not.toContain(
      name,
    );
  });
});

describe("ADR 0054 revisit: ported maps reach WebGPU flag-gated (clearcoat/sheen/transmission/specular)", () => {
  // name -> the compile flag that must gate its declaration in `structs.wgsl`.
  const portedMaps: Record<string, string> = {
    u_clearcoatMap: "USE_CLEARCOAT_MAP",
    u_clearcoatRoughnessMap: "USE_CLEARCOAT_ROUGHNESS_MAP",
    u_clearcoatNormalMap: "USE_CLEARCOAT_NORMAL_MAP",
    u_sheenColorMap: "USE_SHEEN_COLOR_MAP",
    u_sheenRoughnessMap: "USE_SHEEN_ROUGHNESS_MAP",
    u_transmissionMap: "USE_TRANSMISSION_MAP",
    u_thicknessMap: "USE_THICKNESS_MAP",
    u_specularWeightMap: "USE_SPECULAR_WEIGHT_MAP",
    u_specularColorMap: "USE_SPECULAR_COLOR_MAP",
  };

  it.each(Object.entries(portedMaps))(
    "%s is declared only behind its own flag gate",
    (name, flag) => {
      const lines = read("renderers/shaders/source/web_gpu/chunks/structs.wgsl").split("\n");
      const decl = lines.findIndex((line) => line.includes(`var ${name}:`));
      expect(decl).toBeGreaterThan(-1);
      const before = lines.slice(0, decl).join("\n");
      expect(before).toContain(`#ifdef ${flag}`);
      // The enclosing gate is still open at the declaration (more openings than closings).
      const opens = (before.match(/#ifdef |#ifndef /g) || []).length;
      const closes = (before.match(/#endif/g) || []).length;
      expect(opens).toBeGreaterThan(closes);
    },
  );

  // WebGL1 implements the transmission path too (E-M13 lifted), so these two maps ARE sampled by
  // the WebGL1 chunk -- but only behind their own compile-flag gates (same discipline as the
  // structs.wgsl gate test above).
  const webGl1PortedMaps: Record<string, string> = {
    u_transmissionMap: "USE_TRANSMISSION_MAP",
    u_thicknessMap: "USE_THICKNESS_MAP",
  };

  it.each(Object.entries(webGl1PortedMaps))(
    "%s is sampled by the WebGL1 chunk only behind its flag gate",
    (name, flag) => {
      const chunk = read("renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl");
      const activeWith = activeLines(chunk, new Set(["USE_TRANSMISSION", flag])).join("\n");
      const activeWithout = activeLines(chunk, new Set(["USE_TRANSMISSION"])).join("\n");
      expect(activeWith).toContain(name);
      expect(activeWithout).not.toContain(name);
    },
  );

  it.each(Object.keys(portedMaps).filter((name) => !(name in webGl1PortedMaps)))(
    "%s is not sampled by the WebGL1 chunk",
    (name) => {
      expect(
        read("renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl"),
      ).not.toContain(name);
    },
  );
});

describe("StandardMaterial texture sharing flags", () => {
  const texture = (): Texture => Texture.fromImage({} as ImageBitmap);

  it("shares the metallic/roughness sampler only for the identical texture object", () => {
    const packed = texture();

    expect(
      new StandardMaterial({ metallicMap: packed, roughnessMap: packed }).getRenderManifest().flags,
    ).toContain(ShaderFlag.METALLIC_ROUGHNESS_SHARED);
    expect(
      new StandardMaterial({ metallicMap: texture(), roughnessMap: texture() }).getRenderManifest()
        .flags,
    ).not.toContain(ShaderFlag.METALLIC_ROUGHNESS_SHARED);
    expect(new StandardMaterial({ metallicMap: packed }).getRenderManifest().flags).not.toContain(
      ShaderFlag.METALLIC_ROUGHNESS_SHARED,
    );
  });

  it("flags anisotropy and iridescence maps only together with their feature", () => {
    const map = texture();
    const off = new StandardMaterial({
      anisotropyMap: map,
      iridescenceMap: map,
    }).getRenderManifest().flags;
    const on = new StandardMaterial({
      anisotropyStrength: 1,
      anisotropyMap: map,
      iridescenceFactor: 1,
      iridescenceMap: map,
      iridescenceThicknessMap: map,
    }).getRenderManifest();

    expect(off).not.toContain(ShaderFlag.ANISOTROPY_MAP);
    expect(off).not.toContain(ShaderFlag.IRIDESCENCE_MAP);
    expect(on.flags).toEqual(
      expect.arrayContaining([
        ShaderFlag.ANISOTROPY_MAP,
        ShaderFlag.IRIDESCENCE_MAP,
        ShaderFlag.IRIDESCENCE_THICKNESS_MAP,
        ShaderFlag.IRIDESCENCE_MAPS_SHARED,
      ]),
    );
    expect(on.textures["u_anisotropyMap"]).toBe(map);
    expect(on.textures["u_iridescenceMap"]).toBe(map);
    expect(on.textures["u_iridescenceThicknessMap"]).toBe(map);
  });

  it("shares one sampler for packed specular textures and keeps two for different textures", () => {
    const map = texture();
    const packed = new StandardMaterial({
      specularMap: map,
      specularColorMap: map,
    }).getRenderManifest();
    const separate = new StandardMaterial({
      specularMap: texture(),
      specularColorMap: texture(),
    }).getRenderManifest().flags;

    expect(packed.flags).toContain(ShaderFlag.SPECULAR_MAPS_SHARED);
    expect(packed.textures["u_specularWeightMap"]).toBe(map);
    expect(packed.textures["u_specularColorMap"]).toBe(map);
    expect(separate).not.toContain(ShaderFlag.SPECULAR_MAPS_SHARED);

    const base = [
      ...pbrBase,
      ShaderFlag.MATERIAL_SPECULAR,
      ShaderFlag.SPECULAR_WEIGHT_MAP,
      ShaderFlag.SPECULAR_COLOR_MAP,
    ];
    const unshared = declaredSamplers(base);
    const shared = declaredSamplers([...base, ShaderFlag.SPECULAR_MAPS_SHARED]);

    expect(shared).toContain("u_specularColorMap");
    expect(shared).not.toContain("u_specularWeightMap");
    expect(shared.length).toBe(unshared.length - 1);
  });

  it("does not share the iridescence samplers for two different textures", () => {
    const flags = new StandardMaterial({
      iridescenceFactor: 1,
      iridescenceMap: texture(),
      iridescenceThicknessMap: texture(),
    }).getRenderManifest().flags;

    expect(flags).toContain(ShaderFlag.IRIDESCENCE_THICKNESS_MAP);
    expect(flags).not.toContain(ShaderFlag.IRIDESCENCE_MAPS_SHARED);
  });
});
