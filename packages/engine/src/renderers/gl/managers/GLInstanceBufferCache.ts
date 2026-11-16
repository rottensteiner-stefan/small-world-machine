import type { InstancedMesh } from "../../../core/index.js";

export interface GLInstanceBufferState {
  matrixBuf: WebGLBuffer | undefined;
  matrixBytes: number;
  matricesUploaded: number;
  dataBuf: WebGLBuffer | undefined;
  dataBytes: number;
  dataUploaded: number;
}

type GLContext = WebGLRenderingContext | WebGL2RenderingContext;

export class GLInstanceBufferCache {
  private _stateMap: WeakMap<InstancedMesh, GLInstanceBufferState> = new WeakMap();
  private readonly _buffers: Set<WebGLBuffer> = new Set();

  constructor(private readonly _rangedSubData: boolean) {}

  public get stateMap(): WeakMap<InstancedMesh, GLInstanceBufferState> {
    return this._stateMap;
  }

  public syncMatrixBuffer(gl: GLContext, instMesh: InstancedMesh): WebGLBuffer {
    const state = this._getState(instMesh);
    const matrixByteLength = instMesh.instanceMatrices.byteLength;
    const hasBufferSubData = typeof gl.bufferSubData === "function";

    if (!state.matrixBuf || state.matrixBytes < matrixByteLength) {
      if (!state.matrixBuf) {
        state.matrixBuf = gl.createBuffer()!;
        this._buffers.add(state.matrixBuf);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, state.matrixBuf);
      if (hasBufferSubData) {
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
      this._upload(gl, instMesh.instanceMatrices, instMesh.instanceCount * 16);
      state.matricesUploaded = instMesh.instanceMatrixNeedsUpdate
        ? instMesh.instanceCount
        : Math.max(state.matricesUploaded, instMesh.instanceCount);
      instMesh.instanceMatrixNeedsUpdate = false;
    }

    return state.matrixBuf;
  }

  public syncDataBuffer(gl: GLContext, instMesh: InstancedMesh): WebGLBuffer | undefined {
    const instanceData = instMesh.instanceData;
    if (!instanceData) return undefined;

    const state = this._getState(instMesh);
    const dataByteLength = instanceData.byteLength;
    const hasBufferSubData = typeof gl.bufferSubData === "function";

    if (!state.dataBuf || state.dataBytes < dataByteLength) {
      if (!state.dataBuf) {
        state.dataBuf = gl.createBuffer()!;
        this._buffers.add(state.dataBuf);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, state.dataBuf);
      if (hasBufferSubData) {
        gl.bufferData(gl.ARRAY_BUFFER, dataByteLength, gl.DYNAMIC_DRAW);
      } else {
        gl.bufferData(gl.ARRAY_BUFFER, instanceData, gl.DYNAMIC_DRAW);
      }
      state.dataBytes = dataByteLength;
      state.dataUploaded = 0;
      instMesh.instanceDataNeedsUpdate = true;
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.dataBuf);
    }

    if (instMesh.instanceDataNeedsUpdate || instMesh.instanceCount > state.dataUploaded) {
      const stride = instMesh.instanceDataSize || 4;
      this._upload(gl, instanceData, instMesh.instanceCount * stride);
      state.dataUploaded = instMesh.instanceDataNeedsUpdate
        ? instMesh.instanceCount
        : Math.max(state.dataUploaded, instMesh.instanceCount);
      instMesh.instanceDataNeedsUpdate = false;
    }

    return state.dataBuf;
  }

  public release(gl: GLContext, instMesh: InstancedMesh): void {
    const state = this._stateMap.get(instMesh);
    if (!state) return;
    if (state.matrixBuf) {
      gl.deleteBuffer(state.matrixBuf);
      this._buffers.delete(state.matrixBuf);
    }
    if (state.dataBuf) {
      gl.deleteBuffer(state.dataBuf);
      this._buffers.delete(state.dataBuf);
    }
    this._stateMap.delete(instMesh);
  }

  public resetOnContextRestored(): void {
    this._stateMap = new WeakMap();
    this._buffers.clear();
  }

  public destroy(gl: GLContext): void {
    for (const buffer of this._buffers) gl.deleteBuffer(buffer);
    this._buffers.clear();
    this._stateMap = new WeakMap();
  }

  private _getState(instMesh: InstancedMesh): GLInstanceBufferState {
    let state = this._stateMap.get(instMesh);
    if (!state) {
      state = {
        matrixBuf: undefined,
        matrixBytes: 0,
        matricesUploaded: 0,
        dataBuf: undefined,
        dataBytes: 0,
        dataUploaded: 0,
      };
      this._stateMap.set(instMesh, state);
    }
    return state;
  }

  private _upload(gl: GLContext, data: Float32Array, length: number): void {
    if (this._rangedSubData && typeof gl.bufferSubData === "function") {
      (gl as WebGL2RenderingContext).bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, length);
    } else if (typeof gl.bufferSubData === "function") {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, length));
    } else {
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    }
  }
}
