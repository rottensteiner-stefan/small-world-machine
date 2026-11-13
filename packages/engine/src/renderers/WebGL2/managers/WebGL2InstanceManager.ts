import type { InstancedMesh, Object3D } from "../../../core/index.js";
import type { Topology, WireframeMode } from "../../../enums/index.js";
import { Topology as TopologyEnum } from "../../../enums/index.js";
import type { GeometryDataInterface } from "../../../interfaces/index.js";
import { groupByGeometryForInstancing } from "../../AutoInstancing.js";
import type { GLLineRibbon, Mesh } from "../../Mesh.js";
import type { WebGLBufferManager } from "../../gl/managers/WebGLBufferManager.js";
import type { WebGLProgramCacheEntry } from "../../gl/managers/WebGLProgramCache.js";

/** `u_model` of an auto-instancing run (ADR 0046): the instance matrices carry the transforms. */
const IDENTITY_MATRIX: Float32Array = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

/** Consolidated WebGL2 GPU state for a single `InstancedMesh`. Replaces 6 separate WeakMaps. */
export interface WebGL2InstanceState {
  matrixBuf: WebGLBuffer | undefined;
  matrixBytes: number;
  matricesUploaded: number;
  dataBuf: WebGLBuffer | undefined;
  dataBytes: number;
  dataUploaded: number;
}

/**
 * Owns WebGL2 per-`InstancedMesh` GPU buffer state and ADR 0046 auto-instancing run staging/
 * scratch buffers, keeping per-frame instanced draws allocation-free.
 */
export class WebGL2InstanceManager {
  private _instanceState: WeakMap<InstancedMesh, WebGL2InstanceState> = new WeakMap();
  /** Auto-instancing (ADR 0046): one streamed matrix buffer for every run, plus its CPU staging. */
  private _runMatrixBuffer: WebGLBuffer | undefined = undefined;
  private _runStaging: Float32Array = new Float32Array(1024 * 16);

  // Reused scratch outputs for batch partitioning & run building (no per-frame allocation).
  private readonly _scratchRunObjects: Object3D[] = [];
  private readonly _scratchRuns: number[] = [];
  private readonly _scratchRunRest: Object3D[] = [];
  private readonly _scratchInstancedObjects: Object3D[] = [];
  private readonly _scratchStandardObjects: Object3D[] = [];

  /** ADR 0046 A2: geometry-ordinal scratch so `groupByGeometryForInstancing` stays allocation-free. */
  private readonly _geometryOrdinals: WeakMap<GeometryDataInterface, number> = new WeakMap();
  private _geometryOrdinalSeed = 0;

  public get scratchRunObjects(): Object3D[] {
    return this._scratchRunObjects;
  }

  public get scratchRuns(): number[] {
    return this._scratchRuns;
  }

  public get scratchRunRest(): Object3D[] {
    return this._scratchRunRest;
  }

  public get scratchInstancedObjects(): Object3D[] {
    return this._scratchInstancedObjects;
  }

  public get scratchStandardObjects(): Object3D[] {
    return this._scratchStandardObjects;
  }

  /** Exposed for unit tests inspecting consolidated state. */
  public get instanceStateMap(): WeakMap<InstancedMesh, WebGL2InstanceState> {
    return this._instanceState;
  }

  /** Reorders eligible standard objects stably by geometry ordinal for longest instancing runs. */
  public groupByGeometry(objects: Object3D[]): void {
    this._geometryOrdinalSeed = groupByGeometryForInstancing(
      objects,
      this._geometryOrdinals,
      this._geometryOrdinalSeed,
    );
  }

