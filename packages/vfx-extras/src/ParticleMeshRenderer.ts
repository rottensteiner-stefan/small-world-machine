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
  /** If true, initializes per-instance data buffer (4 floats: RGBA) for shader color mapping. Defaults to true. */
  enableColorBuffer?: boolean;
}

/**
 * High-performance rendering bridge connecting a ParticleSystem to an InstancedMesh.
 * Synchronizes particle positions, scales, and colors into GPU buffers in a single draw call.
 */
export class ParticleMeshRenderer {
  public readonly mesh: InstancedMesh;
  public readonly system: ParticleSystem;

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
    }
  }

  /**
   * Synchronizes active particle transforms and colors into the GPU instance buffers.
   */
  public sync(): void {
    const particles = this.system.particles;
    const count = particles.length;
    const capacity = this.system.capacity;

    const matrices = this.mesh.instanceMatrices;
    const instanceData = this.mesh.instanceData;

    for (let i = 0; i < capacity; i++) {
      const offset16 = i * 16;
      if (i < count && !particles[i]!.dead && particles[i]!.alpha > 0.001) {
        const p = particles[i]!;
        const s = p.size * p.alpha;
        this._tempScale.set(s, s, s);

        // Build TRS matrix without GC allocations
        this._tempMatrix.composeFromQuaternion(p.position, this._tempRotation, this._tempScale);
        matrices.set(this._tempMatrix.data, offset16);

        if (instanceData && this._enableColorBuffer) {
          const offset4 = i * 4;
          instanceData[offset4] = p.color.r;
          instanceData[offset4 + 1] = p.color.g;
          instanceData[offset4 + 2] = p.color.b;
          instanceData[offset4 + 3] = p.alpha;
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
