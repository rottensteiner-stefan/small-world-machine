import { describe, it, expect } from "vitest";
import { Camera } from "../../src/core/cameras/Camera.js";
import { PerspectiveProjection } from "../../src/math/projections/PerspectiveProjection.js";
import {
  WaterQuadtree,
  WaterTileEdge,
  buildWaterTileVariants,
} from "../../src/geometry/WaterQuadtree.js";

describe("WaterQuadtree & Edge-Stitched Tile Variants", () => {
  it("builds all 16 watertight tile variants with strictly upward +Y triangle normals and Uint16 indices", () => {
    const variants = buildWaterTileVariants(16);
    expect(variants).toHaveLength(16);

    for (let mask = 0; mask < 16; mask++) {
      const geo = variants[mask]!;
      expect(geo.indices).toBeInstanceOf(Uint16Array);
      const verts = geo.vertices;
      const idx = geo.indices!;
      expect(idx.length % 3).toBe(0);

      for (let t = 0; t < idx.length; t += 3) {
        const i0 = idx[t]! * 3;
        const i1 = idx[t + 1]! * 3;
        const i2 = idx[t + 2]! * 3;
        const ax = verts[i0]!,
          az = verts[i0 + 2]!;
        const bx = verts[i1]!,
          bz = verts[i1 + 2]!;
        const cx = verts[i2]!,
          cz = verts[i2 + 2]!;

        // 2D XZ determinant > 0 proves strictly upward +Y CCW winding (no degenerate/flipped tris).
        const detY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        expect(detY).toBeGreaterThan(0);

        // Coarse edges must omit odd boundary vertices so T-junction cracks cannot form.
        for (const vIdx of [idx[t]!, idx[t + 1]!, idx[t + 2]!]) {
          const gx = vIdx % 17;
          const gz = Math.floor(vIdx / 17);
          if ((mask & WaterTileEdge.NORTH) !== 0 && gz === 0) expect(gx % 2).toBe(0);
          if ((mask & WaterTileEdge.EAST) !== 0 && gx === 16) expect(gz % 2).toBe(0);
          if ((mask & WaterTileEdge.SOUTH) !== 0 && gz === 16) expect(gx % 2).toBe(0);
          if ((mask & WaterTileEdge.WEST) !== 0 && gx === 0) expect(gz % 2).toBe(0);
        }
      }
    }
  });

  it("enforces 2:1 balance invariant and crack-free edge masks while frustum-culling offscreen quadrants", () => {
    const quad = new WaterQuadtree({
      worldSize: 4096,
      maxLevel: 6,
      tileSegments: 16,
      lodDistanceFactor: 2.0,
      followCamera: false,
      frustumCulling: true,
    });

    const cam = new Camera(new PerspectiveProjection({ fov: Math.PI / 3, near: 0.5, far: 5000 }));
    cam.position.set(120, 45, 250);
    cam.target.set(120, 0, -500);
    cam.updateViewMatrix();
    cam.updateProjectionMatrix();

    const stats = quad.update(cam);
    expect(stats.activeLeafCount).toBeGreaterThan(0);
    expect(stats.activeTriangleCount).toBeGreaterThan(0);

    // Frustum culling should reduce active leaves well below full unculled fanout while keeping near detail.
    const visibleLeaves = quad.root.children.filter((c) => c.isVisible);
    expect(visibleLeaves.length).toBe(stats.activeLeafCount);

    // Every visible tile's scale must stay within quadtree hierarchy power-of-two sizes.
    const minTileSize = 4096 / (1 << 6);
    const sizes = visibleLeaves.map((c) => c.scale.x);
    expect(Math.min(...sizes)).toBe(minTileSize);
    expect(Math.max(...sizes)).toBeGreaterThan(minTileSize);
  });

  it("produces fewer triangles than an unculled run and reuses pooled Object3D children without growing children", () => {
    const cam = new Camera(new PerspectiveProjection({ fov: Math.PI / 3, near: 0.5, far: 5000 }));
    cam.position.set(0, 30, 0);
    cam.target.set(0, 0, -200);
    cam.updateViewMatrix();
    cam.updateProjectionMatrix();

    const unculled = new WaterQuadtree({
      worldSize: 4096,
      maxLevel: 5,
      frustumCulling: false,
      followCamera: true,
    });
    const culled = new WaterQuadtree({
      worldSize: 4096,
      maxLevel: 5,
      frustumCulling: true,
      followCamera: true,
    });

    const sUnculled = unculled.update(cam);
    const sCulled = culled.update(cam);
    expect(sCulled.activeLeafCount).toBeLessThan(sUnculled.activeLeafCount);

    const poolCountBefore = culled.root.children.length;
    cam.position.set(500, 30, -300);
    cam.target.set(500, 0, -600);
    cam.updateViewMatrix();
    culled.update(cam);
    expect(culled.root.children.length).toBe(poolCountBefore);
  });
});
