import { describe, it, expect } from "vitest";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { ParticleMeshRenderer } from "../src/ParticleMeshRenderer.js";
import { AccretionDiskEmitter } from "../src/AccretionDiskEmitter.js";
import { PointAttractorAffector } from "../src/affectors/PointAttractorAffector.js";
import { VortexAffector } from "../src/affectors/VortexAffector.js";
import { PlanarSpringAffector } from "../src/affectors/PlanarSpringAffector.js";
import { Sphere, BasicMaterial, Vector3D, Matrix4, Quaternion } from "@small-world-machine/engine";

describe("Particle Pipeline Stress & Buffer Parity", () => {
  it("sustains thousands of particles with multiple combined affectors without memory allocation leaks", () => {
    const emitter = new AccretionDiskEmitter({
      particleCount: 500,
      center: new Vector3D(0, 0, 0),
      innerRadius: 0.5,
      outerRadius: 3.5,
      mass: 50.0,
    });
    const system = emitter.system;

    system.addAffector(
      new PointAttractorAffector({
        center: new Vector3D(0, 0, 0),
        strength: 50.0,
        softening: 0.25,
      }),
    );
    system.addAffector(
      new VortexAffector({
        axis: "y",
        strength: 2.0,
        inwardSuction: 0.5,
      }),
    );
    system.addAffector(
      new PlanarSpringAffector({
        stiffness: 5.0,
        damping: 1.0,
        planePosition: 0.0,
      }),
    );

    const geometry = new Sphere({
      radius: 0.05,
      widthSegments: 4,
      heightSegments: 4,
    }).getGeometryData();
    const material = new BasicMaterial();

    const renderer = new ParticleMeshRenderer({
      system,
      geometry,
      material,
      enableColorBuffer: true,
    });

    // Run 100 simulation frames
    for (let frame = 0; frame < 100; frame++) {
      emitter.update(0.016);
      system.update(0.016);
      renderer.sync();
    }

    expect(system.activeCount).toBeGreaterThan(0);
    expect(system.activeCount).toBeLessThanOrEqual(system.capacity);
    expect(renderer.mesh.instanceMatrices.length).toBe(system.capacity * 16);
    expect(renderer.mesh.instanceData!.length).toBe(system.capacity * 4);
    expect(renderer.mesh.instanceMatrixNeedsUpdate).toBe(true);
    expect(renderer.mesh.instanceDataNeedsUpdate).toBe(true);
  });

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
