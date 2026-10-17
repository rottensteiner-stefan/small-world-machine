import FULLSCREEN_VERT_GLSL from "../shaders/PostProcess.vert.glsl?raw";
import FULLSCREEN_VERT_GLSL100 from "../shaders/PostProcess100.vert.glsl?raw";

import BLOOM_DOWNSAMPLE_FRAG_GLSL from "../shaders/BloomDownsample.frag.glsl?raw";
import BLOOM_UPSAMPLE_FRAG_GLSL from "../shaders/BloomUpsample.frag.glsl?raw";
import BLOOM_DOWNSAMPLE_FRAG_GLSL100 from "../shaders/BloomDownsample.frag.glsl100?raw";
import BLOOM_UPSAMPLE_FRAG_GLSL100 from "../shaders/BloomUpsample.frag.glsl100?raw";

import { WebGL2FrameBuffer } from "../../WebGL2/index.js";
import type { BloomElement } from "../elements/index.js";

const MIP_CHAIN_LENGTH = 5;

/** A minimal FBO+texture pair for the WebGL1 mip chain -- no depth/stencil needed for bloom. */
interface GL1MipTarget {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

/**
 * Handles the Bloom generation (Kawase Dual Filtering) for both WebGL1 and WebGL2.
 */
export class BloomPassGL {
  private _gl: WebGLRenderingContext | WebGL2RenderingContext;
  private readonly _isWebGL2: boolean;

  private _downsampleProg?: WebGLProgram;
  private _upsampleProg?: WebGLProgram;

  private _uDownTexture: WebGLUniformLocation | null = null;
  private _uDownParams: WebGLUniformLocation | null = null;
  private _uDownThreshold: WebGLUniformLocation | null = null;

  private _uUpTexture: WebGLUniformLocation | null = null;
  private _uUpParams: WebGLUniformLocation | null = null;

  /** WebGL2 path only. */
  private _vao?: WebGLVertexArrayObject;
  /** WebGL1 path only: shared fullscreen-triangle vertex buffer + per-program attribute locations. */
  private _vb?: WebGLBuffer;
  private _aPosDown: number = -1;
  private _aPosUp: number = -1;
  /** WebGL1 path only: whether the device supports rendering to a half-float texture. */
  private _gl1UseHalfFloat: boolean = false;
  private _gl1HalfFloatType: number = 0;

  private _mipChain: WebGL2FrameBuffer[] = [];
  private _gl1MipChain: GL1MipTarget[] = [];
  private _width: number = 0;
  private _height: number = 0;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext, isWebGL2: boolean) {
    this._gl = gl;
    this._isWebGL2 = isWebGL2;
    this._build();
  }

