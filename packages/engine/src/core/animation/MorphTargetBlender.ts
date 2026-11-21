import type { GeometryDataInterface } from "../../interfaces/index.js";
import type { BoundingBox } from "../../physix/index.js";

/** Destination typed-array buffers written in-place by {@link MorphTargetBlender.blend}. */
export interface MorphBlendTarget {
  /** Blended vertex positions (3 floats per vertex). */
  positions: Float32Array;
  /** Optional blended & renormalized vertex normals (3 floats per vertex). */
  normals?: Float32Array | undefined;
  /** Optional blended & renormalized vertex tangents (4 floats per vertex; `w` handedness preserved). */
  tangents?: Float32Array | undefined;
}

const DEFAULT_WEIGHT_EPSILON = 1e-6;

/**
 * Zero-GC CPU morph-target blender shared by the WebGL1 renderer, the WebGL2 fallback path
 * (when `MAX_VERTEX_TEXTURE_IMAGE_UNITS === 0`), and morphed bounding-box computation.
 */
export class MorphTargetBlender {
  /** Returns true when at least one weight has magnitude greater than `epsilon`. */
  public static hasActiveWeights(
    weights: ArrayLike<number> | undefined,
    epsilon: number = DEFAULT_WEIGHT_EPSILON,
  ): boolean {
    if (!weights) return false;
    const len = weights.length;
    for (let i = 0; i < len; i++) {
      if (Math.abs(weights[i]!) > epsilon) return true;
    }
    return false;
  }

  /**
   * Returns true when the first `count` entries of `current` differ from `cached` by more than
   * `epsilon`, or when `cached` has not been initialized to length `count` yet.
   */
  public static weightsDiffer(
    current: ArrayLike<number> | undefined,
    cached: Float32Array | undefined,
    count: number,
    epsilon: number = DEFAULT_WEIGHT_EPSILON,
  ): boolean {
    if (!cached || cached.length !== count) return true;
    for (let i = 0; i < count; i++) {
      const a = current && i < current.length ? current[i]! : 0;
      if (Math.abs(a - cached[i]!) > epsilon) return true;
    }
    return false;
  }

  /**
   * Applies morph target deltas (`geometry.morphTargets`) weighted by `weights` onto the base
   * geometry attributes and writes the blended result into `out` with zero heap allocation.
   * Follows glTF 2.0 morph semantics: position, normal (renormalized), and xyz tangent deltas
   * (renormalized with base `w` handedness preserved).
   */
  public static blend(
    geometry: GeometryDataInterface,
    weights: ArrayLike<number>,
    out: MorphBlendTarget,
  ): void {
    const basePos = geometry.vertices;
    const outPos = out.positions;
    outPos.set(basePos);

    const targets = geometry.morphTargets;
    const targetCount = targets ? Math.min(targets.length, weights.length) : 0;

    const baseNorm = geometry.normals;
    const outNorm = out.normals;
    const blendNormals = outNorm !== undefined && baseNorm !== undefined && baseNorm.length > 0;
    if (blendNormals) outNorm.set(baseNorm);

    const baseTan = geometry.tangents;
    const outTan = out.tangents;
    const blendTangents = outTan !== undefined && baseTan !== undefined && baseTan.length > 0;
    if (blendTangents) outTan.set(baseTan);

    if (!targets || targetCount === 0) return;

    let touchedNormals = false;
    let touchedTangents = false;

    for (let t = 0; t < targetCount; t++) {
      const w = weights[t]!;
      if (Math.abs(w) <= DEFAULT_WEIGHT_EPSILON) continue;
      const target = targets[t]!;

      const dPos = target.positions;
      if (dPos) {
        const len = Math.min(outPos.length, dPos.length);
        for (let i = 0; i < len; i++) {
          outPos[i] = outPos[i]! + dPos[i]! * w;
        }
      }

      if (blendNormals && target.normals) {
        const dNorm = target.normals;
        const len = Math.min(outNorm.length, dNorm.length);
        for (let i = 0; i < len; i++) {
          outNorm[i] = outNorm[i]! + dNorm[i]! * w;
        }
        touchedNormals = true;
      }

      if (blendTangents && target.tangents) {
        const dTan = target.tangents;
        const vertCount = Math.min(Math.floor(outTan.length / 4), Math.floor(dTan.length / 3));
        for (let v = 0; v < vertCount; v++) {
          const o4 = v * 4;
          const d3 = v * 3;
          outTan[o4] = outTan[o4]! + dTan[d3]! * w;
          outTan[o4 + 1] = outTan[o4 + 1]! + dTan[d3 + 1]! * w;
          outTan[o4 + 2] = outTan[o4 + 2]! + dTan[d3 + 2]! * w;
        }
        touchedTangents = true;
      }
    }

    if (touchedNormals && outNorm) {
      for (let i = 0; i + 2 < outNorm.length; i += 3) {
        const nx = outNorm[i]!;
        const ny = outNorm[i + 1]!;
        const nz = outNorm[i + 2]!;
        const lenSq = nx * nx + ny * ny + nz * nz;
        if (lenSq > 1e-12) {
          const inv = 1 / Math.sqrt(lenSq);
          outNorm[i] = nx * inv;
          outNorm[i + 1] = ny * inv;
          outNorm[i + 2] = nz * inv;
        }
      }
    }

    if (touchedTangents && outTan) {
      for (let i = 0; i + 3 < outTan.length; i += 4) {
        const tx = outTan[i]!;
        const ty = outTan[i + 1]!;
        const tz = outTan[i + 2]!;
        const lenSq = tx * tx + ty * ty + tz * tz;
        if (lenSq > 1e-12) {
          const inv = 1 / Math.sqrt(lenSq);
          outTan[i] = tx * inv;
          outTan[i + 1] = ty * inv;
          outTan[i + 2] = tz * inv;
        }
      }
    }
  }

  /**
   * Computes the local-space AABB of the morphed vertex positions into `out` with zero allocation.
   */
  public static computeMorphedBounds(
    geometry: GeometryDataInterface,
    weights: ArrayLike<number>,
    out: BoundingBox,
  ): void {
    const basePos = geometry.vertices;
    const vertCount = Math.floor(basePos.length / 3);
    if (vertCount === 0) {
      out.min.set(0, 0, 0);
      out.max.set(0, 0, 0);
      out.center.set(0, 0, 0);
      return;
    }

    const targets = geometry.morphTargets;
    const targetCount = targets ? Math.min(targets.length, weights.length) : 0;

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let v = 0; v < vertCount; v++) {
      const o = v * 3;
      let x = basePos[o]!;
      let y = basePos[o + 1]!;
      let z = basePos[o + 2]!;
      if (targets) {
        for (let t = 0; t < targetCount; t++) {
          const w = weights[t]!;
          if (Math.abs(w) <= DEFAULT_WEIGHT_EPSILON) continue;
          const dPos = targets[t]!.positions;
          if (dPos && o + 2 < dPos.length) {
            x += dPos[o]! * w;
            y += dPos[o + 1]! * w;
            z += dPos[o + 2]! * w;
          }
        }
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    out.min.set(minX, minY, minZ);
    out.max.set(maxX, maxY, maxZ);
    out.center.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
  }
}
