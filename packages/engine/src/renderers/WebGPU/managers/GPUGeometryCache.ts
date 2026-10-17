import type { Object3D } from "../../../core/index.js";
import type { GeometryDataInterface } from "../../../interfaces/index.js";

export interface WebGPUGeoCacheEntry {
  vb: GPUBuffer;
  nb: GPUBuffer | undefined;
  uvb: GPUBuffer | undefined;
  tb: GPUBuffer | undefined;
  cb: GPUBuffer | undefined;
  jb: GPUBuffer | undefined;
  wb: GPUBuffer | undefined;
  ib: GPUBuffer | undefined;
  wib: GPUBuffer | undefined;
  indexCount: number;
  wireframeIndexCount: number;
  vertexCount: number;
  format: GPUIndexFormat | undefined;
  /** Number of live Object3D instances currently referencing this geometry. */
  refCount: number;
}

/**
 * Per-`GeometryDataInterface` GPU vertex/index buffer cache, with refcounting so geometry shared
 * across many objects (or swapped on a live object at runtime) is only uploaded once and only
 * destroyed once nothing references it anymore.
 *
 * Extracted from `WebGPURenderer` -- see .agents/collaborate/god-objects-refactoring.md Phase 4.
 * No behavior change.
 */
export class GPUGeometryCache {
  private readonly _device: GPUDevice;

  private _geoCache = new Map<GeometryDataInterface, WebGPUGeoCacheEntry>();
  private _lastKnownGeometry = new WeakMap<Object3D, GeometryDataInterface>();

  constructor(device: GPUDevice) {
    this._device = device;
  }

  public getGeoCache(obj: Object3D, geo: GeometryDataInterface): WebGPUGeoCacheEntry {
    let c = this._geoCache.get(geo);
    if (!c || geo.needsUpdate) {
      const createBuf = (data: ArrayBufferView, usage: number): GPUBuffer => {
        const b = this._device.createBuffer({
          size: (data.byteLength + 3) & ~3,
          usage,
          mappedAtCreation: true,
        });
        new Uint8Array(b.getMappedRange()).set(
          new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        );
        b.unmap();
        return b;
      };
      if (c && geo.needsUpdate) {
        this._device.queue.writeBuffer(c.vb, 0, geo.vertices);
        if (c.nb && geo.normals) this._device.queue.writeBuffer(c.nb, 0, geo.normals);
        if (c.tb && geo.tangents?.length) this._device.queue.writeBuffer(c.tb, 0, geo.tangents);
        if (c.cb && geo.colors?.length) this._device.queue.writeBuffer(c.cb, 0, geo.colors);
        geo.needsUpdate = false;
        this._acquireGeoCache(obj, geo, c);
        return c;
      }
      c = {
        vb: createBuf(geo.vertices, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST),
        nb: geo.normals?.length
          ? createBuf(geo.normals, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST)
          : undefined,
        uvb: geo.uvs?.length ? createBuf(geo.uvs, GPUBufferUsage.VERTEX) : undefined,
        tb: geo.tangents?.length
          ? createBuf(geo.tangents, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST)
          : undefined,
        cb: geo.colors?.length
          ? createBuf(geo.colors, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST)
          : undefined,
        jb: geo.joints?.length
          ? createBuf(
              geo.joints instanceof Float32Array ? geo.joints : new Float32Array(geo.joints),
              GPUBufferUsage.VERTEX,
            )
          : undefined,
        wb: geo.weights?.length
          ? createBuf(
              geo.weights instanceof Float32Array ? geo.weights : new Float32Array(geo.weights),
              GPUBufferUsage.VERTEX,
            )
          : undefined,
        ib: geo.indices?.length ? createBuf(geo.indices, GPUBufferUsage.INDEX) : undefined,
        wib: geo.wireframeIndices?.length
          ? createBuf(geo.wireframeIndices, GPUBufferUsage.INDEX)
          : undefined,
        indexCount: geo.indices?.length || 0,
        wireframeIndexCount: geo.wireframeIndices?.length || 0,
        vertexCount: geo.vertices.length / 3,
        format:
          geo.indices?.BYTES_PER_ELEMENT === 4 || geo.wireframeIndices?.BYTES_PER_ELEMENT === 4
            ? "uint32"
            : "uint16",
        refCount: 0,
      };
      this._geoCache.set(geo, c);
      geo.needsUpdate = false;
    }
    this._acquireGeoCache(obj, geo, c);
    return c;
  }

  /**
   * Tracks per-object geometry references so `releaseGeometryFor` can correctly
   * free buffers once nothing references them anymore -- even when geometry is shared
   * across many objects (see apps/showcases/19) or swapped on a live object at runtime.
   */
  private _acquireGeoCache(
    obj: Object3D,
    geo: GeometryDataInterface,
    c: WebGPUGeoCacheEntry,
  ): void {
    const lastGeo = this._lastKnownGeometry.get(obj);
    if (lastGeo !== geo) {
      if (lastGeo) this.releaseGeometryFor(obj);
      c.refCount++;
      this._lastKnownGeometry.set(obj, geo);
    }
  }

  /**
   * Releases the GPU geometry buffers this object was referencing, if its refCount
   * drops to zero. Called once per removed object per frame.
   */
  public releaseGeometryFor(obj: Object3D): void {
    const geo = this._lastKnownGeometry.get(obj);
    if (!geo) return;
    this._lastKnownGeometry.delete(obj);

    const c = this._geoCache.get(geo);
    if (!c) return;
    c.refCount--;
    if (c.refCount <= 0) {
      c.vb.destroy();
      c.nb?.destroy();
      c.uvb?.destroy();
      c.tb?.destroy();
      c.cb?.destroy();
      c.jb?.destroy();
      c.wb?.destroy();
      c.ib?.destroy();
      c.wib?.destroy();
      this._geoCache.delete(geo);
    }
  }

  public dispose(): void {
    for (const c of this._geoCache.values()) {
      c.vb.destroy();
      c.nb?.destroy();
      c.uvb?.destroy();
      c.tb?.destroy();
      c.cb?.destroy();
      c.jb?.destroy();
      c.wb?.destroy();
      c.ib?.destroy();
      c.wib?.destroy();
    }
    this._geoCache.clear();
  }
}