  /**
   * Instanced draw for one `InstancedMesh`: upper-bound validation, manual attribute setup on the
   * DEFAULT VAO, instanced draw, and attribute divisor reset.
   */
  public renderInstancedObject(
    gl: WebGL2RenderingContext,
    geometry: WebGLBufferManager,
    instMesh: InstancedMesh,
    cache: WebGLProgramCacheEntry,
    topology: Topology,
    wireframeMode?: WireframeMode,
    ribbon?: GLLineRibbon,
  ): void {
    if (instMesh.instanceCount < 0) {
      throw new Error(`[WebGL2Renderer] Invalid instanceCount: ${instMesh.instanceCount}`);
    }
    if (instMesh.instanceCount === 0) {
      return;
    }
    if (instMesh.instanceMatrices.byteLength < instMesh.instanceCount * 64) {
      throw new Error(
        `[WebGL2Renderer] InstancedMesh matrix buffer too small: required at least ${instMesh.instanceCount * 64} bytes for ${instMesh.instanceCount} instances, but buffer is ${instMesh.instanceMatrices.byteLength} bytes.`,
      );
    }
    if (instMesh.instanceData && instMesh.instanceData.byteLength < instMesh.instanceCount * 16) {
      throw new Error(
        `[WebGL2Renderer] InstancedMesh instanceData buffer too small: required at least ${instMesh.instanceCount * 16} bytes for ${instMesh.instanceCount} instances, but buffer is ${instMesh.instanceData.byteLength} bytes.`,
      );
    }

    gl.bindVertexArray(null);

    const uModel = cache.uniforms.get("u_model");
    if (uModel) gl.uniformMatrix4fv(uModel, false, instMesh.worldMatrix.data);

    let state = this._instanceState.get(instMesh);
    if (!state) {
      state = {
        matrixBuf: undefined,
        matrixBytes: 0,
        matricesUploaded: 0,
        dataBuf: undefined,
        dataBytes: 0,
        dataUploaded: 0,
      };
      this._instanceState.set(instMesh, state);
    }

    const matrixByteLength = instMesh.instanceMatrices.byteLength;
    if (!state.matrixBuf || state.matrixBytes < matrixByteLength) {
      state.matrixBuf ??= gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, state.matrixBuf);
      if (typeof gl.bufferSubData === "function") {
        gl.bufferData(gl.ARRAY_BUFFER, matrixByteLength, gl.DYNAMIC_DRAW);
      } else {
        gl.bufferData(gl.ARRAY_BUFFER, instMesh.instanceMatrices, gl.DYNAMIC_DRAW);
      }
      state.matrixBytes = matrixByteLength;
      state.matricesUploaded = 0;
      instMesh.instanceMatrixNeedsUpdate = true;
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.matrixBuf);
    }

    if (instMesh.instanceMatrixNeedsUpdate || instMesh.instanceCount > state.matricesUploaded) {
      if (typeof gl.bufferSubData === "function") {
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          0,
          instMesh.instanceMatrices,
          0,
          instMesh.instanceCount * 16,
        );
      } else {
        gl.bufferData(gl.ARRAY_BUFFER, instMesh.instanceMatrices, gl.DYNAMIC_DRAW);
      }
      state.matricesUploaded = instMesh.instanceMatrixNeedsUpdate
        ? instMesh.instanceCount
        : Math.max(state.matricesUploaded, instMesh.instanceCount);
      instMesh.instanceMatrixNeedsUpdate = false;
    }

    let dataBuf: WebGLBuffer | undefined;
    if (instMesh.instanceData && cache.attributes.has("a_instanceData")) {
      const dataByteLength = instMesh.instanceData.byteLength;
      if (!state.dataBuf || state.dataBytes < dataByteLength) {
        state.dataBuf ??= gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, state.dataBuf);
        if (typeof gl.bufferSubData === "function") {
          gl.bufferData(gl.ARRAY_BUFFER, dataByteLength, gl.DYNAMIC_DRAW);
        } else {
          gl.bufferData(gl.ARRAY_BUFFER, instMesh.instanceData, gl.DYNAMIC_DRAW);
        }
        state.dataBytes = dataByteLength;
        state.dataUploaded = 0;
        instMesh.instanceDataNeedsUpdate = true;
      }
      dataBuf = state.dataBuf;

      if (instMesh.instanceDataNeedsUpdate || instMesh.instanceCount > state.dataUploaded) {
        const stride = instMesh.instanceDataSize || 4;
        gl.bindBuffer(gl.ARRAY_BUFFER, dataBuf);
        if (typeof gl.bufferSubData === "function") {
          gl.bufferSubData(
            gl.ARRAY_BUFFER,
            0,
            instMesh.instanceData,
            0,
            instMesh.instanceCount * stride,
          );
        } else {
          gl.bufferData(gl.ARRAY_BUFFER, instMesh.instanceData, gl.DYNAMIC_DRAW);
        }
        state.dataUploaded = instMesh.instanceDataNeedsUpdate
          ? instMesh.instanceCount
          : Math.max(state.dataUploaded, instMesh.instanceCount);
        instMesh.instanceDataNeedsUpdate = false;
      }
    }

    const mesh = geometry.getOrCreateMesh(instMesh, instMesh.geometry!);
    this._drawInstanced(
      gl,
      mesh,
      cache,
      state.matrixBuf,
      instMesh.instanceCount,
      topology,
      wireframeMode,
      ribbon,
      dataBuf,
      instMesh.instanceDataSize,
    );
  }

  /**
   * Automatic instancing (ADR 0046): draws `objects[start..end)` (same geometry) as one instanced
   * draw with an identity `u_model`; each object's world matrix is uploaded as its instance matrix.
   */
  public renderInstanceRun(
    gl: WebGL2RenderingContext,
    geometry: WebGLBufferManager,
    objects: readonly Object3D[],
    start: number,
    end: number,
    cache: WebGLProgramCacheEntry,
    topology: Topology,
    wireframeMode?: WireframeMode,
  ): void {
    const count = end - start;
    if (this._runStaging.length < count * 16) this._runStaging = new Float32Array(count * 32);
    const staging = this._runStaging;
    let mesh: Mesh | undefined;
    for (let i = 0; i < count; i++) {
      const o = objects[start + i]!;
      staging.set(o.worldMatrix.data, i * 16);
      mesh = geometry.getOrCreateMesh(o, o.geometry!);
    }

    gl.bindVertexArray(null);
    const uModel = cache.uniforms.get("u_model");
    if (uModel) gl.uniformMatrix4fv(uModel, false, IDENTITY_MATRIX);

    this._runMatrixBuffer ??= gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._runMatrixBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, staging.subarray(0, count * 16), gl.STREAM_DRAW);

    this._drawInstanced(gl, mesh!, cache, this._runMatrixBuffer, count, topology, wireframeMode);
  }

  /** Deletes the per-instance matrix/data GL buffers of a removed `InstancedMesh`. */
  public releaseInstanceBuffers(gl: WebGL2RenderingContext, instMesh: InstancedMesh): void {
    const state = this._instanceState.get(instMesh);
    if (!state) return;
    if (state.matrixBuf) gl.deleteBuffer(state.matrixBuf);
    if (state.dataBuf) gl.deleteBuffer(state.dataBuf);
    this._instanceState.delete(instMesh);
  }

  public resetOnContextRestored(): void {
    this._instanceState = new WeakMap();
    this._runMatrixBuffer = undefined;
  }

  public destroy(gl: WebGL2RenderingContext): void {
    if (this._runMatrixBuffer) gl.deleteBuffer(this._runMatrixBuffer);
    this._runMatrixBuffer = undefined;
    this._instanceState = new WeakMap();
  }

  private _drawInstanced(
    gl: WebGL2RenderingContext,
    mesh: Mesh,
    cache: WebGLProgramCacheEntry,
    matrixBuf: WebGLBuffer,
    count: number,
    topology: Topology,
    wireframeMode?: WireframeMode,
    ribbon?: GLLineRibbon,
    dataBuf?: WebGLBuffer,
    dataSize: number = 4,
  ): void {
    if (ribbon) {
      mesh.bindLineRibbon(ribbon);
    } else {
      mesh.bind(
        cache.attributes.get("a_position")!,
        cache.attributes.get("a_normal")!,
        cache.attributes.get("a_uv")!,
        cache.attributes.get("a_tangent")!,
        cache.attributes.get("a_joints") ?? -1,
        cache.attributes.get("a_weights") ?? -1,
      );
    }

    const loc = cache.attributes.get("a_instanceMatrix");
    if (loc !== undefined && loc >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, matrixBuf);
      for (let i = 0; i < 4; i++) {
        const attribLoc = loc + i;
        gl.enableVertexAttribArray(attribLoc);
        gl.vertexAttribPointer(attribLoc, 4, gl.FLOAT, false, 64, i * 16);
        gl.vertexAttribDivisor(attribLoc, 1);
      }
    }

    const dataLoc = cache.attributes.get("a_instanceData");
    const hasData = dataBuf !== undefined && dataLoc !== undefined && dataLoc >= 0;
    if (hasData) {
      gl.bindBuffer(gl.ARRAY_BUFFER, dataBuf);
      gl.enableVertexAttribArray(dataLoc);
      gl.vertexAttribPointer(dataLoc, dataSize, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(dataLoc, 1);
    }

    const drawMode = topology === TopologyEnum.LINE_LIST ? gl.LINES : gl.TRIANGLES;
    if (ribbon) {
      gl.drawArraysInstanced(gl.TRIANGLES, 0, ribbon.vertexCount, count);
    } else {
      mesh.drawInstanced(drawMode, count, wireframeMode);
    }

    if (loc !== undefined && loc >= 0) {
      for (let i = 0; i < 4; i++) {
        gl.vertexAttribDivisor(loc + i, 0);
        gl.disableVertexAttribArray(loc + i);
      }
    }
    if (hasData) {
      gl.vertexAttribDivisor(dataLoc, 0);
      gl.disableVertexAttribArray(dataLoc);
    }
  }
}
