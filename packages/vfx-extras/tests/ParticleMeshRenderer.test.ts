import { describe, it, expect } from "vitest";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { ParticleMeshRenderer } from "../src/ParticleMeshRenderer.js";
import { Sphere, BasicMaterial, InstancedMesh, Vector3D } from "@small-world-machine/engine";

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

    // The instance-data buffer carries per-instance RGBA color: renderers must compile an
    // instance-color variant (P0 color-path opt-in).
    expect(renderer.mesh.useInstanceDataAsColor).toBe(true);

    // Emit 2 particles at slot 0
    const idx = system.emit({
      position: new Vector3D(10, 20, 30),
      size: 2.0,
      alpha: 0.8,
    });
    system.arrays.colors[idx * 4] = 1.0;
    system.arrays.colors[idx * 4 + 1] = 0.5;
    system.arrays.colors[idx * 4 + 2] = 0.2;

    renderer.sync();

    // Check slot 0 matrix translation (offset 12, 13, 14)
    expect(renderer.mesh.instanceMatrices[12]).toBe(10);
    expect(renderer.mesh.instanceMatrices[13]).toBe(20);
    expect(renderer.mesh.instanceMatrices[14]).toBe(30);

    // Check slot 0 color in instanceData (0, 1, 2, 3)
    expect(renderer.mesh.instanceData![0]).toBeCloseTo(1.0);
    expect(renderer.mesh.instanceData![1]).toBeCloseTo(0.5);
    expect(renderer.mesh.instanceData![2]).toBeCloseTo(0.2);
    expect(renderer.mesh.instanceData![3]).toBeCloseTo(0.8);
  });

  it("defaults InstancedMesh instance data to generic semantics (no color opt-in)", () => {
    const system = new ParticleSystem({ capacity: 2 });
    const geometry = new Sphere({ radius: 0.1 }).getGeometryData();
    const material = new BasicMaterial();
    const plain = new InstancedMesh("Plain", geometry, material, 2);
    expect(plain.useInstanceDataAsColor).toBe(false);

    const renderer = new ParticleMeshRenderer({ system, geometry, material });
    expect(renderer.mesh.useInstanceDataAsColor).toBe(true);
  });
});

describe("ParticleMeshRenderer after ParticleSystem.clear()", () => {
  it("collapses cleared slots instead of drawing ghost particles", () => {
    const system = new ParticleSystem({ capacity: 3 });
    const geometry = new Sphere({ radius: 0.1 }).getGeometryData();
    const renderer = new ParticleMeshRenderer({ system, geometry, material: new BasicMaterial() });
    system.emit({ position: new Vector3D(1, 2, 3) });
    system.emit({ position: new Vector3D(4, 5, 6) });
    renderer.sync();
    expect(renderer.mesh.instanceMatrices[12]).toBe(1);

    system.clear();
    system.update(0.016);
    renderer.sync();

    for (let i = 0; i < 3; i++) {
      expect(system.isAlive(i)).toBe(false);
      expect(Array.from(renderer.mesh.instanceMatrices.subarray(i * 16, i * 16 + 16))).toEqual(
        new Array(16).fill(0),
      );
    }
    expect(renderer.mesh.instanceCount).toBe(0);
  });

  it("compacts sparse live slots into a contiguous 0..liveCount prefix and sets mesh.instanceCount", () => {
    const system = new ParticleSystem({ capacity: 5 });
    const geometry = new Sphere({ radius: 0.1 }).getGeometryData();
    const renderer = new ParticleMeshRenderer({ system, geometry, material: new BasicMaterial() });

    // Emit 3 particles at slots 0, 1, 2
    system.emit({ position: new Vector3D(1, 0, 0), alpha: 1 });
    system.emit({ position: new Vector3D(2, 0, 0), alpha: 1 });
    const idx2 = system.emit({ position: new Vector3D(3, 4, 5), alpha: 0.9 });
    system.arrays.colors[idx2 * 4] = 0.25;
    system.arrays.colors[idx2 * 4 + 1] = 0.5;
    system.arrays.colors[idx2 * 4 + 2] = 0.75;

    renderer.sync();
    expect(renderer.mesh.instanceCount).toBe(3);

    // Kill slots 0 and 1 so only slot 2 remains alive
    system.arrays.aliveFlags[0] = 0;
    system.arrays.aliveFlags[1] = 0;
    renderer.sync();

    expect(renderer.mesh.instanceCount).toBe(1);
    expect(renderer.mesh.instanceMatrices[12]).toBe(3);
    expect(renderer.mesh.instanceMatrices[13]).toBe(4);
    expect(renderer.mesh.instanceMatrices[14]).toBe(5);
    expect(renderer.mesh.instanceData![0]).toBeCloseTo(0.25);
    expect(renderer.mesh.instanceData![1]).toBeCloseTo(0.5);
    expect(renderer.mesh.instanceData![2]).toBeCloseTo(0.75);
    expect(renderer.mesh.instanceData![3]).toBeCloseTo(0.9);
    // Shrunk tail slots 1 and 2 must be zeroed
    expect(Array.from(renderer.mesh.instanceMatrices.subarray(16, 48))).toEqual(
      new Array(32).fill(0),
    );
  });
});
