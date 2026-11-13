import { Texture } from "../../../core/textures/index.js";
import type { WebGLTextureManager } from "../../gl/managers/WebGLTextureManager.js";
import type { WebGL2FrameBuffer } from "../WebGL2FrameBuffer.js";

/**
 * Owns WebGL2's opaque-scene-snapshot captures: color (`u_opaqueMap`), depth (`u_opaqueDepthMap`),
 * and normal buffer (`u_normalBufferMap`), copied out of the active framebuffer so refraction,
 * underwater absorption, and decals can sample them without triggering a GL feedback loop.
 */
export class WebGL2OpaqueCapture {
  private _opaqueTexture: WebGLTexture | undefined = undefined;
  private _opaqueDepthTexture: WebGLTexture | undefined = undefined;
  private _opaqueDepthFbo: WebGLFramebuffer | undefined = undefined;
  private _opaqueNormalTexture: WebGLTexture | undefined = undefined;
  private _opaqueNormalFbo: WebGLFramebuffer | undefined = undefined;
  private _opaqueNormalWidth = 0;
  private _opaqueNormalHeight = 0;
  private _opaqueDepthWidth = 0;
  private _opaqueDepthHeight = 0;
  private _opaqueDepthFormat = 0;
  /** Whether the last verified blit read from the HDR FBO; `undefined` until a blit was verified. */
  private _opaqueDepthVerifiedHdr: boolean | undefined = undefined;
  /** Set when no depth format could be blitted from the default framebuffer. */
  private _opaqueDepthUnsupported = false;

  public get opaqueTexture(): WebGLTexture | undefined {
    return this._opaqueTexture;
  }

  public get opaqueDepthTexture(): WebGLTexture | undefined {
    return this._opaqueDepthTexture;
  }

  /** A failed capture leaves the texture allocated but empty: passes must see "no depth", not zeros. */
  public get opaqueDepthTextureForPost(): WebGLTexture | undefined {
    return this._opaqueDepthUnsupported ? undefined : this._opaqueDepthTexture;
  }

  public get opaqueNormalTexture(): WebGLTexture | undefined {
    return this._opaqueNormalTexture;
  }

