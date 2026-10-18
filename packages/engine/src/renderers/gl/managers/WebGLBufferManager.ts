import type { Object3D } from "../../../core/index.js";
import type { GeometryDataInterface } from "../../../interfaces/index.js";
import { Mesh } from "../../Mesh.js";

/**
 * Per-`GeometryDataInterface` GPU mesh (vertex/index buffer) cache, with refcounting so geometry
 * shared across many objects (see apps/showcases/19) -- or swapped on a live object at runtime -- is
 * only uploaded once and only disposed once nothing references it anymore.
 *
 * Extracted from `WebGL2Renderer` -- see .agents/collaborate/god-objects-refactoring.md Phase 4.
 * No behavior change. `Mesh` itself accepts either a WebGL1 or WebGL2 context (shared
 * infrastructure, `src/renderers/Mesh.ts`) but this cache is WebGL2Renderer's own -- WebGL1Renderer
 * keeps its own separate, private `_cache`/`_lastKnownGeometry` fields (not shared state, unlike
 * `AbstractWebGLRenderer._texCache`), so extracting only WebGL2Renderer's copy doesn't affect it.
 */
export class WebGLBufferManager {
  private readonly _gl: WebGLRenderingContext | WebGL2RenderingContext;

  private _cache = new Map<GeometryDataInterface, Mesh>();
  private _lastKnownGeometry = new WeakMap<Object3D, GeometryDataInterface>();

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this._gl = gl;
  }

  /**
   * Looks up (or lazily creates) the GPU mesh for an object's geometry, and tracks
   * per-object geometry references so `releaseGeometryFor` can correctly free
   * buffers once nothing references them anymore -- even when geometry is shared
   * across many objects (see apps/showcases/19) or swapped on a live object at runtime.
   */
  public getOrCreateMesh(obj: Object3D, geo: GeometryDataInterface): Mesh {
    let mesh = this._cache.get(geo);
    if (!mesh) {
      mesh = new Mesh(this._gl, geo);
      this._cache.set(geo, mesh);
    } else if (geo.needsUpdate) {
      mesh.update(geo);
      geo.needsUpdate = false;
    }

    const lastGeo = this._lastKnownGeometry.get(obj);
    if (lastGeo !== geo) {
      if (lastGeo) this.releaseGeometryFor(obj);
      mesh.refCount++;
      this._lastKnownGeometry.set(obj, geo);
    }

    return mesh;
  }

  public releaseGeometryFor(obj: Object3D): void {
    const geo = this._lastKnownGeometry.get(obj);
    if (!geo) return;
    this._lastKnownGeometry.delete(obj);

    const mesh = this._cache.get(geo);
    if (!mesh) return;
    mesh.refCount--;
    if (mesh.refCount <= 0) {
      mesh.dispose();
      this._cache.delete(geo);
    }
  }

  public dispose(): void {
    for (const mesh of this._cache.values()) mesh.dispose();
    this._cache.clear();
  }
}
