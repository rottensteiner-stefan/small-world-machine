import { Object3D } from "./Object3D.js";
import { Matrix4 } from "../math/index.js";
import type { GeometryDataInterface } from "../interfaces/index.js";
import type { AbstractMaterial } from "./materials/index.js";

/**
 * A class for rendering multiple instances of a mesh with different transforms.
 */
export class InstancedMesh extends Object3D {
  public readonly isInstancedMesh: boolean = true;
  public instanceCount: number;
  public instanceMatrices: Float32Array;
  public instanceMatrixNeedsUpdate: boolean = true;
  public instanceData?: Float32Array;
  public instanceDataNeedsUpdate: boolean = false;
  public instanceDataSize: number = 0;
  /**
   * When true, `instanceData` holds per-instance RGBA color (r,g,b,a) instead of the legacy
   * engine-generic meaning (a texture-array index in `.x`). The renderers compile a
   * `USE_INSTANCE_COLOR` variant and the base shaders multiply the tint into the surface color,
   * so the two semantics stay disjoint at shader-compile time (see `InstancedMesh` particle
   * renderers). Defaults to false.
   */
  public useInstanceDataAsColor: boolean = false;

  constructor(
    name: string,
    geometry: GeometryDataInterface,
    material: AbstractMaterial,
    count: number,
  ) {
    super(name);
    this.geometry = geometry;
    this.material = material;
    this.instanceCount = count;
    this.instanceMatrices = new Float32Array(count * 16);

    const identityMatrix = new Matrix4();
    for (let i = 0; i < count; i++) {
      this.setMatrixAt(i, identityMatrix);
    }
  }

  /**
   * Initializes the extra instance data buffer.
   * @param sizePerInstance How many floats per instance (e.g. 4 for a vec4).
   */
  public initInstanceData(sizePerInstance: number): void {
    this.instanceDataSize = sizePerInstance;
    this.instanceData = new Float32Array(this.instanceCount * sizePerInstance);
    this.instanceDataNeedsUpdate = true;
  }

  public setMatrixAt(index: number, matrix: Matrix4): void {
    const offset = index * 16;
    this.instanceMatrices.set(matrix.data, offset);
    this.instanceMatrixNeedsUpdate = true;
  }

  public getMatrixAt(index: number, out: Matrix4): void {
    const offset = index * 16;
    out.data.set(this.instanceMatrices.subarray(offset, offset + 16));
  }

  /**
   * Sets the instance data at a specific index.
   * @param index The instance index.
   * @param data The data array (length must match `instanceDataSize`).
   */
  public setInstanceDataAt(index: number, data: number[]): void {
    if (!this.instanceData) return;
    const offset = index * this.instanceDataSize;
    for (let i = 0; i < this.instanceDataSize; i++) {
      this.instanceData[offset + i] = data[i] || 0;
    }
    this.instanceDataNeedsUpdate = true;
  }
}
