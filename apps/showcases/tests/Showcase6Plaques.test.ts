// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";
import { makeMockAudioContext } from "../../../packages/engine/tests/audio/mockAudioContext.js";

// Setup global mock for AudioContext and Canvas prior to importing showcase
(globalThis as unknown as { AudioContext: unknown }).AudioContext = class {
  constructor() {
    return makeMockAudioContext();
  }
};
(window as unknown as { AudioContext: unknown }).AudioContext = (
  globalThis as unknown as { AudioContext: unknown }
).AudioContext;

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  public observe = vi.fn();
  public unobserve = vi.fn();
  public disconnect = vi.fn();
};
(window as unknown as { ResizeObserver: unknown }).ResizeObserver = (
  globalThis as unknown as { ResizeObserver: unknown }
).ResizeObserver;

// Mock canvas 2D context for TextTexture and DevTools
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  measureText: vi.fn().mockReturnValue({ width: 100 }),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  clearRect: vi.fn(),
  fillText: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn().mockReturnValue({ data: new Uint8Array(4) }),
  putImageData: vi.fn(),
  createImageData: vi.fn(),
  setTransform: vi.fn(),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  arc: vi.fn(),
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;

import { BoundingBox, Texture } from "@small-world-machine/engine";

describe("Showcase 6 - Complete Plaque & Geometry Verification", () => {
  let Showcase6Class: typeof import("../6/showcase.js").Showcase6;

  beforeAll(async () => {
    vi.spyOn(Texture, "fromUrl").mockResolvedValue(
      Texture.fromCanvas(document.createElement("canvas")),
    );
    const mod = await import("../6/showcase.js");
    Showcase6Class = mod.Showcase6;
  }, 20000);

  const expectedGeometries = [
    { key: "Cube", displayName: "Cube", dimension: "3d" },
    { key: "Sphere", displayName: "Sphere", dimension: "3d" },
    { key: "Cone", displayName: "Cone", dimension: "3d" },
    { key: "Cylinder", displayName: "Cylinder", dimension: "3d" },
    { key: "Pyramid", displayName: "Pyramid", dimension: "3d" },
    { key: "Octahedron", displayName: "Octahedron", dimension: "3d" },
    { key: "Torus", displayName: "Torus", dimension: "3d" },
    { key: "Capsule", displayName: "Capsule", dimension: "3d" },
    { key: "TruncatedCone", displayName: "Truncated Cone", dimension: "3d" },
    { key: "CutCylinder", displayName: "Cut Cylinder", dimension: "3d" },
    { key: "PointedPillar", displayName: "Pointed Pillar", dimension: "3d" },
    { key: "HollowCylinder", displayName: "Hollow Cylinder", dimension: "3d" },
    { key: "Barrel", displayName: "Barrel", dimension: "3d" },
    { key: "Tube", displayName: "Tube", dimension: "3d" },
    { key: "SphericalCap", displayName: "Spherical Cap", dimension: "3d" },
    { key: "SphericalTriangleSector", displayName: "Spherical Triangle Sector", dimension: "3d" },
    { key: "Arch", displayName: "Roman Arch", dimension: "3d" },
    { key: "CylinderSector", displayName: "Cylinder Sector", dimension: "3d" },
    { key: "Gear", displayName: "Gear", dimension: "3d" },
    { key: "Extrude", displayName: "Extruded Polygon", dimension: "3d" },
    { key: "Lathe", displayName: "Lathe", dimension: "3d" },
    { key: "Tetrahedron", displayName: "Tetrahedron", dimension: "3d" },
    { key: "Dodecahedron", displayName: "Dodecahedron", dimension: "3d" },
    { key: "Icosahedron", displayName: "Icosahedron", dimension: "3d" },
    { key: "TorusKnot", displayName: "Torus Knot", dimension: "3d" },
    { key: "MobiusStrip", displayName: "Möbius Strip", dimension: "3d" },
    { key: "Supershape", displayName: "Supershape", dimension: "3d" },
    { key: "ParametricSurface", displayName: "Parametric Surface", dimension: "3d" },
    { key: "MarchingCubes", displayName: "Marching Cubes", dimension: "3d" },
    { key: "VoronoiCells", displayName: "Voronoi Cells", dimension: "3d" },
    { key: "VoronoiShard", displayName: "Voronoi Shard", dimension: "3d" },
    { key: "Terrain", displayName: "Terrain Heightfield", dimension: "3d" },
    { key: "FilledPolygon", displayName: "Filled Polygon", dimension: "2d" },
    { key: "Annulus", displayName: "Annulus", dimension: "2d" },
    { key: "Disk", displayName: "Disk", dimension: "2d" },
    { key: "Circle", displayName: "Circle", dimension: "2d" },
    { key: "Plane", displayName: "Plane", dimension: "2d" },
    { key: "Ground", displayName: "Ground", dimension: "2d" },
    { key: "Triangle", displayName: "Triangle", dimension: "2d" },
    { key: "CylindricalArch", displayName: "Cylindrical Arch", dimension: "3d" },
    { key: "HollowTruncatedCone", displayName: "Hollow Truncated Cone", dimension: "3d" },
    { key: "OpenFrame", displayName: "Open Frame", dimension: "2d" },
    { key: "LShape", displayName: "L-Shape", dimension: "2d" },
    { key: "Rhombus", displayName: "Rhombus", dimension: "2d" },
    { key: "TriStar", displayName: "Tri-Star", dimension: "2d" },
    { key: "PolygonFan", displayName: "Polygon Fan", dimension: "1d" },
    { key: "Polyline", displayName: "Polyline", dimension: "1d" },
    { key: "Line", displayName: "Line", dimension: "1d" },
  ];

  it("should contain exactly all 48 expected geometries in Showcase 6", () => {
    expect(expectedGeometries.length).toBe(48);
  });

  it("should initialize Showcase 6 and create a ground plaque for every single geometry", async () => {
    const showcase = new Showcase6Class();
    showcase.canvas = document.createElement("canvas");
    // @ts-expect-error accessing protected method for testing
    await showcase.setupScene();

    const sceneObjects = showcase.scene.objects;
    const objectNames = sceneObjects.map((o) => o.name);

    for (const item of expectedGeometries) {
      const signName = `${item.key}_Sign`;
      expect(objectNames, `Missing sign for geometry: ${item.key}`).toContain(signName);

      const signObj = sceneObjects.find((o) => o.name === signName);
      expect(signObj).toBeDefined();
      expect(signObj!.geometry).toBeDefined();
      expect(signObj!.material).toBeDefined();
      expect(signObj!.isStatic).toBe(true);

      // Verify position and rotation
      expect(signObj!.position.y).toBe(0.25);
      expect(signObj!.rotation.x).toBeCloseTo(-Math.PI / 4, 3);
    }
  });

  it("should create wireframe and solid/brick representations according to dimension", async () => {
    const showcase = new Showcase6Class();
    showcase.canvas = document.createElement("canvas");
    // @ts-expect-error accessing protected method for testing
    await showcase.setupScene();

    const sceneObjects = showcase.scene.objects;
    const objectNames = sceneObjects.map((o) => o.name);

    for (const item of expectedGeometries) {
      // Every geometry must have a wireframe
      expect(objectNames, `Missing Wireframe for ${item.key}`).toContain(`${item.key}_Wire`);

      if (item.dimension === "2d") {
        // 2D has Wireframe + Solid (no brick)
        expect(objectNames, `Missing Solid for 2D ${item.key}`).toContain(`${item.key}_Solid`);
        expect(objectNames, `2D ${item.key} should not have Brick`).not.toContain(
          `${item.key}_Brick`,
        );
      } else if (item.dimension === "3d") {
        // 3D has Wireframe + Solid + Brick
        expect(objectNames, `Missing Solid for 3D ${item.key}`).toContain(`${item.key}_Solid`);
        expect(objectNames, `Missing Brick for 3D ${item.key}`).toContain(`${item.key}_Brick`);
      } else if (item.dimension === "1d") {
        // 1D has Wireframe only
        expect(objectNames, `1D ${item.key} should not have Solid`).not.toContain(
          `${item.key}_Solid`,
        );
        expect(objectNames, `1D ${item.key} should not have Brick`).not.toContain(
          `${item.key}_Brick`,
        );
      }
    }
  });

  it("should ensure no bounding boxes overlap within any geometry group", async () => {
    const showcase = new Showcase6Class();
    showcase.canvas = document.createElement("canvas");
    // @ts-expect-error accessing protected method for testing
    await showcase.setupScene();

    const sceneObjects = showcase.scene.objects;

    for (const item of expectedGeometries) {
      if (item.dimension === "3d") {
        const wireObj = sceneObjects.find((o) => o.name === `${item.key}_Wire`)!;
        const solidObj = sceneObjects.find((o) => o.name === `${item.key}_Solid`)!;
        const brickObj = sceneObjects.find((o) => o.name === `${item.key}_Brick`)!;

        const wireLocal = BoundingBox.fromVertices(wireObj.geometry!.vertices);
        const solidLocal = BoundingBox.fromVertices(solidObj.geometry!.vertices);
        const brickLocal = BoundingBox.fromVertices(brickObj.geometry!.vertices);

        const wireMaxX = wireLocal.max.x + wireObj.position.x;
        const solidMinX = solidLocal.min.x + solidObj.position.x;
        const solidMaxX = solidLocal.max.x + solidObj.position.x;
        const brickMinX = brickLocal.min.x + brickObj.position.x;

        // Verify that wireBox and solidBox do not overlap in X
        const wireSolidGap = solidMinX - wireMaxX;
        expect(
          wireSolidGap,
          `${item.key} Wire and Solid bounding boxes overlap! gap: ${wireSolidGap}`,
        ).toBeGreaterThanOrEqual(0.7);

        // Verify that solidBox and brickBox do not overlap in X
        const solidBrickGap = brickMinX - solidMaxX;
        expect(
          solidBrickGap,
          `${item.key} Solid and Brick bounding boxes overlap! gap: ${solidBrickGap}`,
        ).toBeGreaterThanOrEqual(0.7);
      } else if (item.dimension === "2d") {
        const wireObj = sceneObjects.find((o) => o.name === `${item.key}_Wire`)!;
        const solidObj = sceneObjects.find((o) => o.name === `${item.key}_Solid`)!;

        const wireLocal = BoundingBox.fromVertices(wireObj.geometry!.vertices);
        const solidLocal = BoundingBox.fromVertices(solidObj.geometry!.vertices);

        const wireMaxX = wireLocal.max.x + wireObj.position.x;
        const solidMinX = solidLocal.min.x + solidObj.position.x;

        const gap = solidMinX - wireMaxX;
        expect(gap, `${item.key} 2D bounding boxes overlap! gap: ${gap}`).toBeGreaterThanOrEqual(
          0.7,
        );
      }
    }
  });
});
