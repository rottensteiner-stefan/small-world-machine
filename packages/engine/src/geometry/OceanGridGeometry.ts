import { AbstractGeometry } from "./AbstractGeometry.js";
import { BoundingBox } from "../physix/index.js";
import type { Object3D } from "../core/Object3D.js";
import type { BoundingVolume } from "../interfaces/index.js";
import { Vector3D } from "../math/index.js";

/** Max vertex count addressable by a `Uint16Array` index buffer (WebGL1 parity). */
const UINT16_MAX_VERTICES = 65_535;
/** Conservative vertical wave-displacement padding in meters for culling bounds. */
const DEFAULT_VERTICAL_BOUND_PADDING = 16.0;

/**
 * Configuration for the radial {@link OceanGridGeometry} mesh.
 */
export interface OceanGridGeometryOptions {
  /**
   * Outer horizon radius of the circular ocean mesh in meters.
   * @domain Horizon mesh radius in meters (> 0; defaults to 2400).
   */
  radius?: number;
  /**
   * Number of concentric rings radiating from the center origin.
   * @domain Radial ring count >= 1 (defaults to 160).
   */
  radialSegments?: number;
  /**
   * Number of angular slices around the full 360-degree circle.
   * @domain Angular slice count >= 3 (defaults to 192).
   */
  angularSegments?: number;
  /**
   * Power-law radial warping exponent controlling near-to-far resolution transition.
   * @domain Monotonic exponent >= 1 (defaults to 3.4).
   */
  radialExponent?: number;
  /**
   * Near-field detail radius bias in meters where inner ring spacing stays fine.
   * @domain Near-field transition radius in meters (> 0; defaults to 380).
   */
  detailRadius?: number;
}

/**
 * Radial concentric ring geometry on the XZ plane (`Y = 0`, upward `+Y` normal) built for
 * horizon-scale oceans (`OceanMaterial`). Concentrates vertex density near the center / camera
 * while stretching smoothly out to the horizon within WebGL1's `Uint16Array` vertex limit.
 */
export class OceanGridGeometry extends AbstractGeometry {
  /** @domain Outer horizon radius in meters. */
  public readonly radius: number;
  /** @domain Concentric radial ring count. */
  public readonly radialSegments: number;
  /** @domain Angular wedge count around 2π. */
  public readonly angularSegments: number;
  /** @domain Power-law radial warp exponent >= 1. */
  public readonly radialExponent: number;
  /** @domain Near-field transition radius in meters. */
  public readonly detailRadius: number;

  /**
   * Creates a new radial open-ocean grid geometry.
   * @param options Configuration for ring count, horizon radius, and radial distribution.
   */
  constructor(options: OceanGridGeometryOptions = {}) {
    super();
    const {
      radius = 2400,
      radialSegments = 160,
      angularSegments = 192,
      radialExponent = 3.4,
      detailRadius = 380,
    } = options;

    this.radius = Math.max(1, radius);
    this.radialSegments = Math.max(1, Math.floor(radialSegments));
    this.angularSegments = Math.max(3, Math.floor(angularSegments));
    this.radialExponent = Math.max(1, radialExponent);
    this.detailRadius = Math.max(1, Math.min(this.radius, detailRadius));

    this.generateGeometryData();
  }

  /**
   * Quantizes an ocean mesh's world XZ position onto `snapStep`-meter grid increments so moving
   * camera targets do not swim sub-texel/vertex wave phases across vertices.
   */
  public static snapToTarget(
    mesh: Object3D,
    targetX: number,
    targetZ: number,
    snapStep: number = 8,
  ): void {
    const step = Math.max(0.001, snapStep);
    mesh.position.x = Math.round(targetX / step) * step;
    mesh.position.z = Math.round(targetZ / step) * step;
  }

  /**
   * Maps a normalized ring index `t` in `[0, 1]` to a strictly monotonic radial distance in
   * `[0, radius]`, keeping near-field spacing tight and horizon rings broad.
   */
  public evaluateRingRadius(t: number): number {
    const clampedT = Math.max(0, Math.min(1, t));
    const innerWeight = Math.min(0.6, Math.max(0.02, this.detailRadius / this.radius));
    return (
      this.radius *
      (innerWeight * clampedT + (1 - innerWeight) * Math.pow(clampedT, this.radialExponent))
    );
  }

