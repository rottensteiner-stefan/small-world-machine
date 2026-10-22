import { beforeAll, describe, expect, it } from "vitest";
import "../../src/index.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { ShaderBootstrap } from "../../src/renderers/shaders/ShaderBootstrap.js";
import { SpriteMaterial } from "../../src/core/materials/SpriteMaterial.js";

const testShaderRegistry = new ShaderRegistry();

/**
 * Guards the sprite fog support on every backend: camera-facing sprites must participate in the
 * scene's distance fog exactly like the lit surfaces do (Sprite.frag.{wgsl,glsl,glsl100}), so an
 * impostor/billboard row never stays razor-sharp while ground and trees recede into the haze.
 * Pure assembly-level checks -- no GPU required in CI.
 */
describe("SpriteMaterial scene fog (all backends)", () => {
  beforeAll(async () => {
    await ShaderBootstrap.init(testShaderRegistry);
  });

  const cases: Array<{ lang: "wgsl" | "glsl300" | "glsl100"; expectFogTokens: string[] }> = [
    {
      lang: "wgsl",
      expectFogTokens: ["fogFactor", "global.fogMode", "global.fogColor", "i.wp", "viewPos"],
    },
    {
      lang: "glsl300",
      expectFogTokens: ["u_fogMode", "u_fogColor", "v_worldPos", "u_viewPos", "fogFactor"],
    },
    {
      lang: "glsl100",
      expectFogTokens: ["u_fogMode", "u_fogColor", "v_worldPos", "u_viewPos", "fogFactor"],
    },
  ];

  for (const { lang, expectFogTokens } of cases) {
    it(`assembles the ${lang} sprite fragment with distance fog wired in`, () => {
      const source = new SpriteMaterial().getShaderDefinition().sources[lang];
      expect(source).toBeDefined();

      const assembled = testShaderRegistry.assemble(
        lang === "wgsl" ? (source as string) : (source as { fs: string }).fs,
        lang,
      );
      // No chunk placeholder may survive substitution (a missing chunk would be left as-is and the
      // shader would fail to compile at runtime).
      expect(assembled).not.toMatch(/\[[A-Z][A-Z0-9_]{2,}\]/);
      for (const token of expectFogTokens) {
        expect(assembled).toContain(token);
      }
    });
  }

  it("reuses the exact scene fog math the lit shaders use (parity guard)", () => {
    const fsGl = testShaderRegistry.assemble(
      new SpriteMaterial().getShaderDefinition().sources.glsl300!.fs,
      "glsl300",
    );
    // [FOG_CALC] is the same shared chunk the lit/PBR fragment shaders embed, so sprites follow the
    // scene's fog mode (linear/exp/exp2) and height falloff rather than a hard-coded fade.
    expect(fsGl).toContain("fogFactor = clamp(fogFactor, 0.0, 1.0);");
  });
});
