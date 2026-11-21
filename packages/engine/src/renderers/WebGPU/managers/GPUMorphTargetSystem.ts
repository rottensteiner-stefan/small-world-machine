import type { Object3D } from "../../../core/index.js";
import type { Scene, RenderList } from "../../../core/Scene.js";
import { isInstancedMesh } from "../../../core/InstancedMesh.js";
import { MorphTargetBlender } from "../../../core/animation/index.js";
import type { GeometryDataInterface } from "../../../interfaces/index.js";
import morphBlendWGSL from "../../shaders/source/web_gpu/compute/morph_blend.wgsl?raw";

const WORKGROUP_SIZE = 64;
const NO_DELTA = 0xffffffff;
const PARAMS_BYTES = 32;

/** Per-object morphed vertex buffers returned to the render loop. */
export interface GPUMorphOutputBuffers {
  vb: GPUBuffer;
  nb: GPUBuffer | undefined;
  tb: GPUBuffer | undefined;
}

interface StaticMorphGeoEntry {
  vertexCount: number;
  targetCount: number;
  hasNormals: boolean;
  hasTangents: boolean;
  baseNormOffset: number;
  baseTanOffset: number;
  baseBuffer: GPUBuffer;
  deltaBuffer: GPUBuffer;
  metaBuffer: GPUBuffer;
  refCount: number;
}

interface ObjectMorphEntry {
  geo: GeometryDataInterface;
  outPos: GPUBuffer;
  outNorm: GPUBuffer | undefined;
  outTan: GPUBuffer | undefined;
  weightsBuffer: GPUBuffer;
  paramsBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
  cachedWeights: Float32Array;
  stagingWeights: Float32Array;
  output: GPUMorphOutputBuffers;
  hasComputedOnce: boolean;
}

/**
 * WebGPU compute pre-pass morph target system (AN09).
 * Blends position, normal, and tangent deltas once per frame before shadow and main passes,
 * skipping allocation/dispatch on untouched zero-weight meshes and returning to base pose
 * once when weights reset to zero.
 */
export class GPUMorphTargetSystem {
  private readonly _device: GPUDevice;
  private readonly _pipeline: GPUComputePipeline;
  private readonly _bindGroupLayout: GPUBindGroupLayout;
  private readonly _dummyReadStorage: GPUBuffer;
  private readonly _dummyReadWriteStorage: GPUBuffer;

  private readonly _geoEntries = new Map<GeometryDataInterface, StaticMorphGeoEntry>();
  private readonly _objEntries = new Map<Object3D, ObjectMorphEntry>();
  private readonly _visitedThisFrame = new Set<Object3D>();
  private readonly _dirtyObjects: ObjectMorphEntry[] = [];
  private readonly _paramsScratch = new Uint32Array(8);
  private _disposed = false;