  private _compileShader(type: number, src: string): WebGLShader | null {
    const gl = this._gl;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[BloomPassGL] Shader Compile Error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private _build(): void {
    const gl = this._gl;

    const vert = this._isWebGL2 ? FULLSCREEN_VERT_GLSL : FULLSCREEN_VERT_GLSL100;
    const downsampleFrag = this._isWebGL2
      ? BLOOM_DOWNSAMPLE_FRAG_GLSL
      : BLOOM_DOWNSAMPLE_FRAG_GLSL100;
    const upsampleFrag = this._isWebGL2 ? BLOOM_UPSAMPLE_FRAG_GLSL : BLOOM_UPSAMPLE_FRAG_GLSL100;

    // Build Downsample Program
    const vDown = this._compileShader(gl.VERTEX_SHADER, vert);
    const fDown = this._compileShader(gl.FRAGMENT_SHADER, downsampleFrag);
    if (vDown && fDown) {
      this._downsampleProg = gl.createProgram()!;
      gl.attachShader(this._downsampleProg, vDown);
      gl.attachShader(this._downsampleProg, fDown);
      gl.linkProgram(this._downsampleProg);
      this._uDownTexture = gl.getUniformLocation(this._downsampleProg, "u_texture");
      this._uDownParams = gl.getUniformLocation(this._downsampleProg, "u_params");
      this._uDownThreshold = gl.getUniformLocation(this._downsampleProg, "u_thresholdParams");
      if (!this._isWebGL2) {
        this._aPosDown = gl.getAttribLocation(this._downsampleProg, "a_pos");
      }
    }

    // Build Upsample Program
    const vUp = this._compileShader(gl.VERTEX_SHADER, vert);
    const fUp = this._compileShader(gl.FRAGMENT_SHADER, upsampleFrag);
    if (vUp && fUp) {
      this._upsampleProg = gl.createProgram()!;
      gl.attachShader(this._upsampleProg, vUp);
      gl.attachShader(this._upsampleProg, fUp);
      gl.linkProgram(this._upsampleProg);
      this._uUpTexture = gl.getUniformLocation(this._upsampleProg, "u_texture");
      this._uUpParams = gl.getUniformLocation(this._upsampleProg, "u_params");
      if (!this._isWebGL2) {
        this._aPosUp = gl.getAttribLocation(this._upsampleProg, "a_pos");
      }
    }

    if (this._isWebGL2) {
      this._vao = (gl as WebGL2RenderingContext).createVertexArray()!;
    } else {
      // Same fullscreen-triangle trick as PostProcessPassGL's WebGL1 path (no gl_VertexID here).
      this._vb = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, this._vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // WebGL1 needs extensions for a half-float render target; fall back to UNSIGNED_BYTE
      // (lower precision, but never crashes) when unavailable -- same pattern as the renderer's
      // own main HDR framebuffer setup.
      const extHalf = gl.getExtension("OES_texture_half_float");
      const extColorHalf = gl.getExtension("EXT_color_buffer_half_float");
      this._gl1UseHalfFloat = !!(extHalf && extColorHalf);
      this._gl1HalfFloatType = this._gl1UseHalfFloat ? extHalf!.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;
    }
  }

  private _createGL1MipTarget(width: number, height: number): GL1MipTarget {
    const gl = this._gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      this._gl1HalfFloatType,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { fbo, texture, width, height };
  }

  private _resizeMipChain(width: number, height: number): void {
    const chainLength = this._isWebGL2 ? this._mipChain.length : this._gl1MipChain.length;
    if (this._width === width && this._height === height && chainLength > 0) {
      return;
    }

    this._width = width;
    this._height = height;

    const gl = this._gl;

    if (this._isWebGL2) {
      for (const fbo of this._mipChain) fbo.destroy();
      this._mipChain = [];
    } else {
      for (const target of this._gl1MipChain) {
        gl.deleteFramebuffer(target.fbo);
        gl.deleteTexture(target.texture);
      }
      this._gl1MipChain = [];
    }

    let mipWidth = Math.floor(width / 2);
    let mipHeight = Math.floor(height / 2);

    for (let i = 0; i < MIP_CHAIN_LENGTH; i++) {
      if (mipWidth < 2 || mipHeight < 2) break;

      if (this._isWebGL2) {
        const gl2 = gl as WebGL2RenderingContext;
        this._mipChain.push(
          new WebGL2FrameBuffer(gl2, {
            width: mipWidth,
            height: mipHeight,
            internalFormat: gl2.RGBA16F, // Keep HDR precision for Bloom
            format: gl2.RGBA,
            type: gl2.HALF_FLOAT,
          }),
        );
      } else {
        this._gl1MipChain.push(this._createGL1MipTarget(mipWidth, mipHeight));
      }

      mipWidth = Math.floor(mipWidth / 2);
      mipHeight = Math.floor(mipHeight / 2);
    }
  }

  private _bindFullscreenAttrib(loc: number): void {
    const gl = this._gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vb!);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  /**
   * Generates the Bloom texture from the HDR input texture.
   * Returns the final bloom texture.
   */
  public execute(
    hdrTexture: WebGLTexture,
    width: number,
    height: number,
    bloomConfig: BloomElement,
  ): WebGLTexture | null {
    if (!this._downsampleProg || !this._upsampleProg) {
      return null;
    }

    this._resizeMipChain(width, height);
    const chain: { bind: () => void; texture: WebGLTexture; width: number; height: number }[] = this
      ._isWebGL2
      ? this._mipChain.map((fbo) => ({
          bind: () => fbo.bind(),
          texture: fbo.texture,
          width: fbo.width,
          height: fbo.height,
        }))
      : this._gl1MipChain.map((target) => ({
          bind: () => this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, target.fbo),
          texture: target.texture,
          width: target.width,
          height: target.height,
        }));
    if (chain.length === 0) return null;

    const gl = this._gl;

    // Setup state for post-processing
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND); // We just overwrite the FBOs

