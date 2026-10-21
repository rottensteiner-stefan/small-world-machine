import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { CoreShaderChunks } from "../../../src/renderers/shaders/CoreShaderChunks.js";
import { ShaderRegistry } from "../../../src/renderers/shaders/ShaderRegistry.js";

const SRC_DIR = join(__dirname, "../../../src");
const GLASS_DIR = join(SRC_DIR, "core/materials/glass/shaders");
// glsl100 and glsl300 share ONE loop body; each dialect supplies GLASS_* accessor macros next to its
// light uniforms (LIGHT_DEFS).
const CHUNK_GLSL = join(SRC_DIR, "renderers/shaders/source/shared/glass_pbr_loops.frag.glsl");
const LIGHT_DEFS_GL1 = join(SRC_DIR, "renderers/shaders/source/web_gl1/chunks/lights.frag.glsl");
const LIGHT_DEFS_GL2 = join(SRC_DIR, "renderers/shaders/source/web_gl2/chunks/lights.frag.glsl");
const CHUNK_WGSL = join(SRC_DIR, "renderers/shaders/source/web_gpu/chunks/glass_pbr_loops.wgsl");

// Wave-2 Package C Task 3 (ADR 0039): the Glass/Frostglass PBR lighting loop was consolidated from
// six byte-identical in-material copies into one shared GLASS_PBR_LOOPS chunk per dialect (glsl100 /
// glsl300 / wgsl). These tests pin the consolidation's source invariants so a shader edit cannot
// silently detach one backend or re-inline a private loop into a material again:
//   * the chunk is registered for ALL THREE dialects (none dropped),
//   * the trio stays semantically parallel (same BRDF terms/constants, same light-type coverage),
//   * the chunks carry NO permanent #ifdef branching (liquid/ADR-0013 doctrine),
//   * Glass AND Frostglass reference the shared chunk only -- no private loop copy survives,
//   * the one deliberate cross-dialect divergence (WebGPU spot distance-attenuation select()) is
//     covered by an explicit assertion instead of being silently normalized.

const registry = new ShaderRegistry();

describe("GLASS_PBR_LOOPS chunk registration (all dialects)", () => {
  beforeAll(async () => {
    await CoreShaderChunks.init(registry);
  });

  it("registers GLASS_PBR_LOOPS for glsl300 and glsl100", () => {
    for (const lang of ["glsl300", "glsl100"] as const) {
      const chunk = registry.getChunk("GLASS_PBR_LOOPS", lang);
      expect(chunk, `GLASS_PBR_LOOPS registered for ${lang}`).toBeDefined();
      expect(chunk!.length, `GLASS_PBR_LOOPS non-empty for ${lang}`).toBeGreaterThan(0);
    }
  });

  it("registers WGSL_GLASS_PBR_LOOPS for wgsl", () => {
    const chunk = registry.getChunk("WGSL_GLASS_PBR_LOOPS", "wgsl");
    expect(chunk).toBeDefined();
    expect(chunk!.length).toBeGreaterThan(0);
  });
});

describe("GLASS_PBR_LOOPS trio structural parity (glsl100 <-> glsl300 <-> wgsl)", () => {
  const gl1 = readFileSync(CHUNK_GLSL, "utf8");
  const gl2 = gl1; // one body for both GLSL dialects
  const wgsl = readFileSync(CHUNK_WGSL, "utf8");

  it("shares the same BRDF math terms in every dialect", () => {
    for (const term of [
      "D_GGX(",
      "G_SchlickGGX(",
      "F_Schlick(",
      "(1.0 - metallic)",
      "4.0 * dotNV * dotNL",
    ]) {
      expect(gl1, `glsl100 term ${term}`).toContain(term);
      expect(gl2, `glsl300 term ${term}`).toContain(term);
      expect(wgsl, `wgsl term ${term}`).toContain(term);
    }
  });

  it("keeps the Cook-Torrance constants identical across dialects", () => {
    for (const lit of ["3.14159265359", "0.0001"]) {
      expect(gl1, `glsl100 literal ${lit}`).toContain(lit);
      expect(gl2, `glsl300 literal ${lit}`).toContain(lit);
      expect(wgsl, `wgsl literal ${lit}`).toContain(lit);
    }
  });

  it("keeps the spot-light distance-falloff law byte-identical across dialects", () => {
    // The spot decay is the same analytic law in every dialect; only the WebGPU activation guard
    // differs (covered by the dedicated divergence assertion below).
    const falloff = "pow(clamp(1.0 - dist / maxDist, 0.0, 1.0), decay)";
    expect(gl1).toContain(falloff);
    expect(gl2).toContain(falloff);
    expect(wgsl).toContain(falloff);
  });

  it("covers exactly the same three light types (directional, point, spot) in every dialect", () => {
    const markers = (source: string): string[] => {
      const found: string[] = [];
      for (const m of source.matchAll(
        /\/\/ --- (?:Directional Light|Point Lights|Spot Lights) ---/g,
      )) {
        found.push(m[0]!);
      }
      return found;
    };
    const wgslMarkers = (source: string): string[] => {
      const found: string[] = [];
      for (const m of source.matchAll(/\/\/ (?:Directional Light|Point Lights|Spot Lights)/g)) {
        found.push(m[0]!);
      }
      return found;
    };
    expect(markers(gl1).sort()).toEqual(
      ["// --- Directional Light ---", "// --- Point Lights ---", "// --- Spot Lights ---"].sort(),
    );
    expect(markers(gl2).sort()).toEqual(
      ["// --- Directional Light ---", "// --- Point Lights ---", "// --- Spot Lights ---"].sort(),
    );
    expect(wgslMarkers(wgsl).sort()).toEqual(
      ["// Directional Light", "// Point Lights", "// Spot Lights"].sort(),
    );
  });

  it("accumulates into Lo exactly once per light type in every dialect", () => {
    const loCount = (source: string): number => source.split("Lo +=").length - 1;
    expect(loCount(gl1)).toBe(3);
    expect(loCount(gl2)).toBe(3);
    expect(loCount(wgsl)).toBe(3);
  });

  it("carries no permanent #ifdef branching in the shared chunk (ADR-0013/liquid doctrine)", () => {
    expect(gl1).not.toContain("#ifdef");
    expect(gl2).not.toContain("#ifdef");
    expect(wgsl).not.toContain("#ifdef");
  });

  it("documents the deliberate WebGPU spot distance-attenuation divergence instead of hiding it", () => {
    // The WebGPU path keeps the pre-consolidation behaviour: when maxDist == 0 it falls back to
    // the analytic 1/(d^2) point-light falloff via select(), while the GLSL dialects guard the
    // spot block with an explicit range check. The assertion pins BOTH sides so no backend can
    // silently drift to the other branch.
    expect(wgsl).toContain("select(1.0 / (dist * dist + 0.0001)");
    expect(wgsl).toContain("maxDist > 0.0");
    expect(gl1).toContain("if (intensity > 0.0 && dist < maxDist)");
    expect(gl2).toContain("if (intensity > 0.0 && dist < maxDist)");
  });
});

