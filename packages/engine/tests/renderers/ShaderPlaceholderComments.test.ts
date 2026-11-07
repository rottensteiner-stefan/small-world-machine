import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// `ShaderRegistry.assemble` substitutes EVERY `[UPPER_ID]` token -- comments included. A comment that
// names a chunk (`// resolved inside [WGSL_PBR_LIGHTING]`, `// include after [LIGHT_DEFS]`) therefore
// splices the whole chunk into the shader mid-line: parse errors or duplicate definitions. Both happened
// on 2026-11-02. Shader comments must name chunks without brackets.

const ROOT = join(__dirname, "../../../..");
const SHADER_EXT = /\.(?:glsl|glsl100|wgsl)$/;
// Placeholders that are intentionally commented: the material replaces them itself before assembly and
// the inserted text starts with a newline, so the `//` only comments the (empty) rest of that line.
const ALLOWED = new Set(["THIN_FILM_DECL"]);

function shaderFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) shaderFiles(path, out);
    else if (SHADER_EXT.test(entry)) out.push(path);
  }
  return out;
}

describe("shader comments never contain chunk placeholders", () => {
  it("no `[UPPER_ID]` token after `//` in any package shader", () => {
    const offenders: string[] = [];
    for (const file of shaderFiles(join(ROOT, "packages"))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          const comment = line.indexOf("//");
          if (comment < 0) return;
          for (const match of line.slice(comment).matchAll(/\[([A-Z][A-Z0-9_]+)\]/g)) {
            if (!ALLOWED.has(match[1]!)) {
              offenders.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
            }
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
