import { describe, it, expect } from "vitest";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { ParticleMeshRenderer } from "../src/ParticleMeshRenderer.js";
import { Sphere, BasicMaterial, Vector3D } from "@small-world-machine/engine";

describe("ParticleMeshRenderer", () => {
  it("synchronizes particle transforms and colors into InstancedMesh buffers", () => {
    const system = new ParticleSystem({ capacity: 5 });
    const geometry = new Sphere({
      radius: 0.1,
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

    expect(renderer.mesh.instanceCount).toBe(5);
    expect(renderer.mesh.instanceMatrices.length).toBe(5 * 16);
    expect(renderer.mesh.instanceData?.length).toBe(5 * 4);

    // Emit 2 particles
    const p1 = system.emit({
      position: new Vector3D(10, 20, 30),
      size: 2.0,
      alpha: 0.8,
    });
    p1?.color.set(1.0, 0.5, 0.2);

    renderer.sync();

    // Check p1 matrix translation (offset 12, 13, 14)
    expect(renderer.mesh.instanceMatrices[12]).toBe(10);
    expect(renderer.mesh.instanceMatrices[13]).toBe(20);
    expect(renderer.mesh.instanceMatrices[14]).toBe(30);

    // Check p1 color in instanceData (0, 1, 2, 3)
    expect(renderer.mesh.instanceData![0]).toBeCloseTo(1.0);
    expect(renderer.mesh.instanceData![1]).toBeCloseTo(0.5);
    expect(renderer.mesh.instanceData![2]).toBeCloseTo(0.2);
    expect(renderer.mesh.instanceData![3]).toBeCloseTo(0.8);
  });
});