describe("GLASS_PBR_LOOPS accessor macros (shared glsl100/glsl300 body)", () => {
  const MACROS = [
    "GLASS_POINT_POS",
    "GLASS_POINT_COLOR",
    "GLASS_POINT_RANGE",
    "GLASS_POINT_DECAY",
    "GLASS_SPOT_POS",
    "GLASS_SPOT_DIR",
    "GLASS_SPOT_COLOR",
    "GLASS_SPOT_PARAMS",
  ];
  const body = readFileSync(CHUNK_GLSL, "utf8");

  it("defines every accessor the shared loop uses in BOTH dialect light headers", () => {
    for (const [name, file] of [
      ["glsl100", LIGHT_DEFS_GL1],
      ["glsl300", LIGHT_DEFS_GL2],
    ] as const) {
      const defs = readFileSync(file, "utf8");
      for (const macro of MACROS) {
        expect(defs, `${name} defines ${macro}`).toMatch(new RegExp(`#define ${macro}\\(i\\) `));
      }
    }
  });

  it("reads lights only through the accessors (no dialect-specific uniform names in the body)", () => {
    expect(body).not.toMatch(/u_pointLight|u_spotLight|u_pointLights\[|u_spotLights\[/);
    for (const macro of MACROS) expect(body, `${macro} is used`).toContain(macro + "(i)");
  });

  it("covers all 16 clustered-capable lights per type and uses the surface range/decay window", () => {
    expect(body.match(/for\(int i = 0; i < 16; i\+\+\)/g)).toHaveLength(2);
    expect(body).toContain("GLASS_POINT_RANGE(i)");
    expect(body).toContain("pWindow * pWindow");
  });
});

describe("Glass/Frostglass source invariant (no private PBR loop copy)", () => {
  const sources: Array<{ name: string; file: string; placeholder: string; marker: string }> = [
    {
      name: "Glass.frag.glsl",
      file: join(GLASS_DIR, "Glass.frag.glsl"),
      placeholder: "[GLASS_PBR_LOOPS]",
      marker: "// --- Directional Light ---",
    },
    {
      name: "Glass.frag.glsl100",
      file: join(GLASS_DIR, "Glass.frag.glsl100"),
      placeholder: "[GLASS_PBR_LOOPS]",
      marker: "// --- Directional Light ---",
    },
    {
      name: "Glass.frag.wgsl",
      file: join(GLASS_DIR, "Glass.frag.wgsl"),
      placeholder: "[WGSL_GLASS_PBR_LOOPS]",
      marker: "// Directional Light",
    },
    {
      name: "Frostglass.frag.glsl",
      file: join(GLASS_DIR, "Frostglass.frag.glsl"),
      placeholder: "[GLASS_PBR_LOOPS]",
      marker: "// --- Directional Light ---",
    },
    {
      name: "Frostglass.frag.glsl100",
      file: join(GLASS_DIR, "Frostglass.frag.glsl100"),
      placeholder: "[GLASS_PBR_LOOPS]",
      marker: "// --- Directional Light ---",
    },
    {
      name: "Frostglass.frag.wgsl",
      file: join(GLASS_DIR, "Frostglass.frag.wgsl"),
      placeholder: "[WGSL_GLASS_PBR_LOOPS]",
      marker: "// Directional Light",
    },
  ];

  it("keeps the PBR loop ONLY as the shared chunk reference", () => {
    for (const src of sources) {
      const text = readFileSync(src.file, "utf8");
      expect(text, `${src.name} references ${src.placeholder}`).toContain(src.placeholder);
      expect(text, `${src.name} has no re-inlined loop body (marker gone)`).not.toContain(
        src.marker,
      );
    }
  });

  it("keeps all BRDF math in the shared chunks (no D_GGX calls embedded in the material)", () => {
    for (const src of sources) {
      const text = readFileSync(src.file, "utf8");
      expect(text, `${src.name} has no embedded BRDF math call`).not.toContain("D_GGX(");
    }
  });
});
