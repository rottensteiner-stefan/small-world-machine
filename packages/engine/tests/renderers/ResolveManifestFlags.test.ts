import { describe, expect, it } from "vitest";
import { ShaderFlag } from "../../src/enums/index.js";
import { resolveManifestFlags } from "../../src/renderers/shaders/index.js";

describe("resolveManifestFlags: cheap iridescence", () => {
  it("adds USE_IRIDESCENCE_CHEAP only to iridescent programs, cached per input array", () => {
    const flags: string[] = [ShaderFlag.IRIDESCENCE, ShaderFlag.NORMAL_MAP];

    const cheap = resolveManifestFlags(flags, false, true)!;

    expect(cheap).toEqual([
      ShaderFlag.IRIDESCENCE,
      ShaderFlag.NORMAL_MAP,
      ShaderFlag.IRIDESCENCE_CHEAP,
    ]);
    expect(resolveManifestFlags(flags, false, true)).toBe(cheap);
    expect(flags).not.toContain(ShaderFlag.IRIDESCENCE_CHEAP);
  });

  it("leaves programs without iridescence, or with the switch off, untouched (same array)", () => {
    const plain: string[] = [ShaderFlag.NORMAL_MAP];
    const iridescent: string[] = [ShaderFlag.IRIDESCENCE];

    expect(resolveManifestFlags(plain, false, true)).toBe(plain);
    expect(resolveManifestFlags(iridescent, false, false)).toBe(iridescent);
    expect(resolveManifestFlags(iridescent, false)).toBe(iridescent);
    expect(resolveManifestFlags(undefined, false, true)).toBeUndefined();
  });

  it("is idempotent and composes with the disableTextures strip", () => {
    const flags: string[] = [ShaderFlag.IRIDESCENCE, ShaderFlag.RAMP_LUT];

    const both = resolveManifestFlags(flags, true, true)!;

    expect(both).toEqual([ShaderFlag.IRIDESCENCE, ShaderFlag.IRIDESCENCE_CHEAP]);
    expect(resolveManifestFlags(both, true, true)).toBe(both);
  });
});
