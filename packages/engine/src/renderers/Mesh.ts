import type { GeometryDataInterface } from "../interfaces/index.js";
import { WireframeMode } from "../enums/index.js";
import { buildLineShadowRibbon } from "./LineShadowRibbon.js";

/** Fixed WebGL2 attribute location of `a_color` (see `WebGLProgramCache`). */
export const VERTEX_COLOR_LOCATION = 11;

/** GL copy of a geometry's `LineShadowRibbon` (attribute locations 0-2 of the line-quad draw). */
export interface GLLineRibbon {
  positions: WebGLBuffer;
  others: WebGLBuffer;
  sides: WebGLBuffer;
  vertexCount: number;
  wireframeMode: WireframeMode;
  /** Set by `update()`; the next request rewrites the ribbon from the new vertices. */
  dirty: boolean;
}

/**
 * Wrapper for WebGL vertex and index buffers.
 * Handles both indexed and non-indexed geometry.
 */
export class Mesh {
  /** The vertex buffer object. */
  public vbo: WebGLBuffer | undefined;
  /** The element buffer object (indices). */
  public ebo: WebGLBuffer | undefined;
  /** The wireframe element buffer object. */
  public webo: WebGLBuffer | undefined;
  /** The normal buffer object. */
  public nbo: WebGLBuffer | undefined = undefined;
  /** The tangent buffer object. */
  public tanbo: WebGLBuffer | undefined = undefined;
  /** The texture coordinate buffer object. */
  public tbo: WebGLBuffer | undefined = undefined;
  /** The per-vertex color (RGBA) buffer object. */
  public cbo: WebGLBuffer | undefined = undefined;
  /** The skinning joints buffer object. */
  public jbo: WebGLBuffer | undefined = undefined;
  /** The skinning weights buffer object. */
  public wbo: WebGLBuffer | undefined = undefined;

  /** The number of elements (indices or vertices) to draw. */
  public count: number;
  /** The number of wireframe elements. */
  public wireframeCount: number = 0;
  /** Whether this mesh uses indices for drawing. */
  public isIndexed: boolean = false;
  /** The GL data type of the indices (e.g., UNSIGNED_SHORT or UNSIGNED_INT). */
  public indexType: number = 0;
  /** The GL data type of the wireframe indices. */
  public wireframeIndexType: number = 0;

  /** Number of live Object3D instances currently referencing this mesh's geometry. */
  public refCount: number = 0;

  /**
   * Lazily-built WebGL2 VAO capturing every vertex-attribute pointer at the engine-wide fixed
   * locations 0-5 (see `WebGLProgramCache._FIXED_ATTRIBUTE_LOCATIONS`), so a single
   * `bindVertexArray` replaces one `bindBuffer`+`vertexAttribPointer`+`enableVertexAttribArray`
   * per attribute. Never populated on WebGL1.
   */
  public vao: WebGLVertexArrayObject | undefined = undefined;

  /** Edge ribbons (one per wireframe mode) for world-width line shadows, built on first use. */
  private readonly _lineRibbons: GLLineRibbon[] = [];

  private _gl: WebGLRenderingContext | WebGL2RenderingContext;

