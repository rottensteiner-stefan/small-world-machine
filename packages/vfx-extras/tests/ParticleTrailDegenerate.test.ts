/** ParticleTrailRenderer review fix: degenerate segments are compacted away, no ghost segment. */
import { describe, expect, it } from "vitest";
import { BasicMaterial, Vector3D } from "@small-world-machine/engine";
import { ParticleTrailRenderer } from "../src/ParticleTrailRenderer.js";

describe("ParticleTrailRenderer degenerate segment", () => {
  it("skips a zero-length segment and compacts the rest (instanceCount == written)", () => {
    const trail = new ParticleTrailRenderer({
      maxHistory: 8,
      minStep: 0.05,
      fadeTime: 10,
      material: new BasicMaterial(),
    });
    const cam = new Vector3D(0, 5, 5);
    const node = new Vector3D();
    for (let i = 0; i < 4; i++) {
      node.set(i, 0, 0);
      trail.update(0.016, node, cam);
    }
    expect(trail.mesh.instanceCount).toBe(3);

    // Collapse samples 1 and 2 onto each other (segment 1->2 has zero length).
    const pts = (trail as unknown as { _points: Float32Array })._points;
    pts[6] = 1; // sample 2 (x) := sample 1 (x)
    trail.update(0, node, cam);

    expect(trail.mesh.instanceCount).toBe(2);
    const m = trail.mesh.instanceMatrices;
    // Slot 0: 0->1 (mid 0.5). Slot 1 must be the compacted (1->3) segment (mid 2: 1->3), not a ghost.
    expect(m[12]).toBeCloseTo(0.5, 5);
    expect(m[16 + 12]).toBeCloseTo(2, 5);
  });
});
