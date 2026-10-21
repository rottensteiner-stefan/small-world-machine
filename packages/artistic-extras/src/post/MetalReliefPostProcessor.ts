import fragGLSL from "./shaders/MetalReliefPost.frag.glsl?raw";
import fragGLSL100 from "./shaders/MetalReliefPost.frag.glsl100?raw";
import fragWGSL from "./shaders/MetalReliefPost.frag.wgsl?raw";
import { compileProgram } from "@small-world-machine/engine";

export interface MetalReliefPostProcessorOptions {
  /** Strength of the Sobel relief normal extrusion (0..5). Defaults to 1.5. */
  reliefStrength?: number;
  /** Strength of the Voronoi palette knife faceting (0..2). Defaults to 0.5. */
  paletteKnifeStrength?: number;
  /** Frequency / scale of palette knife facets. Defaults to 24.0. */
  paletteKnifeScale?: number;
  /** Strength of brushed metal and angle grinder scratches (0..1). Defaults to 0.35. */
  scratchIntensity?: number;
  /** Density / frequency of scratch grooves. Defaults to 120.0. */
  scratchScale?: number;
  /** Target accent hue to preserve in [0, 1] (0.0 = pure red). Defaults to 0.0. */
  targetHue?: number;
  /** Angular tolerance window for the accent hue. Defaults to 0.09. */
  hueTolerance?: number;
  /** How completely non-accent areas are converted to steel/rust (0..1). Defaults to 0.95. */
  desaturation?: number;
  /** Strength of warm iron oxide / raw umber rust in shadows (0..1). Defaults to 0.8. */
  rustStrength?: number;
  /** Specular silver highlight on raised edges and contours (0..3). Defaults to 1.2. */
  edgeGlintStrength?: number;
  /** Vertical glossy wet sheen and rain reflection streaks in bottom half (0..1). Defaults to 0.5. */
  wetRainStreaks?: number;
  /** Procedural diamond wire mesh (Streckmetall) overlay (0..1). Defaults to 0.0. */
  wireMeshStrength?: number;
  /** Scale of diamond wire mesh pattern. Defaults to 30.0. */
  wireMeshScale?: number;
  /**
   * WebGPU color target format of the pass this runs in. Defaults to the preferred canvas format
   * (`navigator.gpu.getPreferredCanvasFormat()`), falling back to `bgra8unorm`.
   */
  targetFormat?: GPUTextureFormat;
}

/** Fixed attribute slot for the full-screen quad (bound before link, so no lookup is needed). */
const POSITION_LOCATION = 0;

interface GLLocations {
  colorTexture: WebGLUniformLocation | null;
  resolution: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  reliefStrength: WebGLUniformLocation | null;
  paletteKnifeStrength: WebGLUniformLocation | null;
  paletteKnifeScale: WebGLUniformLocation | null;
  scratchIntensity: WebGLUniformLocation | null;
  scratchScale: WebGLUniformLocation | null;
  targetHue: WebGLUniformLocation | null;
  hueTolerance: WebGLUniformLocation | null;
  desaturation: WebGLUniformLocation | null;
  rustStrength: WebGLUniformLocation | null;
  edgeGlintStrength: WebGLUniformLocation | null;
  wetRainStreaks: WebGLUniformLocation | null;
  wireMeshStrength: WebGLUniformLocation | null;
  wireMeshScale: WebGLUniformLocation | null;
}

