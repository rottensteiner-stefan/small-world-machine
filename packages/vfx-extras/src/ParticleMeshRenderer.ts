import type { GeometryDataInterface, AbstractMaterial } from "@small-world-machine/engine";
import { InstancedMesh, Matrix4, Vector3D, Quaternion } from "@small-world-machine/engine";
import type { ParticleSystem } from "./ParticleSystem.js";

export interface ParticleMeshRendererOptions {
  /** Name of the underlying InstancedMesh. Defaults to "ParticleMeshRenderer". */
  name?: string;
  /** The ParticleSystem driving the simulation. */
  system: ParticleSystem;
  /** Shared instanced geometry for every particle (e.g. low-poly Sphere, Quad, Cube). */
  geometry: GeometryDataInterface;
  /** Shared material for the instanced mesh. */
  material: AbstractMaterial;
  /** If true, writes per-instance RGBA color (r, g, b, a) into the instance color buffer. Defaults to true. */
  enableColorBuffer?: boolean;
}

/**
 * High-performance rendering bridge connecting a ParticleSystem to an InstancedMesh.
 * Synchronizes particle positions, scales, and colors into GPU buffers in a single draw call,
 * reading straight out of the system's SoA arrays (no per-particle objects).
 */
export class ParticleMeshRenderer {
  public readonly mesh: InstancedMesh;
  public readonly system: ParticleSystem;

  private readonly _tempPosition: Vector3D = new Vector3D();
  private readonly _tempMatrix: Matrix4 = new Matrix4();
  private readonly _tempScale: Vector3D = new Vector3D(1, 1, 1);
  private readonly _tempRotation: Quaternion = new Quaternion();
  private readonly _enableColorBuffer: boolean;

  constructor(options: ParticleMeshRendererOptions) {
    this.system = options.system;
    this.mesh = new InstancedMesh(
      options.name ?? "ParticleMeshRenderer",
      options.geometry,
      options.material,
      this.system.capacity,
    );
    this._enableColorBuffer = options.enableColorBuffer ?? true;
    if (this._enableColorBuffer) {
      this.mesh.initInstanceData(4); // r, g, b, a
      // The instance-data buffer carries RGBA color here, so the renderers compile an instance-color
      // variant and the base shaders tint the surface with it (see InstancedMesh.useInstanceDataAsColor).
      this.mesh.useInstanceDataAsColor = true;
    }
  }

  /**
   * Synchronizes live particle transforms and colors into the GPU instance buffers. Zero
   * allocation: reads the system's SoA arrays directly and reuses scratch objects.
   */
  public sync(): void {
    const arrays = this.system.arrays;
    const capacity = this.system.capacity;

    const matrices = this.mesh.instanceMatrices;
    const instanceData = this.mesh.instanceData;

    for (let i = 0; i < capacity; i++) {
      const offset16 = i * 16;
      if (arrays.aliveFlags[i] === 1 && arrays.alphas[i]! > 0.001) {
        const o = i * 3;
        const s = arrays.sizes[i]! * arrays.alphas[i]!;
        this._tempScale.set(s, s, s);
        this._tempPosition.set(
          arrays.positions[o]!,
          arrays.positions[o + 1]!,
          arrays.positions[o + 2]!,
        );

        // Build TRS matrix without GC allocations
        this._tempMatrix.composeFromQuaternion(
          this._tempPosition,
          this._tempRotation,
          this._tempScale,
        );
        matrices.set(this._tempMatrix.data, offset16);

        if (instanceData && this._enableColorBuffer) {
          const offset4 = i * 4;
          instanceData[offset4] = arrays.colors[offset4]!;
          instanceData[offset4 + 1] = arrays.colors[offset4 + 1]!;
          instanceData[offset4 + 2] = arrays.colors[offset4 + 2]!;
          instanceData[offset4 + 3] = arrays.alphas[i]!;
        }
      } else {
        // Zero-scale matrix collapses dead/invisible instances
        matrices.fill(0, offset16, offset16 + 16);
      }
    }

    this.mesh.instanceMatrixNeedsUpdate = true;
    if (instanceData && this._enableColorBuffer) {
      this.mesh.instanceDataNeedsUpdate = true;
    }
  }
}
