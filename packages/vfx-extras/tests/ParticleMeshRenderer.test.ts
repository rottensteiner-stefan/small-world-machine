import { describe, it, expect } from "vitest";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { ParticleMeshRenderer } from "../src/ParticleMeshRenderer.js";
import { createOctagonBillboardGeometry } from "../src/geometry/OctagonBillboardGeometry.js";
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

  it("constructs OctagonBillboardGeometry (8 verts, 6 tris) and supports geometryMode: 'octagon'", () => {
    const oct = createOctagonBillboardGeometry({ size: 1.0 });
    expect(oct.vertices.length).toBe(8 * 3);
    expect(oct.normals?.length).toBe(8 * 3);
    expect(oct.uvs?.length).toBe(8 * 2);
    expect(oct.indices?.length).toBe(6 * 3);

    for (let i = 0; i < 8; i++) {
      const r = Math.hypot(oct.vertices[i * 3]!, oct.vertices[i * 3 + 1]!);
      expect(r).toBeCloseTo(0.5, 5);
      expect(oct.vertices[i * 3 + 2]).toBe(0);
      expect(oct.normals![i * 3 + 2]).toBe(1);
    }

    const system = new ParticleSystem({ capacity: 4 });
    const renderer = new ParticleMeshRenderer({
      system,
      geometryMode: "octagon",
      material: new BasicMaterial(),
    });
    expect(renderer.mesh.geometry?.vertices.length).toBe(24);
    expect(renderer.mesh.geometry?.indices?.length).toBe(18);
  });

  it("aligns and elongates local +Y along velocity in billboard: 'velocityStretched' mode", () => {
    const system = new ParticleSystem({ capacity: 4 });
    const renderer = new ParticleMeshRenderer({
      system,
      material: new BasicMaterial(),
      billboard: "velocityStretched",
      stretchFactor: 0.25,
      foldAlphaIntoScale: false,
    });

    // Particle at origin moving at (3, 4, 0) -> speed = 5, unit vel = (0.6, 0.8, 0)
    system.emit({
      position: new Vector3D(0, 0, 0),
      velocity: new Vector3D(3, 4, 0),
      size: 2.0,
      alpha: 1.0,
    });
    // Stationary particle at (1, 2, 3) -> falls back to spherical facing without NaN
    system.emit({
      position: new Vector3D(1, 2, 3),
      velocity: new Vector3D(0, 0, 0),
      size: 1.0,
      alpha: 1.0,
    });

    const cam = new Vector3D(0, 0, 10);
    renderer.sync(cam);

    const m = renderer.mesh.instanceMatrices;
    // Expected stretched +Y scale = size * (1 + speed * stretchFactor) = 2 * (1 + 5 * 0.25) = 4.5
    const col1Len = Math.hypot(m[4]!, m[5]!, m[6]!);
    expect(col1Len).toBeCloseTo(4.5, 5);
    expect(m[4]! / col1Len).toBeCloseTo(0.6, 5);
    expect(m[5]! / col1Len).toBeCloseTo(0.8, 5);
    expect(m[6]! / col1Len).toBeCloseTo(0.0, 5);

    // Local +X (col 0) has length `size` (2.0) and is orthogonal to velocity
    const col0Len = Math.hypot(m[0]!, m[1]!, m[2]!);
    expect(col0Len).toBeCloseTo(2.0, 5);
    const dotRightVel = m[0]! * 3 + m[1]! * 4 + m[2]! * 0;
    expect(dotRightVel).toBeCloseTo(0, 5);

    // Stationary particle (slot 1, offset 16..31) has finite orthonormal columns of length 1.0
    for (let k = 16; k < 32; k++) {
      expect(Number.isFinite(m[k]!)).toBe(true);
    }
    expect(Math.hypot(m[16]!, m[17]!, m[18]!)).toBeCloseTo(1.0, 5);
    expect(Math.hypot(m[20]!, m[21]!, m[22]!)).toBeCloseTo(1.0, 5);
    expect(Math.hypot(m[24]!, m[25]!, m[26]!)).toBeCloseTo(1.0, 5);
  });

  it("syncs 10,000 spherical-billboard particles with zero TypedArray allocations and fast CPU time (T3)", () => {
    const N = 10_000;
    const system = new ParticleSystem({ capacity: N });
    const renderer = new ParticleMeshRenderer({
      system,
      geometryMode: "octagon",
      material: new BasicMaterial(),
      billboard: "spherical",
    });

    const pos = new Vector3D();
    for (let i = 0; i < N; i++) {
      pos.set((i % 100) * 0.1, Math.floor(i / 100) * 0.1, (i % 10) * -0.2);
      system.emit({ position: pos, size: 0.15, alpha: 0.9 });
    }

    const cam = new Vector3D(5, 5, 15);
    // Warmup frame
    renderer.sync(cam);
    expect(renderer.mesh.instanceCount).toBe(N);

    const origF32 = globalThis.Float32Array;
    let f32Allocs = 0;
    // Spy on Float32Array allocations during steady-state sync frames
    const PatchedF32 = new Proxy(origF32, {
      construct(target, args, newTarget): Float32Array {
        f32Allocs++;
        return Reflect.construct(target, args, newTarget) as Float32Array;
      },
    });
    globalThis.Float32Array = PatchedF32;

    const samples: number[] = [];
    try {
      for (let f = 0; f < 15; f++) {
        cam.x = 5 + f * 0.1;
        const t0 = performance.now();
        renderer.sync(cam);
        samples.push(performance.now() - t0);
      }
    } finally {
      globalThis.Float32Array = origF32;
    }

    expect(f32Allocs).toBe(0);
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)]!;
    // Typical trig-free p50 is ~0.25-0.6ms; keep generous 10ms ceiling for heavily loaded CI workers
    expect(p50).toBeLessThan(10);
  });
});