  /**
   * Creates a new Mesh and uploads the geometry data to the GPU.
   * @param gl The WebGL context.
   * @param data The geometry data to upload.
   */
  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext, data: GeometryDataInterface) {
    this._gl = gl;

    // 1. Position Buffer
    this.vbo = gl.createBuffer() ?? undefined;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo ?? null);
    gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);

    // 2. Normals Buffer
    if (data.normals && 0 < data.normals.length) {
      this.nbo = gl.createBuffer() ?? undefined;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nbo ?? null);
      gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);
    }

    // 3. Tangents Buffer
    if (data.tangents && 0 < data.tangents.length) {
      this.tanbo = gl.createBuffer() ?? undefined;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tanbo ?? null);
      gl.bufferData(gl.ARRAY_BUFFER, data.tangents, gl.STATIC_DRAW);
    }

    // 4. UVs Buffer
    if (data.uvs && 0 < data.uvs.length) {
      this.tbo = gl.createBuffer() ?? undefined;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tbo ?? null);
      gl.bufferData(gl.ARRAY_BUFFER, data.uvs, gl.STATIC_DRAW);
    }

    // 4b. Vertex Colors Buffer
    if (data.colors && 0 < data.colors.length) {
      this.cbo = gl.createBuffer() ?? undefined;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cbo ?? null);
      gl.bufferData(gl.ARRAY_BUFFER, data.colors, gl.STATIC_DRAW);
    }

    // 5. Joints Buffer (Skinning)
    if (data.joints && 0 < data.joints.length) {
      this.jbo = gl.createBuffer() ?? undefined;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.jbo ?? null);
      gl.bufferData(gl.ARRAY_BUFFER, data.joints, gl.STATIC_DRAW);
    }

    // 6. Weights Buffer (Skinning)
    if (data.weights && 0 < data.weights.length) {
      this.wbo = gl.createBuffer() ?? undefined;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.wbo ?? null);
      gl.bufferData(gl.ARRAY_BUFFER, data.weights, gl.STATIC_DRAW);
    }

    // 7. Indices Buffer (Optional)
    if (data.indices && 0 < data.indices.length) {
      this.isIndexed = true;
      this.ebo = gl.createBuffer() ?? undefined;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo ?? null);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
      this.count = data.indices.length;
      this.indexType = data.indices.BYTES_PER_ELEMENT === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    } else {
      this.isIndexed = false;
      this.count = data.vertices.length / 3;
    }

    // 8. Wireframe Indices Buffer (Optional)
    if (data.wireframeIndices && 0 < data.wireframeIndices.length) {
      this.webo = gl.createBuffer() ?? undefined;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.webo ?? null);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.wireframeIndices, gl.STATIC_DRAW);
      this.wireframeCount = data.wireframeIndices.length;
      this.wireframeIndexType =
        data.wireframeIndices.BYTES_PER_ELEMENT === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    }
  }

  /**
   * Binds the buffers and sets the vertex attributes.
   * @param posLoc The location of the position attribute.
   * @param normLoc The location of the normal attribute.
   * @param uvLoc The location of the UV attribute.
   * @param tanLoc The location of the tangent attribute.
   * @param jointLoc The location of the joints attribute.
   * @param weightLoc The location of the weights attribute.
   * @param colorLoc The location of the vertex color attribute.
   */
  public bind(
    posLoc: number,
    normLoc: number = -1,
    uvLoc: number = -1,
    tanLoc: number = -1,
    jointLoc: number = -1,
    weightLoc: number = -1,
    colorLoc: number = -1,
  ): void {
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this.vbo ?? null);
    this._gl.vertexAttribPointer(posLoc, 3, this._gl.FLOAT, false, 0, 0);
    this._gl.enableVertexAttribArray(posLoc);

    if (0 <= normLoc) {
      if (this.nbo) {
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this.nbo);
        this._gl.vertexAttribPointer(normLoc, 3, this._gl.FLOAT, false, 0, 0);
        this._gl.enableVertexAttribArray(normLoc);
      } else {
        this._gl.disableVertexAttribArray(normLoc);
      }
    }

    if (0 <= uvLoc) {
      if (this.tbo) {
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this.tbo);
        this._gl.vertexAttribPointer(uvLoc, 2, this._gl.FLOAT, false, 0, 0);
        this._gl.enableVertexAttribArray(uvLoc);
      } else {
        this._gl.disableVertexAttribArray(uvLoc);
      }
    }

    if (0 <= tanLoc) {
      if (this.tanbo) {
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this.tanbo);
        this._gl.vertexAttribPointer(tanLoc, 3, this._gl.FLOAT, false, 0, 0);
        this._gl.enableVertexAttribArray(tanLoc);
      } else {
        this._gl.disableVertexAttribArray(tanLoc);
      }
    }

    if (0 <= jointLoc) {
      if (this.jbo) {
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this.jbo);
        this._gl.vertexAttribPointer(jointLoc, 4, this._gl.FLOAT, false, 0, 0);
        this._gl.enableVertexAttribArray(jointLoc);
      } else {
        this._gl.disableVertexAttribArray(jointLoc);
      }
    }

    if (0 <= weightLoc) {
      if (this.wbo) {
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this.wbo);
        this._gl.vertexAttribPointer(weightLoc, 4, this._gl.FLOAT, false, 0, 0);
        this._gl.enableVertexAttribArray(weightLoc);
      } else {
        this._gl.disableVertexAttribArray(weightLoc);
      }
    }

    if (0 <= colorLoc) {
      if (this.cbo) {
        this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this.cbo);
        this._gl.vertexAttribPointer(colorLoc, 4, this._gl.FLOAT, false, 0, 0);
        this._gl.enableVertexAttribArray(colorLoc);
      } else {
        this._gl.disableVertexAttribArray(colorLoc);
        this._gl.vertexAttrib4f(colorLoc, 1, 1, 1, 1);
      }
    }
  }

  /**
   * Whether this mesh can draw through a cached VAO (WebGL2 contexts only).
   * WebGL1 has no VAO support and keeps using `bind()`.
   */
  public get vaoCapable(): boolean {
    return typeof (this._gl as WebGL2RenderingContext).createVertexArray === "function";
  }

  /**
   * Binds this mesh's cached VAO (built lazily on first use), which restores every vertex
   * attribute pointer in one call instead of re-issuing per-attribute GL calls every draw.
   * The index buffer is NOT captured here -- `draw()` rebinds the element buffer it needs.
   */
  public bindVAO(): void {
    if (!this.vaoCapable) return;
    const gl = this._gl as WebGL2RenderingContext;
    if (!this.vao) this._buildVAO(gl);
    if (this.vao) gl.bindVertexArray(this.vao);
  }

  /**
   * Captures the attribute pointers for locations 0-5 (position/normal/uv/tangent/joints/
   * weights) and the vertex color at location 11 (the fixed reservations from
   * `WebGLProgramCache`) into a fresh VAO. Missing buffers disable their location so a later
   * program sees the GL default constant, matching what `bind()` does per draw. The color
   * constant is set to opaque white (the GL default would be black) -- generic attribute values
   * are context state, not VAO state, so this holds for every mesh without colors.
   */
  private _buildVAO(gl: WebGL2RenderingContext): void {
    const vao = gl.createVertexArray();
    if (!vao) return;
    gl.bindVertexArray(vao);
    this._setupAttribute(gl, 0, this.vbo, 3, this._gl.FLOAT);
    this._setupAttribute(gl, 1, this.nbo, 3, this._gl.FLOAT);
    this._setupAttribute(gl, 2, this.tbo, 2, this._gl.FLOAT);
    this._setupAttribute(gl, 3, this.tanbo, 3, this._gl.FLOAT);
    this._setupAttribute(gl, 4, this.jbo, 4, this._gl.FLOAT);
    this._setupAttribute(gl, 5, this.wbo, 4, this._gl.FLOAT);
    this._setupAttribute(gl, VERTEX_COLOR_LOCATION, this.cbo, 4, this._gl.FLOAT);
    if (!this.cbo) gl.vertexAttrib4f(VERTEX_COLOR_LOCATION, 1, 1, 1, 1);
    gl.bindVertexArray(null);
    this.vao = vao;
  }

  private _setupAttribute(
    gl: WebGL2RenderingContext,
    index: number,
    buffer: WebGLBuffer | undefined,
    size: number,
    type: number,
  ): void {
    if (buffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, type, false, 0, 0);
    } else {
      gl.disableVertexAttribArray(index);
    }
  }

  /**
   * Draws the mesh using the appropriate GL call.
   * @param mode The draw mode (e.g. TRIANGLES, LINES).
   */
  public draw(mode: number, wireframeMode: WireframeMode = WireframeMode.DEFAULT): void {
    if (mode === this._gl.LINES && wireframeMode === WireframeMode.STRUCTURAL && this.webo) {
      this._gl.bindBuffer(this._gl.ELEMENT_ARRAY_BUFFER, this.webo);
      this._gl.drawElements(mode, this.wireframeCount, this.wireframeIndexType, 0);
    } else if (this.isIndexed) {
      this._gl.bindBuffer(this._gl.ELEMENT_ARRAY_BUFFER, this.ebo ?? null);
      this._gl.drawElements(mode, this.count, this.indexType, 0);
    } else {
      this._gl.drawArrays(mode, 0, this.count);
    }
  }

  /**
   * Instanced counterpart of `draw()` (WebGL2 only), with the same index-buffer choice: structural
   * wireframes draw the edge buffer, not the triangle indices read as line pairs.
   */
  public drawInstanced(
    mode: number,
    instanceCount: number,
    wireframeMode: WireframeMode = WireframeMode.DEFAULT,
  ): void {
    const gl = this._gl as WebGL2RenderingContext;
    if (mode === gl.LINES && wireframeMode === WireframeMode.STRUCTURAL && this.webo) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.webo);
      gl.drawElementsInstanced(
        mode,
        this.wireframeCount,
        this.wireframeIndexType,
        0,
        instanceCount,
      );
    } else if (this.isIndexed) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo ?? null);
      gl.drawElementsInstanced(mode, this.count, this.indexType, 0, instanceCount);
    } else {
      gl.drawArraysInstanced(mode, 0, this.count, instanceCount);
    }
  }

  /**
   * Returns the edge ribbon of `data` for `wireframeMode` (ADR 0045), built on first request and
   * rewritten after `update()`. `undefined` for a geometry without edges.
   */
  public getLineRibbon(
    data: GeometryDataInterface,
    wireframeMode: WireframeMode,
  ): GLLineRibbon | undefined {
    const gl = this._gl;
    let r: GLLineRibbon | undefined;
    for (let i = 0; i < this._lineRibbons.length; i++) {
      if (this._lineRibbons[i]!.wireframeMode === wireframeMode) r = this._lineRibbons[i];
    }
    if (r && !r.dirty) return r;

    const ribbon = buildLineShadowRibbon(data, wireframeMode);
    if (!r) {
      if (ribbon.vertexCount === 0) return undefined;
      r = {
        positions: gl.createBuffer()!,
        others: gl.createBuffer()!,
        sides: gl.createBuffer()!,
        vertexCount: ribbon.vertexCount,
        wireframeMode,
        dirty: false,
      };
      this._lineRibbons.push(r);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, r.positions);
    gl.bufferData(gl.ARRAY_BUFFER, ribbon.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.others);
    gl.bufferData(gl.ARRAY_BUFFER, ribbon.others, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.sides);
    gl.bufferData(gl.ARRAY_BUFFER, ribbon.sides, gl.STATIC_DRAW);
    r.dirty = false;
    return r;
  }

  /**
   * Points attribute locations 0-2 (position / normal / uv) of the currently bound VAO at `r`
   * and disables 3-5, matching the line-quad shadow vertex shader's inputs.
   */
  public bindLineRibbon(r: GLLineRibbon): void {
    const gl = this._gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, r.positions);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.others);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.sides);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(2);
    gl.disableVertexAttribArray(3);
    gl.disableVertexAttribArray(4);
    gl.disableVertexAttribArray(5);
  }

  /**
   * Updates the GPU buffers with new geometry data.
   * Currently updates vertices, normals, tangents and vertex colors.
   * @param data The new geometry data.
   */
  public update(data: GeometryDataInterface): void {
    for (let i = 0; i < this._lineRibbons.length; i++) this._lineRibbons[i]!.dirty = true;
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this.vbo ?? null);
    this._gl.bufferData(this._gl.ARRAY_BUFFER, data.vertices, this._gl.STATIC_DRAW);

    if (this.nbo && data.normals) {
      this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this.nbo);
      this._gl.bufferData(this._gl.ARRAY_BUFFER, data.normals, this._gl.STATIC_DRAW);
    }

    if (this.tanbo && data.tangents) {
      this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this.tanbo);
      this._gl.bufferData(this._gl.ARRAY_BUFFER, data.tangents, this._gl.STATIC_DRAW);
    }

    if (this.cbo && data.colors) {
      this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this.cbo);
      this._gl.bufferData(this._gl.ARRAY_BUFFER, data.colors, this._gl.STATIC_DRAW);
    }
  }

  /** Deletes all GPU buffers owned by this mesh. Call only once its refCount reaches 0. */
  public dispose(): void {
    if (this.vbo) this._gl.deleteBuffer(this.vbo);
    if (this.ebo) this._gl.deleteBuffer(this.ebo);
    if (this.webo) this._gl.deleteBuffer(this.webo);
    if (this.nbo) this._gl.deleteBuffer(this.nbo);
    if (this.tanbo) this._gl.deleteBuffer(this.tanbo);
    if (this.tbo) this._gl.deleteBuffer(this.tbo);
    if (this.cbo) this._gl.deleteBuffer(this.cbo);
    if (this.jbo) this._gl.deleteBuffer(this.jbo);
    if (this.wbo) this._gl.deleteBuffer(this.wbo);
    for (const r of this._lineRibbons) {
      this._gl.deleteBuffer(r.positions);
      this._gl.deleteBuffer(r.others);
      this._gl.deleteBuffer(r.sides);
    }
    this._lineRibbons.length = 0;
    if (this.vao) {
      const gl = this._gl as WebGL2RenderingContext;
      if (typeof gl.deleteVertexArray === "function") gl.deleteVertexArray(this.vao);
      this.vao = undefined;
    }
  }
}
