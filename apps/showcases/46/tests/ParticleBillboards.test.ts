import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// Source pin: the showcase needs WebGL/WebGPU to run, so the wiring is checked textually.
const src = readFileSync("apps/showcases/46/showcase.ts", "utf8");

describe("showcase 46 particle quads face the camera", () => {
  it("every ParticleMeshRenderer is created with billboard: spherical", () => {
    const creations = src.match(/new ParticleMeshRenderer\(\{[\s\S]*?\n\s{4}\}\);/g) ?? [];
    expect(creations.length).toBe(4);
    for (const block of creations) expect(block).toContain('billboard: "spherical"');
  });

  it("every ParticleMeshRenderer.sync receives the camera position", () => {
    const syncs = src.match(/Renderer\.sync\([^)]*\)/g) ?? [];
    expect(syncs.length).toBe(4);
    for (const call of syncs) expect(call).toContain("this.camera.position");
  });
});
