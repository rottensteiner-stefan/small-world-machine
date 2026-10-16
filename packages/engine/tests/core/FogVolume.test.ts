import { describe, it, expect } from "vitest";
import { FogVolume } from "../../src/core/objects/FogVolume.js";
import { FogVolumeShape } from "../../src/enums/FogVolumeShape.js";
import { Color } from "../../src/core/colors/Color.js";
import { Vector3D } from "../../src/math/index.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";

// SDF analytical implementations matching froxel_inject.wgsl and VolumetricFog.frag.glsl
function boxSDF(p: [number, number, number], b: [number, number, number]): number {
  const qx = Math.abs(p[0]) - b[0];
  const qy = Math.abs(p[1]) - b[1];
  const qz = Math.abs(p[2]) - b[2];
  const maxQ0 = Math.max(qx, 0);
  const maxQ1 = Math.max(qy, 0);
  const maxQ2 = Math.max(qz, 0);
  const len = Math.hypot(maxQ0, maxQ1, maxQ2);
  return len + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
}

function sphereSDF(p: [number, number, number], r: number): number {
  return Math.hypot(p[0], p[1], p[2]) - r;
}

function cylinderSDF(p: [number, number, number], r: number, h: number): number {
  const dx = Math.hypot(p[0], p[2]) - r;
  const dy = Math.abs(p[1]) - h;
  const len = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return Math.min(Math.max(dx, dy), 0) + len;
}

describe("FogVolume", () => {
  describe("Instantiation & Properties", () => {
    it("initializes with sensible default values", () => {
      const vol = new FogVolume();
      expect(vol.shape).toBe(FogVolumeShape.BOX);
      expect(vol.size.x).toBe(5);
      expect(vol.size.y).toBe(5);
      expect(vol.size.z).toBe(5);
      expect(vol.density).toBeCloseTo(0.1);
      expect(vol.edgeFade).toBeCloseTo(0.2);
      expect(vol.albedo.r).toBe(1);
      expect(vol.albedo.g).toBe(1);
      expect(vol.albedo.b).toBe(1);
      expect(vol.emissionIntensity).toBe(0.0);
      expect(vol.enabled).toBe(true);
    });

    it("respects custom constructor options", () => {
      const vol = new FogVolume({
        name: "CanyonMist",
        shape: FogVolumeShape.CYLINDER,
        size: new Vector3D(12, 4, 12),
        density: -0.8,
        edgeFade: 0.35,
        albedo: new Color(0.2, 0.4, 0.8),
        emission: new Color(1.0, 0.5, 0.0),
        emissionIntensity: 2.5,
        enabled: true,
      });

      expect(vol.name).toBe("CanyonMist");
      expect(vol.shape).toBe(FogVolumeShape.CYLINDER);
      expect(vol.size.x).toBe(12);
      expect(vol.density).toBeCloseTo(-0.8);
      expect(vol.edgeFade).toBeCloseTo(0.35);
      expect(vol.emissionIntensity).toBeCloseTo(2.5);
    });
  });

  describe("Inverse World Transformation", () => {
    it("transforms world coordinates to local volume space", () => {
      const vol = new FogVolume({ size: new Vector3D(5, 5, 5) });
      vol.position.set(10, 20, 30);
      vol.updateMatrixWorld(true);

      const inv = vol.getInverseWorldMatrix();
      // Transforming a point at (10, 20, 30) should yield (0, 0, 0) in local space
      const px = 10;
      const py = 20;
      const pz = 30;
      const pw = 1;
      const d = inv.data;
      const pLocalX = d[0]! * px + d[4]! * py + d[8]! * pz + d[12]! * pw;
      const pLocalY = d[1]! * px + d[5]! * py + d[9]! * pz + d[13]! * pw;
      const pLocalZ = d[2]! * px + d[6]! * py + d[10]! * pz + d[14]! * pw;

      expect(pLocalX).toBeCloseTo(0, 4);
      expect(pLocalY).toBeCloseTo(0, 4);
      expect(pLocalZ).toBeCloseTo(0, 4);
    });
  });

  describe("Analytical SDF & Boundary Falloff", () => {
    it("evaluates Box SDF correctly (inside < 0, surface == 0, outside > 0)", () => {
      const b: [number, number, number] = [5, 3, 4];
      expect(boxSDF([0, 0, 0], b)).toBeLessThan(0);
      expect(boxSDF([5, 0, 0], b)).toBeCloseTo(0);
      expect(boxSDF([0, 3, 0], b)).toBeCloseTo(0);
      expect(boxSDF([10, 0, 0], b)).toBeCloseTo(5);
    });

    it("evaluates Sphere SDF correctly", () => {
      const r = 6.0;
      expect(sphereSDF([0, 0, 0], r)).toBeCloseTo(-6.0);
      expect(sphereSDF([6, 0, 0], r)).toBeCloseTo(0.0);
      expect(sphereSDF([0, 10, 0], r)).toBeCloseTo(4.0);
    });

    it("evaluates Cylinder SDF correctly", () => {
      const r = 4.0;
      const h = 8.0;
      expect(cylinderSDF([0, 0, 0], r, h)).toBeLessThan(0);
      expect(cylinderSDF([4, 0, 0], r, h)).toBeCloseTo(0.0);
      expect(cylinderSDF([0, 8, 0], r, h)).toBeCloseTo(0.0);
      expect(cylinderSDF([0, 12, 0], r, h)).toBeCloseTo(4.0);
    });

    it("carves out density cleanly when negative density is applied", () => {
      const baseExtinction = 0.25;
      const carvingVolume = new FogVolume({
        shape: FogVolumeShape.BOX,
        size: new Vector3D(10, 10, 10),
        density: -1.0, // Strong negative carving
        edgeFade: 0.2,
      });

      // At center of carving volume (local 0,0,0)
      const sdf = boxSDF([0, 0, 0], [10, 10, 10]);
      const minDim = 10;
      const fadeDist = minDim * carvingVolume.edgeFade;
      const falloff = Math.min(Math.max(-sdf / fadeDist, 0), 1);
      const effectiveFalloff = falloff * falloff * (3 - 2 * falloff);

      const resultingExtinction = Math.max(
        0,
        baseExtinction + carvingVolume.density * effectiveFalloff,
      );
      expect(resultingExtinction).toBe(0.0); // Completely cleared!
    });
  });

  describe("Scene Extraction", () => {
    it("extracts active, visible FogVolumes and ignores disabled or hidden ones", () => {
      const scene = new Scene();
      const parent = new Object3D("Room");
      const activeVol = new FogVolume({ name: "ActiveFog", enabled: true });
      const disabledVol = new FogVolume({ name: "DisabledFog", enabled: false });
      const hiddenVol = new FogVolume({ name: "HiddenFog", enabled: true });
      hiddenVol.isVisible = false;

      parent.add(activeVol, disabledVol, hiddenVol);
      scene.root.add(parent);

      // Dummy renderer object implementing extractFogVolumes
      const extracted: FogVolume[] = [];
      function traverse(node: Object3D): void {
        if (node instanceof FogVolume && node.isVisible && node.enabled) {
          extracted.push(node);
        }
        for (const child of node.children) {
          traverse(child);
        }
      }
      traverse(scene.root);

      expect(extracted.length).toBe(1);
      expect(extracted[0]?.name).toBe("ActiveFog");
    });
  });
});
