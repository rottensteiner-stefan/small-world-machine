import type { Vector3D } from "../../math/index.js";

/**
 * Wrapper for a WebGL2 Uniform Buffer Object (UBO).
 */
export class WebGL2UniformBuffer {
  private _gl: WebGL2RenderingContext;
  private _buffer: WebGLBuffer;
  private _data: Float32Array;
  private _int32Data: Int32Array;
  private _bindingPoint: number;

  /**
   * Creates a new Uniform Buffer Object.
   * @param gl The WebGL2 context.
   * @param size The size of the buffer in bytes.
   * @param bindingPoint The binding point to use (e.g., 0).
   */
  constructor(gl: WebGL2RenderingContext, size: number, bindingPoint: number) {
    this._gl = gl;
    this._bindingPoint = bindingPoint;

    // Create underlying buffer
    const buffer = new ArrayBuffer(size);
    this._data = new Float32Array(buffer);
    this._int32Data = new Int32Array(buffer);

    this._buffer = this._gl.createBuffer()!;
    this._gl.bindBuffer(this._gl.UNIFORM_BUFFER, this._buffer);
    this._gl.bufferData(this._gl.UNIFORM_BUFFER, size, this._gl.DYNAMIC_DRAW);
    this._gl.bindBufferBase(this._gl.UNIFORM_BUFFER, this._bindingPoint, this._buffer);
    this._gl.bindBuffer(this._gl.UNIFORM_BUFFER, null);
  }

  /**
   * Sets a float value in the buffer.
   * @param offset The byte offset.
   * @param value The float value.
   */
  public setFloat(offset: number, value: number): void {
    this._data[offset / 4] = value;
  }

  /**
   * Sets an int value in the buffer.
   * @param offset The byte offset.
   * @param value The int value.
   */
  public setInt(offset: number, value: number): void {
    this._int32Data[offset / 4] = value;
  }

  /**
   * Sets a vec2 value in the buffer.
   * @param offset The byte offset.
   * @param x X component.
   * @param y Y component.
   */
  public setVec2(offset: number, x: number, y: number): void {
    const idx = offset / 4;
    this._data[idx] = x;
    this._data[idx + 1] = y;
  }

  /**
   * Sets a vec3 value in the buffer from discrete components without object allocations.
   * @param offset The byte offset.
   * @param x X component.
   * @param y Y component.
   * @param z Z component.
   */
  public setVec3(offset: number, x: number, y: number, z: number): void {
    const idx = offset / 4;
    this._data[idx] = x;
    this._data[idx + 1] = y;
    this._data[idx + 2] = z;
  }

  /**
   * Sets a vec3 value in the buffer.
   * @param offset The byte offset.
   * @param vec The Vector3D value.
   */
  public setVector3(offset: number, vec: Vector3D): void {
    const idx = offset / 4;
    this._data[idx] = vec.x;
    this._data[idx + 1] = vec.y;
    this._data[idx + 2] = vec.z;
  }

  /**
   * Sets a vec4 value in the buffer from discrete components without object allocations.
   * @param offset The byte offset.
   * @param x X component.
   * @param y Y component.
   * @param z Z component.
   * @param w W component.
   */
  public setVec4(offset: number, x: number, y: number, z: number, w: number): void {
    const idx = offset / 4;
    this._data[idx] = x;
    this._data[idx + 1] = y;
    this._data[idx + 2] = z;
    this._data[idx + 3] = w;
  }

  /**
   * Sets a mat4 value in the buffer.
   * @param offset The byte offset.
   * @param matrix The Matrix4 data.
   */
  public setMatrix(offset: number, matrix: Float32Array): void {
    this._data.set(matrix, offset / 4);
  }

  /**
   * Binds the buffer to a specific shader program's uniform block.
   * @param program The WebGL program.
   * @param blockName The name of the uniform block.
   */
  public bindToProgram(program: WebGLProgram, blockName: string): void {
    const blockIndex = this._gl.getUniformBlockIndex(program, blockName);
    if (blockIndex !== 0xffffffff) {
      this._gl.uniformBlockBinding(program, blockIndex, this._bindingPoint);
    }
  }

  /**
   * Uploads the local data to the GPU.
   */
  public update(): void {
    this._gl.bindBuffer(this._gl.UNIFORM_BUFFER, this._buffer);
    this._gl.bufferSubData(this._gl.UNIFORM_BUFFER, 0, this._data);
    this._gl.bindBuffer(this._gl.UNIFORM_BUFFER, null);
  }

  /**
   * Destroys the underlying buffer.
   */
  public destroy(): void {
    this._gl.deleteBuffer(this._buffer);
  }
}
