import { describe, it, expect } from "vitest";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { ParticleMeshRenderer } from "../src/ParticleMeshRenderer.js";
import { Sphere, BasicMaterial, Vector3D, Matrix4, Quaternion } from "@small-world-machine/engine";

describe("Particle Pipeline Stress & Buffer Parity", () => {
  it("verifies exact instance matrix mathematical parity with Matrix4.composeFromQuaternion", () => {
    const system = new ParticleSystem({ capacity: 4 });
    const geometry = new Sphere({ radius: 0.1 }).getGeometryData();
    const material = new BasicMaterial();

    const renderer = new ParticleMeshRenderer({
      system,
      geometry,
      material,
      enableColorBuffer: true,
    });

    const idx = system.emit({
      position: new Vector3D(3.5, -1.2, 7.8),
      size: 1.5,
      alpha: 0.8,
    });
    system.arrays.colors[idx * 4] = 0.7;
    system.arrays.colors[idx * 4 + 1] = 0.4;
    system.arrays.colors[idx * 4 + 2] = 0.1;

    renderer.sync();

    // Compute reference matrix manually from the exact SoA values
    const size = system.arrays.sizes[idx]! * system.arrays.alphas[idx]!;
    const refMatrix = new Matrix4();
    const refScale = new Vector3D(size, size, size);
    const refRot = new Quaternion();
    const refPos = new Vector3D(
      system.arrays.positions[idx * 3]!,
      system.arrays.positions[idx * 3 + 1]!,
      system.arrays.positions[idx * 3 + 2]!,
    );
    refMatrix.composeFromQuaternion(refPos, refRot, refScale);

    for (let i = 0; i < 16; i++) {
      expect(renderer.mesh.instanceMatrices[i]).toBeCloseTo(refMatrix.data[i]!);
    }

    // Dead / collapsed instance at index 1 must have completely zeroed matrix
    for (let i = 16; i < 32; i++) {
      expect(renderer.mesh.instanceMatrices[i]).toBe(0);
    }
  });
});