  constructor(device: GPUDevice) {
    this._device = device;

    this._bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });

    const shaderModule = device.createShaderModule({ code: morphBlendWGSL });
    void shaderModule.getCompilationInfo().then((info) => {
      for (let i = 0; i < info.messages.length; i++) {
        const msg = info.messages[i]!;
        if (msg.type === "error") {
          console.error(
            `[GPUMorphTargetSystem] WGSL line ${msg.lineNum}:${msg.linePos}: ${msg.message}`,
          );
        }
      }
    });

    this._pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: "main" },
    });

    this._dummyReadStorage = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE,
    });
    this._dummyReadWriteStorage = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE,
    });
  }

  /**
   * Collects dirty morphed objects visible in the main view (and active shadow casters in `scene`)
   * and records one compute pass before any shadow/depth/main render pass runs.
   */
  public prepareFrame(
    encoder: GPUCommandEncoder,
    renderList: RenderList,
    scene: Scene,
    hasShadows: boolean,
  ): void {
    if (this._disposed) return;

    this._visitedThisFrame.clear();
    let dirtyCount = 0;

    const batches = renderList.opaqueBatches;
    for (let i = 0; i < batches.length; i++) {
      const objs = batches[i]!.objects;
      for (let j = 0; j < objs.length; j++) {
        const entry = this._evaluateObject(objs[j]!);
        if (entry) this._dirtyObjects[dirtyCount++] = entry;
      }
    }

    const transparent = renderList.transparent;
    for (let i = 0; i < transparent.length; i++) {
      const entry = this._evaluateObject(transparent[i]!);
      if (entry) this._dirtyObjects[dirtyCount++] = entry;
    }

    if (hasShadows) {
      dirtyCount = this._collectShadowCasters(scene.root, dirtyCount);
    }

    this._dirtyObjects.length = dirtyCount;
    if (dirtyCount === 0) return;

    const pass = encoder.beginComputePass();
    pass.setPipeline(this._pipeline);
    for (let i = 0; i < dirtyCount; i++) {
      const entry = this._dirtyObjects[i]!;
      const geoEntry = this._geoEntries.get(entry.geo)!;
      if (geoEntry.vertexCount === 0) continue;
      pass.setBindGroup(0, entry.bindGroup);
      pass.dispatchWorkgroups(Math.ceil(geoEntry.vertexCount / WORKGROUP_SIZE));
    }
    pass.end();
    this._dirtyObjects.length = 0;
  }

  private _collectShadowCasters(node: Object3D, dirtyCount: number): number {
    if (!node.isVisible) return dirtyCount;
    if (node.castShadow && node.material && node.geometry?.morphTargets?.length) {
      const entry = this._evaluateObject(node);
      if (entry) this._dirtyObjects[dirtyCount++] = entry;
    }
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      dirtyCount = this._collectShadowCasters(children[i]!, dirtyCount);
    }
    return dirtyCount;
  }

  /** Returns the morphed vertex buffers for `obj` if it currently holds an active morphed pose. */
  public getMorphedBuffers(obj: Object3D): GPUMorphOutputBuffers | undefined {
    const entry = this._objEntries.get(obj);
    if (!entry || !entry.hasComputedOnce) return undefined;
    if (entry.geo !== obj.geometry) return undefined;
    return entry.output;
  }

  /** Releases per-object morph buffers and decrements refCount on shared static geometry buffers. */
  public releaseObject(obj: Object3D): void {
    const entry = this._objEntries.get(obj);
    if (!entry) return;
    this._objEntries.delete(obj);
    this._destroyObjectEntry(entry);
    this._releaseStaticGeo(entry.geo);
  }

  /** Destroys every GPU buffer owned by the system. */
  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const entry of this._objEntries.values()) {
      this._destroyObjectEntry(entry);
    }
    this._objEntries.clear();

    for (const geoEntry of this._geoEntries.values()) {
      geoEntry.baseBuffer.destroy();
      geoEntry.deltaBuffer.destroy();
      geoEntry.metaBuffer.destroy();
    }
    this._geoEntries.clear();
    this._visitedThisFrame.clear();
    this._dirtyObjects.length = 0;
    this._dummyReadStorage.destroy();
    this._dummyReadWriteStorage.destroy();
  }

  private _evaluateObject(obj: Object3D): ObjectMorphEntry | undefined {
    if (this._visitedThisFrame.has(obj)) return undefined;
    this._visitedThisFrame.add(obj);

    const geo = obj.geometry;
    if (!geo || !geo.morphTargets || geo.morphTargets.length === 0 || isInstancedMesh(obj)) {
      if (this._objEntries.has(obj)) this.releaseObject(obj);
      return undefined;
    }

    const vertexCount = Math.floor(geo.vertices.length / 3);
    if (vertexCount === 0) return undefined;

    const existing = this._objEntries.get(obj);
    const influences = obj.morphTargetInfluences;
    const hasActive = MorphTargetBlender.hasActiveWeights(influences);

    // Untouched mesh starting in exact bind pose: skip buffer allocation & compute dispatch.
    if (!existing && !hasActive) return undefined;

    let entry = existing;
    if (!entry || entry.geo !== geo) {
      if (entry) {
        this._destroyObjectEntry(entry);
        this._releaseStaticGeo(entry.geo);
        this._objEntries.delete(obj);
      }
      if (!hasActive) return undefined;
      entry = this._createObjectEntry(obj, geo);
    }

    const staticGeo = this._geoEntries.get(geo)!;
    const targetCount = staticGeo.targetCount;
    if (
      entry.hasComputedOnce &&
      !MorphTargetBlender.weightsDiffer(influences, entry.cachedWeights, targetCount)
    ) {
      return undefined;
    }

    const staging = entry.stagingWeights;
    for (let t = 0; t < targetCount; t++) {
      const w = influences && t < influences.length ? influences[t]! : 0;
      staging[t] = w;
      entry.cachedWeights[t] = w;
    }
    this._device.queue.writeBuffer(entry.weightsBuffer, 0, staging);
    entry.hasComputedOnce = true;
    return entry;
  }

  private _getOrCreateStaticGeo(geo: GeometryDataInterface): StaticMorphGeoEntry {
    let staticGeo = this._geoEntries.get(geo);
    if (staticGeo) {
      staticGeo.refCount++;
      return staticGeo;
    }

    const vertexCount = Math.floor(geo.vertices.length / 3);
    const targets = geo.morphTargets!;
    const targetCount = targets.length;
    const hasNormals = (geo.normals?.length ?? 0) >= vertexCount * 3;
    const hasTangents = (geo.tangents?.length ?? 0) >= vertexCount * 4;

    const basePosFloats = vertexCount * 3;
    const baseNormFloats = hasNormals ? vertexCount * 3 : 0;
    const baseTanFloats = hasTangents ? vertexCount * 4 : 0;
    const baseNormOffset = basePosFloats;
    const baseTanOffset = basePosFloats + baseNormFloats;

    const baseData = new Float32Array(Math.max(4, basePosFloats + baseNormFloats + baseTanFloats));
    baseData.set(geo.vertices.subarray(0, basePosFloats), 0);
    if (hasNormals) baseData.set(geo.normals!.subarray(0, baseNormFloats), baseNormOffset);
    if (hasTangents) baseData.set(geo.tangents!.subarray(0, baseTanFloats), baseTanOffset);

    let totalDeltaSlices = 0;
    for (let t = 0; t < targetCount; t++) {
      const trg = targets[t]!;
      if (trg.positions && trg.positions.length > 0) totalDeltaSlices++;
      if (hasNormals && trg.normals && trg.normals.length > 0) totalDeltaSlices++;
      if (hasTangents && trg.tangents && trg.tangents.length > 0) totalDeltaSlices++;
    }

    const sliceFloats = vertexCount * 3;
    const deltaData = new Float32Array(Math.max(4, totalDeltaSlices * sliceFloats));
    const metaData = new Uint32Array(Math.max(4, targetCount * 4));
    let deltaCursor = 0;

    for (let t = 0; t < targetCount; t++) {
      const trg = targets[t]!;
      const m4 = t * 4;
      if (trg.positions && trg.positions.length > 0) {
        metaData[m4] = deltaCursor;
        const copyLen = Math.min(sliceFloats, trg.positions.length);
        deltaData.set(trg.positions.subarray(0, copyLen), deltaCursor);
        deltaCursor += sliceFloats;
      } else {
        metaData[m4] = NO_DELTA;
      }

      if (hasNormals && trg.normals && trg.normals.length > 0) {
        metaData[m4 + 1] = deltaCursor;
        const copyLen = Math.min(sliceFloats, trg.normals.length);
        deltaData.set(trg.normals.subarray(0, copyLen), deltaCursor);
        deltaCursor += sliceFloats;
      } else {
        metaData[m4 + 1] = NO_DELTA;
      }

      if (hasTangents && trg.tangents && trg.tangents.length > 0) {
        metaData[m4 + 2] = deltaCursor;
        const copyLen = Math.min(sliceFloats, trg.tangents.length);
        deltaData.set(trg.tangents.subarray(0, copyLen), deltaCursor);
        deltaCursor += sliceFloats;
      } else {
        metaData[m4 + 2] = NO_DELTA;
      }
      metaData[m4 + 3] = 0;
    }

    staticGeo = {
      vertexCount,
      targetCount,
      hasNormals,
      hasTangents,
      baseNormOffset,
      baseTanOffset,
      baseBuffer: this._createMappedBuffer(baseData, GPUBufferUsage.STORAGE),
      deltaBuffer: this._createMappedBuffer(deltaData, GPUBufferUsage.STORAGE),
      metaBuffer: this._createMappedBuffer(metaData, GPUBufferUsage.STORAGE),
      refCount: 1,
    };
    this._geoEntries.set(geo, staticGeo);
    return staticGeo;
  }

  private _releaseStaticGeo(geo: GeometryDataInterface): void {
    const staticGeo = this._geoEntries.get(geo);
    if (!staticGeo) return;
    staticGeo.refCount--;
    if (staticGeo.refCount <= 0) {
      staticGeo.baseBuffer.destroy();
      staticGeo.deltaBuffer.destroy();
      staticGeo.metaBuffer.destroy();
      this._geoEntries.delete(geo);
    }
  }

  private _createObjectEntry(obj: Object3D, geo: GeometryDataInterface): ObjectMorphEntry {
    const staticGeo = this._getOrCreateStaticGeo(geo);
    const vCount = staticGeo.vertexCount;
    const outUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;

    const outPos = this._device.createBuffer({
      size: Math.max(4, (vCount * 12 + 3) & ~3),
      usage: outUsage,
    });
    const outNorm = staticGeo.hasNormals
      ? this._device.createBuffer({
          size: Math.max(4, (vCount * 12 + 3) & ~3),
          usage: outUsage,
        })
      : undefined;
    const outTan = staticGeo.hasTangents
      ? this._device.createBuffer({
          size: Math.max(4, (vCount * 16 + 3) & ~3),
          usage: outUsage,
        })
      : undefined;

    const weightsBuffer = this._device.createBuffer({
      size: Math.max(4, staticGeo.targetCount * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const paramsBuffer = this._device.createBuffer({
      size: PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const p = this._paramsScratch;
    p[0] = staticGeo.vertexCount;
    p[1] = staticGeo.targetCount;
    p[2] = staticGeo.hasNormals ? 1 : 0;
    p[3] = staticGeo.hasTangents ? 1 : 0;
    p[4] = staticGeo.baseNormOffset;
    p[5] = staticGeo.baseTanOffset;
    p[6] = 0;
    p[7] = 0;
    this._device.queue.writeBuffer(paramsBuffer, 0, p);

    const bindGroup = this._device.createBindGroup({
      layout: this._bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: staticGeo.baseBuffer } },
        {
          binding: 2,
          resource: {
            buffer: staticGeo.deltaBuffer ?? this._dummyReadStorage,
          },
        },
        { binding: 3, resource: { buffer: staticGeo.metaBuffer } },
        { binding: 4, resource: { buffer: weightsBuffer } },
        { binding: 5, resource: { buffer: outPos } },
        { binding: 6, resource: { buffer: outNorm ?? this._dummyReadWriteStorage } },
        { binding: 7, resource: { buffer: outTan ?? this._dummyReadWriteStorage } },
      ],
    });

    const cachedWeights = new Float32Array(staticGeo.targetCount);
    cachedWeights.fill(NaN);

    const entry: ObjectMorphEntry = {
      geo,
      outPos,
      outNorm,
      outTan,
      weightsBuffer,
      paramsBuffer,
      bindGroup,
      cachedWeights,
      stagingWeights: new Float32Array(staticGeo.targetCount),
      output: { vb: outPos, nb: outNorm, tb: outTan },
      hasComputedOnce: false,
    };
    this._objEntries.set(obj, entry);
    return entry;
  }

  private _destroyObjectEntry(entry: ObjectMorphEntry): void {
    entry.outPos.destroy();
    entry.outNorm?.destroy();
    entry.outTan?.destroy();
    entry.weightsBuffer.destroy();
    entry.paramsBuffer.destroy();
  }

  private _createMappedBuffer(data: ArrayBufferView, usage: number): GPUBuffer {
    const buffer = this._device.createBuffer({
      size: Math.max(4, (data.byteLength + 3) & ~3),
      usage,
      mappedAtCreation: true,
    });
    new Uint8Array(buffer.getMappedRange()).set(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
    buffer.unmap();
    return buffer;
  }
}
