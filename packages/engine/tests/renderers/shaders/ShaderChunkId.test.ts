import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ShaderChunkId } from "../../../src/enums/index.js";
import { ShaderRegistry } from "../../../src/index.js";
import type { ShaderLanguage } from "../../../src/renderers/shaders/ShaderRegistry.js";

const LANGUAGES: ShaderLanguage[] = ["glsl300", "glsl100", "wgsl"];
const ENGINE_SRC = join(__dirname, "../../../src");

/**
 * `ShaderChunkId` is the closed set of built-in chunk tokens. Each value is the literal `[TOKEN]`
 * placeholder shader sources and material templates embed, so a member rename must never change its
 * value (same doctrine as `ShaderFlag`). These guards keep the enum, the registry bootstrapping and
 * the library call sites in lock-step; plain strings stay legal at the API for external/dynamic
 * chunks and in tests on purpose.
 */
describe("ShaderChunkId", () => {
  it("keeps the literal token as every value and never repeats one", () => {
    const values = Object.values(ShaderChunkId);

    for (const value of values) expect(value).toMatch(/^[A-Z][A-Z0-9_]+$/);
    expect(new Set(values).size).toBe(values.length);
  });

  it("every member is a registered chunk in at least one language", () => {
    const registry = new ShaderRegistry();

    for (const value of Object.values(ShaderChunkId)) {
      const registered = LANGUAGES.some((lang) => registry.getChunk(value, lang) !== undefined);
      expect(registered, `no language registers chunk ${value}`).toBe(true);
    }
  });

  it("engine library registers and reads built-in chunks through ShaderChunkId, never raw literals", () => {
    const files = (readdirSync(ENGINE_SRC, { recursive: true }) as string[])
      .filter((file) => file.endsWith(".ts"))
      .map((file) => join(ENGINE_SRC, file));
    const members = new Set<string>(Object.values(ShaderChunkId));
    const rawUsages: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        for (const match of line.matchAll(/(?:registerChunk|getChunk)\(\s*"([A-Z][A-Z0-9_]+)"/g)) {
          const id = match[1]!;
          if (members.has(id)) rawUsages.push(`${file}: ${line.trim()}  (use ShaderChunkId.${id})`);
        }
      }
    }

    expect(rawUsages).toEqual([]);
  });
});
