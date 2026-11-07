import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ShaderFlag } from "../../../src/enums/index.js";
import { StandardMaterial } from "../../../src/core/materials/surface/StandardMaterial.js";
import { Texture } from "../../../src/core/textures/index.js";

const ENGINE_SRC = join(__dirname, "../../../src");
const REPO_ROOT = join(__dirname, "../../../../..");
const SHADER_EXTENSIONS = [".glsl", ".glsl100", ".wgsl"];

const walk = (root: string): string[] =>
  (readdirSync(root, { recursive: true }) as string[]).map((file) => join(root, file));

const shaderSources: string = walk(ENGINE_SRC)
  .filter((file) => SHADER_EXTENSIONS.some((extension) => file.endsWith(extension)))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

/**
 * Flags the renderers read from `RenderManifest.flags` to pick a vertex stream or pipeline layout; no shader
 * text tests them. Everything else must be a token some shader source actually reads.
 */
const RENDERER_ONLY_FLAGS: readonly string[] = [ShaderFlag.VERTEX_COLOR];

describe("ShaderFlag", () => {
  const entries = Object.entries(ShaderFlag);
  const shaderFlags = entries.filter(([, value]) => !RENDERER_ONLY_FLAGS.includes(value));

  it("keeps the literal USE_* token as every value and never repeats one", () => {
    const values = entries.map(([, value]) => value);

    for (const value of values) expect(value).toMatch(/^USE_[A-Z0-9_]+$/);
    expect(new Set(values).size).toBe(values.length);
  });

  it.each(shaderFlags)(
    "%s: the shader sources reference the token it stands for",
    (_member, value) => {
      expect(shaderSources, `no shader source mentions ${value}`).toContain(value);
    },
  );

  it.each(RENDERER_ONLY_FLAGS)(
    "%s is renderer-only: no shader source reads it (else drop it from the list)",
    (value) => {
      expect(shaderSources).not.toContain(value);
    },
  );

  it("StandardMaterial pushes exactly the flag its feature stands for", () => {
    const map = Texture.fromImage({} as ImageBitmap);
    const material = new StandardMaterial({
      metallicMap: map,
      roughnessMap: map,
      specularMap: map,
      specularColorMap: map,
      anisotropyStrength: 0.5,
      iridescenceFactor: 0.5,
    });

    expect(material.getRenderManifest().flags).toEqual(
      expect.arrayContaining([
        ShaderFlag.METALLIC_MAP,
        ShaderFlag.ROUGHNESS_MAP,
        ShaderFlag.MATERIAL_SPECULAR,
        ShaderFlag.SPECULAR_WEIGHT_MAP,
        ShaderFlag.SPECULAR_COLOR_MAP,
        ShaderFlag.ANISOTROPY,
        ShaderFlag.IRIDESCENCE,
      ]),
    );
  });

  it("a plain StandardMaterial pushes none of the optional-feature flags", () => {
    const flags = new StandardMaterial({}).getRenderManifest().flags;

    expect(flags).toEqual([]);
  });

  it("StandardMaterial with only a metallic map pushes METALLIC_MAP and no other flag", () => {
    const material = new StandardMaterial({ metallicMap: Texture.fromImage({} as ImageBitmap) });

    expect([...(material.getRenderManifest().flags ?? [])]).toEqual([ShaderFlag.METALLIC_MAP]);
  });
});

describe("no magic flag strings", () => {
  const RAW_FLAG = /["']USE_[A-Z0-9_]+["']/;
  const isSource = (file: string): boolean =>
    file.endsWith(".ts") &&
    !file.endsWith(".d.ts") &&
    !file.endsWith("ShaderFlag.ts") &&
    !/[\\/](tests?|node_modules|dist)[\\/]/.test(file);

  it("no engine, package or app source pushes or compares a raw USE_* literal (use ShaderFlag)", () => {
    const offenders = [join(REPO_ROOT, "packages"), join(REPO_ROOT, "apps")]
      .flatMap(walk)
      .filter(isSource)
      .filter((file) => RAW_FLAG.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(REPO_ROOT.length + 1));

    expect(offenders).toEqual([]);
  });
});
