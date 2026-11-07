import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

// G05: the skybox is part of the rendered frame and must follow the scene exposure on every tier
// that carries an exposure uniform. Every PBR material scales its output tail by exposure
// (glsl300 `u_exposure`, WGSL `global.exposure`; both forced to 1.0 while post owns the tail, so a
// shader-side *= can never double-apply). Before the fix the WebGPU skybox alone applied exposure
// while the WebGL2 skybox stayed pinned at 1.0 -- same object, tier-divergent brightness at
// exposure != 1. WebGL1 is the documented tier absence (S5: no u_exposure uniform exists anywhere
// on the tier), which this guard pins explicitly so a future "fix" does not invent one.

const ROOT = path.resolve(__dirname, "../../../..");

function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf-8");
}

const WGSL = "packages/engine/src/core/materials/shaders/Skybox.frag.wgsl";
const GL2 = "packages/engine/src/core/materials/shaders/Skybox.frag.glsl";
const GL1 = "packages/engine/src/core/materials/shaders/Skybox.frag.glsl100";

describe("skybox exposure parity across tiers (G05)", () => {
  /** Code with comments removed -- a documented-absence note must neither satisfy nor break a guard. */
  function code(relative: string): string {
    return read(relative)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
  }

  it("WebGPU skybox scales its output by global.exposure (canonical)", () => {
    expect(code(WGSL)).toContain("* global.exposure");
  });

  it("WebGL2 skybox scales its output by u_exposure (aligns with WebGPU + its own PBR tail)", () => {
    expect(code(GL2)).toContain("* u_exposure");
  });

  it("WebGL1 skybox stays unexposed -- documented tier limitation, not a regression", () => {
    expect(code(GL1)).not.toMatch(/exposure/);
    // The deliberate-absence reason is documented in the shader itself.
    expect(read(GL1)).toContain("G05 tier note");
  });
});
