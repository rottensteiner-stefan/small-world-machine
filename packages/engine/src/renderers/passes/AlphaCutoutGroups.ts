import { InstancedMesh } from "../../core/InstancedMesh.js";
import type { Object3D } from "../../core/Object3D.js";
import {
  textureTransformCacheKey,
  type TextureTransform,
} from "../../core/materials/TextureTransform.js";
import type { Texture } from "../../core/textures/index.js";
import { MathUtils } from "../../math/index.js";

/** One `(diffuseMap, alphaTest, diffuseTransform)` group of objects sharing a depth/shadow draw. */
export interface AlphaCutoutGroup {
  /** Stable synthetic `matUuid` per `(diffuseMap, alphaTest, diffuseTransform)` tuple, reused across frames. */
  groupUuid: string;
  diffuseMap: Texture | undefined;
  alphaTest: number;
  diffuseTransform: TextureTransform | undefined;
  standard: Object3D[];
  instanced: InstancedMesh[];
}

/**
 * Pooled per-batch grouping for alpha-cutout geometry across WebGPU depth pre-pass, cascaded
 * directional shadow / EVSM passes, and spot/point shadow passes. Keying by
 * `(diffuseMap, alphaTest, diffuseTransform)` prevents shared-texture `u_uvTransforms` uniform
 * buffer overwrites when `queue.writeBuffer` runs prior to submit. Zero-GC after warmup.
 */
export class AlphaCutoutGroups {
  /** Active groups accumulated for the batch currently being processed (array for zero-alloc loop). */
  public readonly active: AlphaCutoutGroup[] = [];

  private readonly _byKey = new Map<string, AlphaCutoutGroup>();
  private readonly _pool: AlphaCutoutGroup[] = [];
  private _poolSize = 0;
  private readonly _texIds = new WeakMap<Texture, number>();
  private _nextTexId = 1;
  private readonly _groupUuids = new Map<string, string>();

  /** Recycles all active groups back into the pool at the start of each batch. */
  public recycle(): void {
    for (let i = 0; i < this.active.length; i++) {
      const group = this.active[i]!;
      group.standard.length = 0;
      group.instanced.length = 0;
      group.diffuseMap = undefined;
      group.diffuseTransform = undefined;
      if (this._poolSize < this._pool.length) {
        this._pool[this._poolSize++] = group;
      } else {
        this._pool.push(group);
      }
    }
    this.active.length = 0;
    this._byKey.clear();
  }

  /** Adds an alpha-cutout object to the matching `(diffuseMap, alphaTest, diffuseTransform)` group. */
  public add(
    obj: Object3D,
    diffuseMap: Texture,
    alphaTest: number,
    diffuseTransform: TextureTransform | undefined,
  ): void {
    let texId = this._texIds.get(diffuseMap);
    if (texId === undefined) {
      texId = this._nextTexId++;
      this._texIds.set(diffuseMap, texId);
    }
    const key = `${texId}|${alphaTest}|${textureTransformCacheKey(diffuseTransform)}`;
    let group = this._byKey.get(key);
    if (!group) {
      let groupUuid = this._groupUuids.get(key);
      if (!groupUuid) {
        groupUuid = MathUtils.generateUUID();
        this._groupUuids.set(key, groupUuid);
      }
      if (this._poolSize > 0) {
        group = this._pool[--this._poolSize]!;
      } else {
        group = {
          groupUuid: "",
          diffuseMap: undefined,
          alphaTest: 0,
          diffuseTransform: undefined,
          standard: [],
          instanced: [],
        };
      }
      group.groupUuid = groupUuid;
      group.diffuseMap = diffuseMap;
      group.alphaTest = alphaTest;
      group.diffuseTransform = diffuseTransform;
      this._byKey.set(key, group);
      this.active.push(group);
    }
    if (obj instanceof InstancedMesh) {
      group.instanced.push(obj);
    } else {
      group.standard.push(obj);
    }
  }
}
