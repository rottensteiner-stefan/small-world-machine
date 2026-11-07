import { describe, expect, it } from "vitest";
import { matchPbrSlots } from "../../src/common/io/PbrSlotMatcher.js";

const file = (name: string): { name: string; blob: Blob } => ({ name, blob: new Blob([name]) });

describe("matchPbrSlots", () => {
  it("lets the trailing token decide, not a single-letter prefix", () => {
    const set = matchPbrSlots([file("m_albedo.png"), file("m_normal.png")]);
    expect(set?.albedo).toBeDefined();
    expect(set?.normal).toBeDefined();
    expect(set?.metallic).toBeUndefined();
  });

  it("matches common suffix conventions", () => {
    const set = matchPbrSlots([
      file("rock_basecolor.png"),
      file("rock_nrm.png"),
      file("rock_rough.png"),
      file("rock_metallic.png"),
      file("rock_ao.png"),
    ]);
    expect(set?.albedo).toBeDefined();
    expect(set?.normal).toBeDefined();
    expect(set?.roughness).toBeDefined();
    expect(set?.metallic).toBeDefined();
    expect(set?.ao).toBeDefined();
  });

  it("returns null for a single unrelated image", () => {
    expect(matchPbrSlots([file("photo.png")])).toBeNull();
  });
});
