import { describe, expect, it } from "vitest";
import { PostFilterMode, ShaderChunkId } from "../../src/enums/index.js";
import { ShaderRegistry } from "../../src/index.js";

/** "Night Vision" and "NIGHT_VISION" both normalize to "NIGHTVISION". */
const normalize = (text: string): string => text.replace(/[^A-Za-z]/g, "").toUpperCase();

const PRESETS = Object.entries(PostFilterMode).map(([name, value]) => ({
  name: normalize(name),
  value,
}));

/**
 * The `FILTER_COLOR_GRADING` chunk branches on the same literal numbers twice (GLSL `u_filterMode == N`,
 * WGSL `N u == u_filterMode`) and documents each branch with a human label. The enum is the single
 * source of truth for both: these guards fail unless the branch set, branch numbers and branch labels
 * stay exactly the PostFilterMode presets (same doctrine as ShaderFlag/ShaderChunkId).
 */
describe("PostFilterMode", () => {
  it("preset values are unique", () => {
    expect(new Set(PRESETS.map((preset) => preset.value)).size).toBe(PRESETS.length);
  });

  it.each(["glsl300", "wgsl"] as const)(
    "%s: every FILTER_COLOR_GRADING branch matches one preset in number and label",
    (lang) => {
      const registry = new ShaderRegistry();
      const chunk = registry.getChunk(ShaderChunkId.FILTER_COLOR_GRADING, lang);
      expect(chunk, `FILTER_COLOR_GRADING is not registered for ${lang}`).toBeDefined();

      // GLSL: `if (u_filterMode == 2) { // Noir Detective`; WGSL: `if (2u == u_filterMode) { // ...`.
      const pattern =
        lang === "glsl300"
          ? /if \(u_filterMode == (\d+)\) \{ \/\/ ([^\n]+)/g
          : /if \((\d+)u == u_filterMode\) \{ \/\/ ([^\n]+)/g;
      const branches = Array.from(chunk!.matchAll(pattern), (match) => ({
        value: Number(match[1]),
        label: normalize(match[2]!),
      }));

      expect(branches.map((branch) => branch.value).sort((a, b) => a - b)).toEqual(
        PRESETS.map((preset) => preset.value).sort((a, b) => a - b),
      );

      for (const branch of branches) {
        const preset = PRESETS.find((candidate) => candidate.value === branch.value);
        expect(preset, `no preset exists for dispatch number ${branch.value}`).toBeDefined();
        expect(branch.label, `branch ${branch.value} label does not match its preset name`).toBe(
          preset!.name,
        );
      }
    },
  );
});
