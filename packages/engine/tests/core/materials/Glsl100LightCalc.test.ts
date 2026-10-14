import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "../../../src");

// Source lint (text order check), kept because it guards a real past WebGL1-only compile failure.
/**
 * `finalLight` is declared by the `[LIGHT_CALC]` chunk. A WebGL1 fragment shader that reads it without
 * pulling in the chunk fails to compile on GLSL ES 1.00 ("'finalLight' : undeclared identifier"), which
 * only shows at runtime and only on WebGL1 (Lambert shipped like that until 2026-10-08).
 */
describe("GLSL100 fragment shaders declare finalLight via [LIGHT_CALC]", () => {
  const files = readdirSync(SRC_DIR, { recursive: true, encoding: "utf8" })
    .map((f) => f.split("\\").join("/"))
    .filter((f) => f.endsWith(".frag.glsl100"));

  it("finds the GLSL100 fragment shaders", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const source = readFileSync(join(SRC_DIR, file), "utf8");
    if (!source.includes("finalLight")) continue;
    it(`${file} includes [LIGHT_CALC] before using finalLight`, () => {
      const chunkAt = source.indexOf("[LIGHT_CALC]");
      expect(chunkAt).toBeGreaterThanOrEqual(0);
      expect(chunkAt).toBeLessThan(source.indexOf("finalLight"));
    });
  }

  it("Glass and Frostglass GLSL100 shaders derive screen UV from v_clipPos", () => {
    const glassSrc = readFileSync(
      join(SRC_DIR, "core/materials/glass/shaders/Glass.frag.glsl100"),
      "utf8",
    );
    const frostSrc = readFileSync(
      join(SRC_DIR, "core/materials/glass/shaders/Frostglass.frag.glsl100"),
      "utf8",
    );

    expect(glassSrc).toContain("v_clipPos.xy / v_clipPos.w");
    expect(frostSrc).toContain("v_clipPos.xy / v_clipPos.w");
  });
});