  /**
   * Copies the normal buffer (COLOR_ATTACHMENT1 of the HDR framebuffer) into a texture decals can
   * sample: reading it while it is still attached to the bound framebuffer would be a feedback loop.
   */
  public copyToOpaqueNormalTexture(
    gl: WebGL2RenderingContext,
    hdr: WebGL2FrameBuffer | undefined,
    hasNormalTarget: boolean,
  ): void {
    if (!hasNormalTarget || !hdr?.secondaryTexture) return;

    const w = gl.canvas.width;
    const h = gl.canvas.height;
    if (!this._opaqueNormalTexture) {
      this._opaqueNormalTexture = gl.createTexture()!;
      this._opaqueNormalFbo = gl.createFramebuffer()!;
    }
    if (this._opaqueNormalWidth !== w || this._opaqueNormalHeight !== h) {
      gl.bindTexture(gl.TEXTURE_2D, this._opaqueNormalTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._opaqueNormalFbo!);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this._opaqueNormalTexture,
        0,
      );
      this._opaqueNormalWidth = w;
      this._opaqueNormalHeight = h;
    }

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hdr.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._opaqueNormalFbo!);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hdr.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    hdr.bind();
  }

  public copyToOpaqueTexture(
    gl: WebGL2RenderingContext,
    hdr: WebGL2FrameBuffer | undefined,
    postProcessingEnabled: boolean,
    textures: WebGLTextureManager,
  ): void {
    const isHdr = postProcessingEnabled && hdr;
    const internalFormat = isHdr ? hdr.internalFormat : gl.RGBA8;

    if (!this._opaqueTexture) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this._opaqueTexture = tex!;

      const dummyTex = Texture.empty();
      dummyTex.isLoaded = true;
      textures.registerTexture(dummyTex, tex!);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this._opaqueTexture);
    }

    gl.copyTexImage2D(gl.TEXTURE_2D, 0, internalFormat, 0, 0, gl.canvas.width, gl.canvas.height, 0);
  }

  /**
   * Captures the opaque depth buffer into a sampleable texture, for underwater/refraction/
   * absorption depth effects (e.g. `OpenWaterMaterial`, `FluidSurfaceMaterial`).
   * `blitFramebuffer` requires the capture texture's depth format to match the source's exactly:
   * with an HDR FBO that is `DEPTH24_STENCIL8`. The default framebuffer's real depth format is
   * implementation-defined (and its reported bit counts are not a reliable guide), so without
   * post-processing the first capture probes the candidate formats until a blit succeeds.
   */
  public copyToOpaqueDepthTexture(
    gl: WebGL2RenderingContext,
    hdr: WebGL2FrameBuffer | undefined,
    isOffscreen: boolean,
  ): void {
    // Offscreen targets (probes, planar reflections) have their own depth attachment -- no capture.
    if (!hdr && (isOffscreen || this._opaqueDepthUnsupported)) return;

    const w = gl.canvas.width;
    const h = gl.canvas.height;
    const candidates = hdr
      ? [gl.DEPTH24_STENCIL8]
      : this._opaqueDepthFormat !== 0
        ? [this._opaqueDepthFormat]
        : [gl.DEPTH24_STENCIL8, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT32F, gl.DEPTH_COMPONENT16];

    if (!this._opaqueDepthTexture) {
      this._opaqueDepthTexture = gl.createTexture()!;
      this._opaqueDepthFbo = gl.createFramebuffer()!;
    }

    let captured = false;
    for (const internalFormat of candidates) {
      let allocated = false;
      if (
        this._opaqueDepthWidth !== w ||
        this._opaqueDepthHeight !== h ||
        this._opaqueDepthFormat !== internalFormat
      ) {
        this._allocateOpaqueDepth(gl, internalFormat, w, h);
        allocated = true;
      }

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, hdr ? hdr.framebuffer : null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._opaqueDepthFbo!);
      // Whether a blit works depends only on the source/target depth formats, so once verified it
      // is not probed again: `getError` is a CPU/GPU sync point and cost ~75% of the frame's JS time.
      if (!allocated && this._opaqueDepthVerifiedHdr === !!hdr) {
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
        captured = true;
        break;
      }
      // Drain stale errors so the blit's own result is unambiguous (bounded: a lost context
      // reports CONTEXT_LOST_WEBGL forever, which would otherwise never leave this loop).
      for (let drained = 0; drained < 8 && gl.NO_ERROR !== gl.getError(); drained++);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      if (gl.NO_ERROR === gl.getError()) {
        this._opaqueDepthVerifiedHdr = !!hdr;
        captured = true;
        break;
      }
    }
    if (!captured) {
      // Sticky on purpose: every candidate format failed, so retrying each frame would only spam
      // GL errors.
      this._opaqueDepthUnsupported = true;
      this._opaqueDepthFormat = 0;
      this._opaqueDepthVerifiedHdr = undefined;
    }

    if (hdr) hdr.bind();
    else gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** (Re)allocates the opaque depth capture texture in `internalFormat` and attaches it. */
  private _allocateOpaqueDepth(
    gl: WebGL2RenderingContext,
    internalFormat: number,
    w: number,
    h: number,
  ): void {
    const hasStencil =
      internalFormat === gl.DEPTH24_STENCIL8 || internalFormat === gl.DEPTH32F_STENCIL8;
    const format = hasStencil ? gl.DEPTH_STENCIL : gl.DEPTH_COMPONENT;
    let type: number = gl.UNSIGNED_INT_24_8;
    if (!hasStencil) {
      if (internalFormat === gl.DEPTH_COMPONENT16) type = gl.UNSIGNED_SHORT;
      else if (internalFormat === gl.DEPTH_COMPONENT32F) type = gl.FLOAT;
      else type = gl.UNSIGNED_INT;
    }

    gl.bindTexture(gl.TEXTURE_2D, this._opaqueDepthTexture!);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._opaqueDepthFbo!);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, null, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      hasStencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT,
      gl.TEXTURE_2D,
      this._opaqueDepthTexture!,
      0,
    );

    this._opaqueDepthWidth = w;
    this._opaqueDepthHeight = h;
    this._opaqueDepthFormat = internalFormat;
  }

  /** Drops stale handles after a WebGL context loss (nothing to delete on the dead context). */
  public resetOnContextRestored(): void {
    this._opaqueTexture = undefined;
    this._opaqueDepthTexture = undefined;
    this._opaqueDepthFbo = undefined;
    this._opaqueDepthWidth = 0;
    this._opaqueDepthHeight = 0;
    this._opaqueDepthFormat = 0;
    this._opaqueDepthVerifiedHdr = undefined;
    this._opaqueDepthUnsupported = false;
    this._opaqueNormalTexture = undefined;
    this._opaqueNormalFbo = undefined;
    this._opaqueNormalWidth = 0;
    this._opaqueNormalHeight = 0;
  }

  /** Frees all GL textures and framebuffers owned by opaque capture. */
  public destroy(gl: WebGL2RenderingContext): void {
    if (this._opaqueNormalTexture) gl.deleteTexture(this._opaqueNormalTexture);
    if (this._opaqueNormalFbo) gl.deleteFramebuffer(this._opaqueNormalFbo);
    if (this._opaqueTexture) gl.deleteTexture(this._opaqueTexture);
    if (this._opaqueDepthTexture) gl.deleteTexture(this._opaqueDepthTexture);
    if (this._opaqueDepthFbo) gl.deleteFramebuffer(this._opaqueDepthFbo);
    this.resetOnContextRestored();
  }
}