  /** @inheritdoc */
  public override getBoundingVolume(): BoundingVolume {
    if (!this._cachedBoundingVolume) {
      this._cachedBoundingVolume = new BoundingBox(
        new Vector3D(-this.radius, -DEFAULT_VERTICAL_BOUND_PADDING, -this.radius),
        new Vector3D(this.radius, DEFAULT_VERTICAL_BOUND_PADDING, this.radius),
      );
    }
    return this._cachedBoundingVolume;
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const rSegs = this.radialSegments;
    const aSegs = this.angularSegments;
    const vertexCount = 1 + rSegs * aSegs;
    if (vertexCount > UINT16_MAX_VERTICES) {
      throw new RangeError(
        `OceanGridGeometry vertex count (${vertexCount}) exceeds Uint16 limit (${UINT16_MAX_VERTICES}); reduce radialSegments or angularSegments.`,
      );
    }

    const vertices = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const tangents = new Float32Array(vertexCount * 4);
    const uvs = new Float32Array(vertexCount * 2);

    // Vertex 0: center pole at (0, 0, 0)
    normals[1] = 1;
    tangents[0] = 1;
    tangents[3] = 1;
    uvs[0] = 0.5;
    uvs[1] = 0.5;

    const twoPi = Math.PI * 2;
    let vPtr = 3;
    let tPtr = 4;
    let uvPtr = 2;

    for (let r = 1; r <= rSegs; r++) {
      const t = r / rSegs;
      const rad = this.evaluateRingRadius(t);
      const uScale = 0.5 / this.radius;

      for (let a = 0; a < aSegs; a++) {
        const theta = (a / aSegs) * twoPi;
        const x = rad * Math.cos(theta);
        const z = rad * Math.sin(theta);

        vertices[vPtr] = x;
        vertices[vPtr + 1] = 0;
        vertices[vPtr + 2] = z;

        normals[vPtr] = 0;
        normals[vPtr + 1] = 1;
        normals[vPtr + 2] = 0;

        tangents[tPtr] = 1;
        tangents[tPtr + 1] = 0;
        tangents[tPtr + 2] = 0;
        tangents[tPtr + 3] = 1;

        uvs[uvPtr] = 0.5 + x * uScale;
        uvs[uvPtr + 1] = 0.5 + z * uScale;

        vPtr += 3;
        tPtr += 4;
        uvPtr += 2;
      }
    }

    // Triangle index count: inner fan (`aSegs` tris) + outer quad rings (`(rSegs - 1) * aSegs * 2` tris)
    const triCount = aSegs + (rSegs - 1) * aSegs * 2;
    const indices = this._createIndexArray(triCount * 3);
    let idxPtr = 0;

    // Inner disk fan: CCW viewed from +Y -> (0, nextA, curA)
    for (let a = 0; a < aSegs; a++) {
      const nextA = (a + 1) % aSegs;
      indices[idxPtr++] = 0;
      indices[idxPtr++] = 1 + nextA;
      indices[idxPtr++] = 1 + a;
    }

    // Concentric quad rings: CCW viewed from +Y -> (i0, o1, o0), (i0, i1, o1)
    for (let r = 1; r < rSegs; r++) {
      const innerStart = 1 + (r - 1) * aSegs;
      const outerStart = 1 + r * aSegs;
      for (let a = 0; a < aSegs; a++) {
        const nextA = (a + 1) % aSegs;
        const i0 = innerStart + a;
        const i1 = innerStart + nextA;
        const o0 = outerStart + a;
        const o1 = outerStart + nextA;

        indices[idxPtr++] = i0;
        indices[idxPtr++] = o1;
        indices[idxPtr++] = o0;

        indices[idxPtr++] = i0;
        indices[idxPtr++] = i1;
        indices[idxPtr++] = o1;
      }
    }

    this._vertices = vertices;
    this._normals = normals;
    this._tangents = tangents;
    this._uvs = uvs;
    this._indices = indices;
  }

  /** @inheritdoc */
  public override computeWireframeIndices(): void {
    const rSegs = this.radialSegments;
    const aSegs = this.angularSegments;
    // Radial spokes + ring loops
    const lineIndices = this._createIndexArray(rSegs * aSegs * 4);
    let ptr = 0;
    for (let r = 1; r <= rSegs; r++) {
      const ringStart = 1 + (r - 1) * aSegs;
      const prevStart = r === 1 ? 0 : 1 + (r - 2) * aSegs;
      for (let a = 0; a < aSegs; a++) {
        const nextA = (a + 1) % aSegs;
        const cur = ringStart + a;
        const nxt = ringStart + nextA;
        const prev = r === 1 ? 0 : prevStart + a;
        lineIndices[ptr++] = prev;
        lineIndices[ptr++] = cur;
        lineIndices[ptr++] = cur;
        lineIndices[ptr++] = nxt;
      }
    }
    this._wireframeIndices = lineIndices;
  }
}
