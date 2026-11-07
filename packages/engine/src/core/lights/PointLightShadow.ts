import type { PointLight } from "./PointLight.js";
import { Matrix4, Vector3D } from "../../math/index.js";

/**
 * Shared core of point-light shadows (ADR 0052): every shadowed point light is rendered as six
 * 90° perspective cube faces stored as extra layers of the spot-shadow array, so both renderers
 * reuse the spot pass, the comparison sampler and PCF/PCSS. This module is the single source for
 * layer layout, face matrices, face selection and caster choice; the WGSL/GLSL face pick must
 * match {@link cubeFaceForDirection}.
 */

/** @fixed spot-shadow slots that keep layers 0..3 of the shared array. */
export const SPOT_SHADOW_LAYERS = 4;
/** @fixed shadowed point lights per frame (ADR 0052); quality tiers may use fewer. */
export const MAX_SHADOWED_POINT_LIGHTS = 2;
/** @fixed faces of a shadow cube. */
export const CUBE_FACE_COUNT = 6;
/** @derived total layers of the shared spot/point shadow array. */
export const SHADOW_ARRAY_LAYERS = SPOT_SHADOW_LAYERS + MAX_SHADOWED_POINT_LIGHTS * CUBE_FACE_COUNT;
/** @fixed near plane of every cube face in meters; small, because fires sit right next to walls. */
export const POINT_SHADOW_NEAR = 0.05;

/** Face order +X, -X, +Y, -Y, +Z, -Z (index = layer offset within one light). */
const FACE_DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
// Up vectors only need to be non-parallel to the face direction and consistent with the matrices
// below: shaders never sample these layers as a hardware cube map, they project with the face VP.
const FACE_UPS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 0],
];

/** Array layer of `face` of the point light in shadow slot `slot`. */
export function pointShadowLayer(slot: number, face: number): number {
  return SPOT_SHADOW_LAYERS + slot * CUBE_FACE_COUNT + face;
}

/**
 * Cube face that a light-to-fragment direction falls into: the major axis, ties resolved X before
 * Y before Z. Reference for the shader implementations (`pointShadowFace` in WGSL/GLSL).
 */
export function cubeFaceForDirection(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) {
    return x >= 0 ? 0 : 1;
  }
  if (ay >= az) {
    return y >= 0 ? 2 : 3;
  }
  return z >= 0 ? 4 : 5;
}

const _proj = new Matrix4();
const _view = new Matrix4();
const _viewProj = new Matrix4();
const _target = new Vector3D();
const _up = new Vector3D();

/**
 * Writes the six face view-projection matrices (GL clip space, column-major, 16 floats each, face
 * order as {@link cubeFaceForDirection}) for a light at `position` reaching `far` meters into
 * `out` starting at `offset`. WebGPU applies its usual Z-range correction on top. Zero-alloc.
 */
export function writePointShadowFaceMatrices(
  position: Vector3D,
  far: number,
  out: Float32Array,
  offset: number = 0,
): void {
  Matrix4.perspective(
    Math.PI / 2,
    1,
    POINT_SHADOW_NEAR,
    Math.max(far, POINT_SHADOW_NEAR * 2),
    _proj,
  );
  for (let face = 0; face < CUBE_FACE_COUNT; face++) {
    const d = FACE_DIRECTIONS[face]!;
    const u = FACE_UPS[face]!;
    _target.set(position.x + d[0], position.y + d[1], position.z + d[2]);
    _up.set(u[0], u[1], u[2]);
    Matrix4.lookAt(position, _target, _up, _view);
    Matrix4.multiply(_proj, _view, _viewProj);
    out.set(_viewProj.data, offset + face * 16);
  }
}

const _toLight = new Vector3D();
const _worldPosition = new Vector3D();

/**
 * Chooses up to `max` shadow-casting point lights (`castShadow`) from `lights` and writes their
 * indices into `outIndices`, nearest first; returns how many were chosen. A light whose whole range
 * lies behind the camera ranks after every light that can reach the view (same rule as the fire
 * light budget). `forward` must be normalised. Requires current world matrices. Zero-alloc.
 */
export function selectShadowedPointLights(
  lights: readonly PointLight[],
  cameraPosition: Vector3D,
  forward: Vector3D,
  max: number,
  outIndices: Int32Array,
): number {
  const limit = Math.min(max, outIndices.length);
  let chosen = 0;
  while (chosen < limit) {
    let best = -1;
    let bestRank = Infinity;
    for (let i = 0; i < lights.length; i++) {
      const light = lights[i]!;
      if (!light.castShadow || !light.isVisible || isChosen(outIndices, chosen, i)) {
        continue;
      }
      const rank = rankLight(light, cameraPosition, forward);
      if (rank < bestRank) {
        bestRank = rank;
        best = i;
      }
    }
    if (best < 0) {
      break;
    }
    outIndices[chosen++] = best;
  }
  return chosen;
}

/** @fixed rank offset for lights entirely behind the camera. */
const BEHIND_CAMERA_PENALTY = 1e12;

function rankLight(light: PointLight, cameraPosition: Vector3D, forward: Vector3D): number {
  const offset = _toLight.copyFrom(light.getWorldPosition(_worldPosition)).sub(cameraPosition);
  const distanceSq = offset.lengthSq();
  return offset.dot(forward) < -light.distance ? BEHIND_CAMERA_PENALTY + distanceSq : distanceSq;
}

function isChosen(indices: Int32Array, count: number, index: number): boolean {
  for (let k = 0; k < count; k++) {
    if (indices[k] === index) return true;
  }
  return false;
}