const VS_GLSL300 = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const VS_GLSL100 = `attribute vec2 a_position;
varying vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/**
 * Screen-space post-processor that transforms any render, photo, or canvas into a 3D metal wall relief
 * assemblage painting with palette knife impasto, industrial steel patina, and selective color pop.
 */
export class MetalReliefPostProcessor {
  public reliefStrength: number;
  public paletteKnifeStrength: number;
  public paletteKnifeScale: number;
  public scratchIntensity: number;
  public scratchScale: number;
  public targetHue: number;
  public hueTolerance: number;
  public desaturation: number;
  public rustStrength: number;
  public edgeGlintStrength: number;
  public wetRainStreaks: number;
  public wireMeshStrength: number;
  public wireMeshScale: number;
  public time: number = 0.0;
  /** WebGPU color target format; see {@link MetalReliefPostProcessorOptions.targetFormat}. */
  public targetFormat: GPUTextureFormat | undefined;

  // Cached WebGL state
  private _glProgram: WebGLProgram | null = null;
  private _glQuadBuffer: WebGLBuffer | null = null;
  private _glVao: WebGLVertexArrayObject | null = null;
  private _glLocations: GLLocations | null = null;
  private _glContext: WebGLRenderingContext | WebGL2RenderingContext | null = null;

  // Cached WebGPU state
  private _gpuPipeline: GPURenderPipeline | null = null;
  private _gpuUniformBuffer: GPUBuffer | null = null;
  private _gpuSampler: GPUSampler | null = null;
  private _gpuDevice: GPUDevice | null = null;
  private _gpuBindGroup: GPUBindGroup | null = null;
  private _gpuBoundView: GPUTextureView | null = null;
  private readonly _uniformData: Float32Array = new Float32Array(16);

  constructor(options: MetalReliefPostProcessorOptions = {}) {
    this.reliefStrength = options.reliefStrength ?? 1.5;
    this.paletteKnifeStrength = options.paletteKnifeStrength ?? 0.5;
    this.paletteKnifeScale = options.paletteKnifeScale ?? 24.0;
    this.scratchIntensity = options.scratchIntensity ?? 0.35;
    this.scratchScale = options.scratchScale ?? 120.0;
    this.targetHue = options.targetHue ?? 0.0;
    this.hueTolerance = options.hueTolerance ?? 0.09;
    this.desaturation = options.desaturation ?? 0.95;
    this.rustStrength = options.rustStrength ?? 0.8;
    this.edgeGlintStrength = options.edgeGlintStrength ?? 1.2;
    this.wetRainStreaks = options.wetRainStreaks ?? 0.5;
    this.wireMeshStrength = options.wireMeshStrength ?? 0.0;
    this.wireMeshScale = options.wireMeshScale ?? 30.0;
    this.targetFormat = options.targetFormat;
  }

  /**
   * Renders the post-processing filter over an active WebGL viewport. `inputTexture` must follow the
   * GL convention (row 0 = bottom), which is what a framebuffer attachment already is; upload canvas
   * or image sources with `UNPACK_FLIP_Y_WEBGL` (as `applyToCanvas` does).
   *
   * The pass is state-neutral: program, texture/buffer bindings, viewport, depth/blend/cull/scissor
   * and the vertex-attribute setup are restored afterwards so it can run inside an engine frame.
   * WebGL2 isolates the attribute setup in a VAO; on WebGL1 only the enable flag of attribute 0 is
   * restored (the attribute pointer is left as is, engines re-specify it on every draw).
   */
  public renderGL(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    width: number,
    height: number,
  ): void {
    if (this._glContext !== gl || !this._glProgram) {
      this._releaseGL();
      this._initGL(gl);
    }
    const program = this._glProgram;
    const quad = this._glQuadBuffer;
    const loc = this._glLocations;
    if (!program || !quad || !loc) {
      throw new Error("MetalReliefPostProcessor: WebGL resources are not initialized.");
    }

    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(gl.TEXTURE0);
    const prevTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const prevBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const depthWas = gl.isEnabled(gl.DEPTH_TEST);
    const blendWas = gl.isEnabled(gl.BLEND);
    const cullWas = gl.isEnabled(gl.CULL_FACE);
    const scissorWas = gl.isEnabled(gl.SCISSOR_TEST);
    const gl2 = this._glVao ? (gl as WebGL2RenderingContext) : null;
    const prevVao = gl2
      ? (gl2.getParameter(gl2.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null)
      : null;
    const attribWas = gl2
      ? true
      : (gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_ENABLED) as boolean);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);

    gl.useProgram(program);
    gl.viewport(0, 0, width, height);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);

    gl.uniform1i(loc.colorTexture, 0);
    gl.uniform2f(loc.resolution, width, height);
    gl.uniform1f(loc.time, this.time);
    gl.uniform1f(loc.reliefStrength, this.reliefStrength);
    gl.uniform1f(loc.paletteKnifeStrength, this.paletteKnifeStrength);
    gl.uniform1f(loc.paletteKnifeScale, this.paletteKnifeScale);
    gl.uniform1f(loc.scratchIntensity, this.scratchIntensity);
    gl.uniform1f(loc.scratchScale, this.scratchScale);
    gl.uniform1f(loc.targetHue, this.targetHue);
    gl.uniform1f(loc.hueTolerance, this.hueTolerance);
    gl.uniform1f(loc.desaturation, this.desaturation);
    gl.uniform1f(loc.rustStrength, this.rustStrength);
    gl.uniform1f(loc.edgeGlintStrength, this.edgeGlintStrength);
    gl.uniform1f(loc.wetRainStreaks, this.wetRainStreaks);
    gl.uniform1f(loc.wireMeshStrength, this.wireMeshStrength);
    gl.uniform1f(loc.wireMeshScale, this.wireMeshScale);

    if (gl2 && this._glVao) {
      gl2.bindVertexArray(this._glVao);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(POSITION_LOCATION);
      gl.vertexAttribPointer(POSITION_LOCATION, 2, gl.FLOAT, false, 0, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (gl2) {
      gl2.bindVertexArray(prevVao);
    } else if (!attribWas) {
      gl.disableVertexAttribArray(POSITION_LOCATION);
    }
    if (depthWas) gl.enable(gl.DEPTH_TEST);
    if (blendWas) gl.enable(gl.BLEND);
    if (cullWas) gl.enable(gl.CULL_FACE);
    if (scissorWas) gl.enable(gl.SCISSOR_TEST);
    gl.bindBuffer(gl.ARRAY_BUFFER, prevBuffer);
    gl.bindTexture(gl.TEXTURE_2D, prevTexture);
    gl.activeTexture(prevActiveTexture);
    gl.viewport(prevViewport[0]!, prevViewport[1]!, prevViewport[2]!, prevViewport[3]!);
    gl.useProgram(prevProgram);
  }

  /**
   * Renders the post-processing filter over an active WebGPU pass. The color target format must
   * match the pass (`targetFormat` option; defaults to `navigator.gpu.getPreferredCanvasFormat()`,
   * else `bgra8unorm`). Allocation-free per frame: the uniform scratch array and the bind group are
   * reused (the bind group is rebuilt only when `inputTextureView` changes).
   */
  public renderGPU(
    device: GPUDevice,
    passEncoder: GPURenderPassEncoder,
    inputTextureView: GPUTextureView,
    width: number,
    height: number,
  ): void {
    if (!this._gpuPipeline || this._gpuDevice !== device) {
      this._releaseGPU();
      this._initGPU(device);
    }

    const pipeline = this._gpuPipeline;
    const uniformBuffer = this._gpuUniformBuffer;
    const sampler = this._gpuSampler;
    if (!pipeline || !uniformBuffer || !sampler) {
      throw new Error("MetalReliefPostProcessor: WebGPU resources are not initialized.");
    }

    const d = this._uniformData;
    d[0] = width;
    d[1] = height;
    d[2] = this.time;
    d[3] = this.reliefStrength;
    d[4] = this.paletteKnifeStrength;
    d[5] = this.paletteKnifeScale;
    d[6] = this.scratchIntensity;
    d[7] = this.scratchScale;
    d[8] = this.targetHue;
    d[9] = this.hueTolerance;
    d[10] = this.desaturation;
    d[11] = this.rustStrength;
    d[12] = this.edgeGlintStrength;
    d[13] = this.wetRainStreaks;
    d[14] = this.wireMeshStrength;
    d[15] = this.wireMeshScale;
    device.queue.writeBuffer(uniformBuffer, 0, d);

    if (!this._gpuBindGroup || this._gpuBoundView !== inputTextureView) {
      this._gpuBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: inputTextureView },
          { binding: 2, resource: { buffer: uniformBuffer } },
        ],
      });
      this._gpuBoundView = inputTextureView;
    }

    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, this._gpuBindGroup);
    passEncoder.draw(3, 1, 0, 0);
  }

  /**
   * Filters `sourceCanvas` through WebGL into a DIFFERENT canvas and returns it. Without
   * `targetCanvas` a new canvas of the source size is created. The source and target must differ:
   * a canvas that already has a 2D context cannot hand out a WebGL context, and a WebGL canvas
   * without `preserveDrawingBuffer` would be cleared before it is read.
   */
  public applyToCanvas(
    sourceCanvas: HTMLCanvasElement,
    targetCanvas?: HTMLCanvasElement,
  ): HTMLCanvasElement {
    if (targetCanvas === sourceCanvas) {
      throw new Error(
        "MetalReliefPostProcessor.applyToCanvas: target canvas must differ from source canvas.",
      );
    }
    const target = targetCanvas ?? sourceCanvas.ownerDocument.createElement("canvas");
    if (undefined === targetCanvas) {
      target.width = sourceCanvas.width;
      target.height = sourceCanvas.height;
    }
    const gl =
      target.getContext("webgl2") || (target.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) {
      throw new Error("MetalReliefPostProcessor: Failed to obtain WebGL context on target canvas.");
    }

    const tex = gl.createTexture();
    if (!tex) {
      throw new Error("MetalReliefPostProcessor: Failed to create WebGL input texture.");
    }

    const prevTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Canvas rows start at the top; the shader and GL expect row 0 at the bottom.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);
    gl.bindTexture(gl.TEXTURE_2D, prevTexture);

    this.renderGL(gl, tex, target.width, target.height);
    gl.deleteTexture(tex);

    return target;
  }

  public destroy(): void {
    this._releaseGL();
    this._releaseGPU();
  }

  private _releaseGL(): void {
    const gl = this._glContext;
    if (gl) {
      if (this._glProgram) gl.deleteProgram(this._glProgram);
      if (this._glQuadBuffer) gl.deleteBuffer(this._glQuadBuffer);
      if (this._glVao) (gl as WebGL2RenderingContext).deleteVertexArray(this._glVao);
    }
    this._glProgram = null;
    this._glQuadBuffer = null;
    this._glVao = null;
    this._glLocations = null;
    this._glContext = null;
  }

  private _releaseGPU(): void {
    if (this._gpuUniformBuffer) {
      this._gpuUniformBuffer.destroy();
    }
    this._gpuUniformBuffer = null;
    this._gpuPipeline = null;
    this._gpuSampler = null;
    this._gpuBindGroup = null;
    this._gpuBoundView = null;
    this._gpuDevice = null;
  }

  private _initGL(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    const isWebGL2 =
      typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;

    // Throws with the GL info log on any compile/link error (fail fast).
    const program = compileProgram(
      gl,
      isWebGL2 ? VS_GLSL300 : VS_GLSL100,
      isWebGL2 ? fragGLSL : fragGLSL100,
      "MetalReliefPostProcessor",
      [[POSITION_LOCATION, "a_position"]],
    );

    const u = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
    this._glLocations = {
      colorTexture: u("u_colorTexture"),
      resolution: u("u_resolution"),
      time: u("u_time"),
      reliefStrength: u("u_reliefStrength"),
      paletteKnifeStrength: u("u_paletteKnifeStrength"),
      paletteKnifeScale: u("u_paletteKnifeScale"),
      scratchIntensity: u("u_scratchIntensity"),
      scratchScale: u("u_scratchScale"),
      targetHue: u("u_targetHue"),
      hueTolerance: u("u_hueTolerance"),
      desaturation: u("u_desaturation"),
      rustStrength: u("u_rustStrength"),
      edgeGlintStrength: u("u_edgeGlintStrength"),
      wetRainStreaks: u("u_wetRainStreaks"),
      wireMeshStrength: u("u_wireMeshStrength"),
      wireMeshScale: u("u_wireMeshScale"),
    };

    // Full-screen quad buffer: 2 triangles
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      throw new Error("MetalReliefPostProcessor: createBuffer() failed (context lost?).");
    }
    const prevBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    if (isWebGL2) {
      const gl2 = gl as WebGL2RenderingContext;
      const prevVao = gl2.getParameter(gl2.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
      const vao = gl2.createVertexArray();
      gl2.bindVertexArray(vao);
      gl2.enableVertexAttribArray(POSITION_LOCATION);
      gl2.vertexAttribPointer(POSITION_LOCATION, 2, gl2.FLOAT, false, 0, 0);
      gl2.bindVertexArray(prevVao);
      this._glVao = vao;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, prevBuffer);

    this._glContext = gl;
    this._glProgram = program;
    this._glQuadBuffer = buffer;
  }

  private _initGPU(device: GPUDevice): void {
    this._gpuDevice = device;
    const module = device.createShaderModule({ code: fragWGSL });

    this._gpuUniformBuffer = device.createBuffer({
      size: 64, // 16 floats * 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._gpuSampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });

    this._gpuPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vsMain",
      },
      fragment: {
        module,
        entryPoint: "fsMain",
        targets: [{ format: this._resolveTargetFormat() }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
  }

  private _resolveTargetFormat(): GPUTextureFormat {
    if (undefined !== this.targetFormat) return this.targetFormat;
    const gpu = (globalThis as { navigator?: { gpu?: GPU } }).navigator?.gpu;
    return gpu ? gpu.getPreferredCanvasFormat() : "bgra8unorm";
  }
}
