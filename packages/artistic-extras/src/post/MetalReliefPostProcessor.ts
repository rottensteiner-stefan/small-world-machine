import fragGLSL from "./shaders/MetalReliefPost.frag.glsl?raw";
import fragGLSL100 from "./shaders/MetalReliefPost.frag.glsl100?raw";
import fragWGSL from "./shaders/MetalReliefPost.frag.wgsl?raw";

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

  // Cached WebGL state
  private _glProgram: WebGLProgram | null = null;
  private _glQuadBuffer: WebGLBuffer | null = null;
  private _glContext: WebGLRenderingContext | WebGL2RenderingContext | null = null;

  // Cached WebGPU state
  private _gpuPipeline: GPURenderPipeline | null = null;
  private _gpuUniformBuffer: GPUBuffer | null = null;
  private _gpuSampler: GPUSampler | null = null;
  private _gpuDevice: GPUDevice | null = null;

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
  }

  /**
   * Renders the post-processing filter over an active WebGL viewport.
   */
  public renderGL(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    width: number,
    height: number,
  ): void {
    if (!this._glProgram || this._glContext !== gl) {
      this._initGL(gl);
    }

    if (!this._glProgram || !this._glQuadBuffer) {
      return;
    }

    gl.useProgram(this._glProgram);
    gl.viewport(0, 0, width, height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);

    const uColorTex = gl.getUniformLocation(this._glProgram, "u_colorTexture");
    const uRes = gl.getUniformLocation(this._glProgram, "u_resolution");
    const uTime = gl.getUniformLocation(this._glProgram, "u_time");
    const uRelief = gl.getUniformLocation(this._glProgram, "u_reliefStrength");
    const uPalStrength = gl.getUniformLocation(this._glProgram, "u_paletteKnifeStrength");
    const uPalScale = gl.getUniformLocation(this._glProgram, "u_paletteKnifeScale");
    const uScratchInt = gl.getUniformLocation(this._glProgram, "u_scratchIntensity");
    const uScratchScale = gl.getUniformLocation(this._glProgram, "u_scratchScale");
    const uTargetHue = gl.getUniformLocation(this._glProgram, "u_targetHue");
    const uHueTol = gl.getUniformLocation(this._glProgram, "u_hueTolerance");
    const uDesat = gl.getUniformLocation(this._glProgram, "u_desaturation");
    const uRust = gl.getUniformLocation(this._glProgram, "u_rustStrength");
    const uEdgeGlint = gl.getUniformLocation(this._glProgram, "u_edgeGlintStrength");
    const uWetRain = gl.getUniformLocation(this._glProgram, "u_wetRainStreaks");
    const uWireStrength = gl.getUniformLocation(this._glProgram, "u_wireMeshStrength");
    const uWireScale = gl.getUniformLocation(this._glProgram, "u_wireMeshScale");

    if (uColorTex) gl.uniform1i(uColorTex, 0);
    if (uRes) gl.uniform2f(uRes, width, height);
    if (uTime) gl.uniform1f(uTime, this.time);
    if (uRelief) gl.uniform1f(uRelief, this.reliefStrength);
    if (uPalStrength) gl.uniform1f(uPalStrength, this.paletteKnifeStrength);
    if (uPalScale) gl.uniform1f(uPalScale, this.paletteKnifeScale);
    if (uScratchInt) gl.uniform1f(uScratchInt, this.scratchIntensity);
    if (uScratchScale) gl.uniform1f(uScratchScale, this.scratchScale);
    if (uTargetHue) gl.uniform1f(uTargetHue, this.targetHue);
    if (uHueTol) gl.uniform1f(uHueTol, this.hueTolerance);
    if (uDesat) gl.uniform1f(uDesat, this.desaturation);
    if (uRust) gl.uniform1f(uRust, this.rustStrength);
    if (uEdgeGlint) gl.uniform1f(uEdgeGlint, this.edgeGlintStrength);
    if (uWetRain) gl.uniform1f(uWetRain, this.wetRainStreaks);
    if (uWireStrength) gl.uniform1f(uWireStrength, this.wireMeshStrength);
    if (uWireScale) gl.uniform1f(uWireScale, this.wireMeshScale);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._glQuadBuffer);
    const aPos = gl.getAttribLocation(this._glProgram, "a_position");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * Renders the post-processing filter over an active WebGPU pass.
   */
  public renderGPU(
    device: GPUDevice,
    passEncoder: GPURenderPassEncoder,
    inputTextureView: GPUTextureView,
    width: number,
    height: number,
  ): void {
    if (!this._gpuPipeline || this._gpuDevice !== device) {
      this._initGPU(device);
    }

    if (!this._gpuPipeline || !this._gpuUniformBuffer || !this._gpuSampler) {
      return;
    }

    const uniformData = new Float32Array([
      width,
      height,
      this.time,
      this.reliefStrength,
      this.paletteKnifeStrength,
      this.paletteKnifeScale,
      this.scratchIntensity,
      this.scratchScale,
      this.targetHue,
      this.hueTolerance,
      this.desaturation,
      this.rustStrength,
      this.edgeGlintStrength,
      this.wetRainStreaks,
      this.wireMeshStrength,
      this.wireMeshScale,
    ]);

    device.queue.writeBuffer(this._gpuUniformBuffer, 0, uniformData.buffer);

    const bindGroup = device.createBindGroup({
      layout: this._gpuPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this._gpuSampler },
        { binding: 1, resource: inputTextureView },
        { binding: 2, resource: { buffer: this._gpuUniformBuffer } },
      ],
    });

    passEncoder.setPipeline(this._gpuPipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.draw(3, 1, 0, 0);
  }

  /**
   * Convenience utility to filter a source 2D/3D canvas into a target canvas using WebGL.
   */
  public applyToCanvas(
    sourceCanvas: HTMLCanvasElement,
    targetCanvas: HTMLCanvasElement = sourceCanvas,
  ): HTMLCanvasElement {
    const gl =
      targetCanvas.getContext("webgl2") ||
      (targetCanvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) {
      throw new Error("MetalReliefPostProcessor: Failed to obtain WebGL context on target canvas.");
    }

    const tex = gl.createTexture();
    if (!tex) {
      throw new Error("MetalReliefPostProcessor: Failed to create WebGL input texture.");
    }

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

    this.renderGL(gl, tex, targetCanvas.width, targetCanvas.height);
    gl.deleteTexture(tex);

    return targetCanvas;
  }

  public destroy(): void {
    if (this._glProgram && this._glContext) {
      this._glContext.deleteProgram(this._glProgram);
      this._glProgram = null;
    }
    if (this._glQuadBuffer && this._glContext) {
      this._glContext.deleteBuffer(this._glQuadBuffer);
      this._glQuadBuffer = null;
    }
    this._glContext = null;

    if (this._gpuUniformBuffer) {
      this._gpuUniformBuffer.destroy();
      this._gpuUniformBuffer = null;
    }
    this._gpuPipeline = null;
    this._gpuSampler = null;
    this._gpuDevice = null;
  }

  private _initGL(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this._glContext = gl;
    const isWebGL2 =
      typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;

    const vsSource = isWebGL2 ? VS_GLSL300 : VS_GLSL100;
    const fsSource = isWebGL2 ? fragGLSL : fragGLSL100;

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this._glProgram = program;

    // Full-screen quad buffer: 2 triangles
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
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
        targets: [{ format: "bgra8unorm" }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
  }
}
