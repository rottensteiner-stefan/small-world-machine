import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ShaderRegistry } from "../../src/index.js";
import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";
import type { ShaderLanguage } from "../../src/renderers/shaders/ShaderRegistry.js";

// G07: `ShaderRegistry.assemble` substitutes EVERY `[A-Z][A-Z0-9_]+` token. GLSL constant array
// indices that happen to be spelled like a chunk (`[TAP_COUNT]`, `[DIR_COUNT]`) therefore trigger
// a guaranteed `Chunk not found` warn per compile and would inline the chunk if one with that name
// ever got registered. The fix renames such constants below the chunk-regex shape (lowerCamelCase).
// This guard re-scans every engine shader and fails on any `[UPPER_ID]` token that is not a
// registered chunk in at least one language -- i.e. any remaining array-index collision.

const ROOT = join(__dirname, "..", "..", "..", "..");
const SHADER_EXT = /\.(?:glsl|glsl100|wgsl)$/;

function shaderFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) shaderFiles(path, out);
    else if (SHADER_EXT.test(entry)) out.push(path);
  }
  return out;
}

describe("shader array-index constants never collide with chunk placeholders (G07)", () => {
  let registry: ShaderRegistry;

  beforeAll(async () => {
    registry = new ShaderRegistry();
    await CoreShaderChunks.init(registry);
  });

  it("every [UPPER_ID] token in engine shaders is a registered chunk", () => {
    const languages: ShaderLanguage[] = ["glsl300", "glsl100", "wgsl"];
    const collisions: string[] = [];
    const engineShaders = shaderFiles(join(ROOT, "packages/engine/src"));
    for (const file of engineShaders) {
      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        for (const match of line.matchAll(/\[([A-Z][A-Z0-9_]+)\]/g)) {
          const token = match[1]!;
          const registered = languages.some((lang) => registry.getChunk(token, lang) !== undefined);
          if (!registered) {
            collisions.push(`${relative(ROOT, file)}: ${line.trim()}  (token [${token}])`);
          }
        }
      }
    }
    expect(collisions).toEqual([]);
  });
});