    if (this._isWebGL2) {
      (gl as WebGL2RenderingContext).bindVertexArray(this._vao!);
    }

    // --- DOWNSAMPLE ---
    gl.useProgram(this._downsampleProg);
    if (!this._isWebGL2) this._bindFullscreenAttrib(this._aPosDown);

    // Set Thresholds
    const threshold = bloomConfig.threshold;
    const knee = bloomConfig.softThreshold * threshold + 0.0001;
    gl.uniform4f(this._uDownThreshold, threshold, threshold - knee, 2.0 * knee, 0.25 / knee);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this._uDownTexture, 0);

    let currentTexture = hdrTexture;
    let isFirstPass = 1.0;

    for (let i = 0; i < chain.length; i++) {
      const target = chain[i]!;
      target.bind();
      gl.viewport(0, 0, target.width, target.height);

      gl.bindTexture(gl.TEXTURE_2D, currentTexture);

      // Texel width/height of the SOURCE texture
      const srcWidth = i === 0 ? width : chain[i - 1]!.width;
      const srcHeight = i === 0 ? height : chain[i - 1]!.height;

      gl.uniform3f(this._uDownParams, 1.0 / srcWidth, 1.0 / srcHeight, isFirstPass);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      currentTexture = target.texture;
      isFirstPass = 0.0;
    }

    // --- UPSAMPLE ---
    gl.useProgram(this._upsampleProg);
    if (!this._isWebGL2) this._bindFullscreenAttrib(this._aPosUp);

    // Enable additive blending for upsampling
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.blendEquation(gl.FUNC_ADD);

    gl.uniform1i(this._uUpTexture, 0);

    for (let i = chain.length - 2; i >= 0; i--) {
      const destTarget = chain[i]!;
      const srcTarget = chain[i + 1]!;

      destTarget.bind();
      gl.viewport(0, 0, destTarget.width, destTarget.height);

      gl.bindTexture(gl.TEXTURE_2D, srcTarget.texture);

      gl.uniform3f(
        this._uUpParams,
        1.0 / srcTarget.width,
        1.0 / srcTarget.height,
        bloomConfig.radius,
      );

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Restore state
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (this._isWebGL2) {
      (gl as WebGL2RenderingContext).bindVertexArray(null);
    } else {
      gl.disableVertexAttribArray(this._aPosUp);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    // The final bloom texture is the largest Mip target (index 0)
    return chain[0]!.texture;
  }

  /**
   * Destroys the programs, VAO/buffer, and mip chain framebuffers.
   */
  public destroy(): void {
    const gl = this._gl;
    if (this._downsampleProg) gl.deleteProgram(this._downsampleProg);
    if (this._upsampleProg) gl.deleteProgram(this._upsampleProg);
    if (this._isWebGL2) {
      if (this._vao) (gl as WebGL2RenderingContext).deleteVertexArray(this._vao);
      for (const fbo of this._mipChain) fbo.destroy();
      this._mipChain = [];
    } else {
      if (this._vb) gl.deleteBuffer(this._vb);
      for (const target of this._gl1MipChain) {
        gl.deleteFramebuffer(target.fbo);
        gl.deleteTexture(target.texture);
      }
      this._gl1MipChain = [];
    }
  }
}
