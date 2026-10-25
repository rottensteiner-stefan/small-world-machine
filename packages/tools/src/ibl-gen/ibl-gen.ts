import {
  Matrix4,
  Vector3D,
  PerspectiveProjection,
  MathUtils,
  compileProgram,
} from "@small-world-machine/engine";
import { IBLShaders } from "./IBLShaders.js";
import { IBL_GEN_DEFAULTS, type IblGenDefaults } from "./ibl-gen-core.js";

function createProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string,
): WebGLProgram {
  return compileProgram(gl, vsSource, fsSource, "ibl-gen");
}

// 3D Cube geometry for sampling (rendering the inside of a cube to cover view)
const cubeVertices = new Float32Array([
  // Back face
  -1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, -1.0, -1.0, -1.0, -1.0, 1.0,
  -1.0,
  // Front face
  -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0,
  // Left face
  -1.0, 1.0, 1.0, -1.0, 1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, 1.0, -1.0, 1.0,
  1.0,
  // Right face
  1.0, 1.0, 1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0,
  // Bottom face
  -1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, -1.0,
  -1.0,
  // Top face
  -1.0, 1.0, -1.0, 1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0,
]);

// 2D Quad geometry
const quadVertices = new Float32Array([
  // pos (x,y), uv (x,y)
  -1.0, 1.0, 0.0, 1.0, -1.0, -1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 0.0,
]);

export class IBLBaker {
  private _gl: WebGL2RenderingContext;
  private _fbo: WebGLFramebuffer;
  private _captureProjection: Float32Array;
  private _captureViews: Float32Array[];

  private _brdfProgram: WebGLProgram;
  private _equiProgram: WebGLProgram;
  private _irradianceProgram: WebGLProgram;
  private _prefilterProgram: WebGLProgram;
  private readonly _options: IblGenDefaults;

  constructor(options: IblGenDefaults = IBL_GEN_DEFAULTS) {
    this._options = options;
    // Create a hidden canvas for processing
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    this._gl = canvas.getContext("webgl2", { antialias: false })!;
    if (!this._gl) throw new Error("WebGL2 not supported");

    // WebGL2 extension for float rendering
    this._gl.getExtension("EXT_color_buffer_float");

    this._fbo = this._gl.createFramebuffer()!;

    // 90 deg FOV projection
    const proj = new PerspectiveProjection({
      fov: Math.PI / 2, // 90 degrees
      aspect: 1.0,
      near: 0.1,
      far: 10.0,
    });
    this._captureProjection = proj.getMatrix().data;

    // View matrices for 6 cube faces
    const center = new Vector3D(0, 0, 0);
    const m1 = new Matrix4(),
      m2 = new Matrix4(),
      m3 = new Matrix4(),
      m4 = new Matrix4(),
      m5 = new Matrix4(),
      m6 = new Matrix4();
    Matrix4.lookAt(center, new Vector3D(1, 0, 0), new Vector3D(0, -1, 0), m1);
    Matrix4.lookAt(center, new Vector3D(-1, 0, 0), new Vector3D(0, -1, 0), m2);
    Matrix4.lookAt(center, new Vector3D(0, 1, 0), new Vector3D(0, 0, 1), m3);
    Matrix4.lookAt(center, new Vector3D(0, -1, 0), new Vector3D(0, 0, -1), m4);
    Matrix4.lookAt(center, new Vector3D(0, 0, 1), new Vector3D(0, -1, 0), m5);
    Matrix4.lookAt(center, new Vector3D(0, 0, -1), new Vector3D(0, -1, 0), m6);

    this._captureViews = [m1.data, m2.data, m3.data, m4.data, m5.data, m6.data];

    // Compile programs
    this._brdfProgram = createProgram(
      this._gl,
      IBLShaders.brdfVertexShader,
      IBLShaders.brdfFragmentShader,
    );
    this._equiProgram = createProgram(
      this._gl,
      IBLShaders.cubeVertexShader,
      IBLShaders.equirectangularFragmentShader,
    );
    this._irradianceProgram = createProgram(
      this._gl,
      IBLShaders.cubeVertexShader,
      IBLShaders.irradianceFragmentShader,
    );
    this._prefilterProgram = createProgram(
      this._gl,
      IBLShaders.cubeVertexShader,
      IBLShaders.prefilterFragmentShader,
    );
  }

  public async loadEquirectangularImage(
    fileOrBlob: Blob | File | ImageBitmap,
  ): Promise<WebGLTexture> {
    const gl = this._gl;
    // The sampler expects GL convention (row 0 = bottom); decoded images start at the top row.
    // UNPACK_FLIP_Y is ignored for ImageBitmap, so the flip has to happen at decode time. A
    // caller-supplied ImageBitmap is re-decoded flipped too, so both input paths share one
    // orientation (the caller keeps ownership of, and is not mutated through, its bitmap).
    const bitmap = await createImageBitmap(fileOrBlob, { imageOrientation: "flipY" });
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    bitmap.close();
    return tex;
  }

  public async generateEnvironmentCubemap(
    equiTex: WebGLTexture,
    targetCanvasId: string,
  ): Promise<WebGLTexture> {
    const gl = this._gl;
    const resolution = this._options.envResolution;

    const envCube = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCube);
    for (let i = 0; i < 6; i++) {
      gl.texImage2D(
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
        0,
        gl.RGBA16F,
        resolution,
        resolution,
        0,
        gl.RGBA,
        gl.FLOAT,
        null,
      );
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Cube VAO
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, cubeVertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);

    gl.useProgram(this._equiProgram);
    gl.uniform1i(gl.getUniformLocation(this._equiProgram, "u_equirectangularMap"), 0);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this._equiProgram, "u_projection"),
      false,
      this._captureProjection,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, equiTex);

    gl.viewport(0, 0, resolution, resolution);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);

    for (let i = 0; i < 6; i++) {
      gl.uniformMatrix4fv(
        gl.getUniformLocation(this._equiProgram, "u_view"),
        false,
        this._captureViews[i]!,
      );
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
        envCube,
        0,
      );
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    }

    // Generate mipmaps for base envMap
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCube);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);

    // Read back +Z face (index 4) for preview
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
      envCube,
      0,
    );
    const pixels = new Float32Array(resolution * resolution * 4);
    gl.readPixels(0, 0, resolution, resolution, gl.RGBA, gl.FLOAT, pixels);

    const destCanvas = document.getElementById(targetCanvasId) as HTMLCanvasElement;
    destCanvas.width = resolution;
    destCanvas.height = resolution;
    const destCtx = destCanvas.getContext("2d")!;
    const imgData = destCtx.createImageData(resolution, resolution);
    for (let i = 0; i < resolution * resolution; i++) {
      imgData.data[i * 4] = MathUtils.clamp(pixels[i * 4]! * 255, 0, 255);
      imgData.data[i * 4 + 1] = MathUtils.clamp(pixels[i * 4 + 1]! * 255, 0, 255);
      imgData.data[i * 4 + 2] = MathUtils.clamp(pixels[i * 4 + 2]! * 255, 0, 255);
      imgData.data[i * 4 + 3] = 255;
    }
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = resolution;
    tempCanvas.height = resolution;
    tempCanvas.getContext("2d")!.putImageData(imgData, 0, 0);
    destCtx.save();
    destCtx.scale(1, -1);
    destCtx.drawImage(tempCanvas, 0, -destCanvas.height, destCanvas.width, destCanvas.height);
    destCtx.restore();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return envCube;
  }

  public async generateIrradianceCubemap(
    envCubeTex: WebGLTexture,
    targetCanvasId: string,
  ): Promise<WebGLTexture> {
    const gl = this._gl;
    const resolution = this._options.irradianceResolution;

    const irradianceMap = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, irradianceMap);
    for (let i = 0; i < 6; i++) {
      gl.texImage2D(
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
        0,
        gl.RGBA16F,
        resolution,
        resolution,
        0,
        gl.RGBA,
        gl.FLOAT,
        null,
      );
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.useProgram(this._irradianceProgram);
    gl.uniform1i(gl.getUniformLocation(this._irradianceProgram, "u_environmentMap"), 0);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this._irradianceProgram, "u_projection"),
      false,
      this._captureProjection,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCubeTex);

    gl.viewport(0, 0, resolution, resolution);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);

    for (let i = 0; i < 6; i++) {
      gl.uniformMatrix4fv(
        gl.getUniformLocation(this._irradianceProgram, "u_view"),
        false,
        this._captureViews[i]!,
      );
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
        irradianceMap,
        0,
      );
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    }

    // Read back +Z face (index 4) for preview
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
      irradianceMap,
      0,
    );
    const pixels = new Float32Array(resolution * resolution * 4);
    gl.readPixels(0, 0, resolution, resolution, gl.RGBA, gl.FLOAT, pixels);

    const destCanvas = document.getElementById(targetCanvasId) as HTMLCanvasElement;
    destCanvas.width = resolution;
    destCanvas.height = resolution;
    const destCtx = destCanvas.getContext("2d")!;
    const imgData = destCtx.createImageData(resolution, resolution);
    for (let i = 0; i < resolution * resolution; i++) {
      imgData.data[i * 4] = MathUtils.clamp(pixels[i * 4]! * 255, 0, 255);
      imgData.data[i * 4 + 1] = MathUtils.clamp(pixels[i * 4 + 1]! * 255, 0, 255);
      imgData.data[i * 4 + 2] = MathUtils.clamp(pixels[i * 4 + 2]! * 255, 0, 255);
      imgData.data[i * 4 + 3] = 255;
    }
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = resolution;
    tempCanvas.height = resolution;
    tempCanvas.getContext("2d")!.putImageData(imgData, 0, 0);
    destCtx.save();
    destCtx.scale(1, -1);
    destCtx.drawImage(tempCanvas, 0, -destCanvas.height, destCanvas.width, destCanvas.height);
    destCtx.restore();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return irradianceMap;
  }

  public async generatePrefilteredCubemap(
    envCubeTex: WebGLTexture,
    targetCanvasId: string,
  ): Promise<WebGLTexture> {
    const gl = this._gl;
    const baseResolution = this._options.prefilterResolution;

    const prefilteredMap = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, prefilteredMap);
    for (let i = 0; i < 6; i++) {
      gl.texImage2D(
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
        0,
        gl.RGBA16F,
        baseResolution,
        baseResolution,
        0,
        gl.RGBA,
        gl.FLOAT,
        null,
      );
    }
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Allocate memory for mipmaps
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);

    gl.useProgram(this._prefilterProgram);
    gl.uniform1i(gl.getUniformLocation(this._prefilterProgram, "u_environmentMap"), 0);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(this._prefilterProgram, "u_projection"),
      false,
      this._captureProjection,
    );
    gl.uniform1f(
      gl.getUniformLocation(this._prefilterProgram, "u_resolution"),
      this._options.envResolution,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, envCubeTex);

    // Enable seamless cubemap filtering if possible (WebGL2 default for some things, but good to be careful)

    const maxMipLevels = this._options.prefilterMips;

    for (let mip = 0; mip < maxMipLevels; ++mip) {
      // resize framebuffer according to mip-level size.
      const mipWidth = Math.floor(baseResolution * Math.pow(0.5, mip));
      const mipHeight = Math.floor(baseResolution * Math.pow(0.5, mip));

      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
      gl.viewport(0, 0, mipWidth, mipHeight);

      const roughness = mip / (maxMipLevels - 1);
      gl.uniform1f(gl.getUniformLocation(this._prefilterProgram, "u_roughness"), roughness);

      for (let i = 0; i < 6; ++i) {
        gl.uniformMatrix4fv(
          gl.getUniformLocation(this._prefilterProgram, "u_view"),
          false,
          this._captureViews[i]!,
        );
        // Attach mip level of cubemap to framebuffer
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
          prefilteredMap,
          mip,
        );
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 36);
      }

      // Read back +Z face at mip level 2 (roughness 0.5) for preview
      if (mip === 2) {
        gl.framebufferTexture2D(
          gl.FRAMEBUFFER,
          gl.COLOR_ATTACHMENT0,
          gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
          prefilteredMap,
          mip,
        );
        const pixels = new Float32Array(mipWidth * mipHeight * 4);
        gl.readPixels(0, 0, mipWidth, mipHeight, gl.RGBA, gl.FLOAT, pixels);

        const destCanvas = document.getElementById(targetCanvasId) as HTMLCanvasElement;
        destCanvas.width = mipWidth;
        destCanvas.height = mipHeight;
        const destCtx = destCanvas.getContext("2d")!;
        const imgData = destCtx.createImageData(mipWidth, mipHeight);
        for (let i = 0; i < mipWidth * mipHeight; i++) {
          imgData.data[i * 4] = MathUtils.clamp(pixels[i * 4]! * 255, 0, 255);
          imgData.data[i * 4 + 1] = MathUtils.clamp(pixels[i * 4 + 1]! * 255, 0, 255);
          imgData.data[i * 4 + 2] = MathUtils.clamp(pixels[i * 4 + 2]! * 255, 0, 255);
          imgData.data[i * 4 + 3] = 255;
        }
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = mipWidth;
        tempCanvas.height = mipHeight;
        tempCanvas.getContext("2d")!.putImageData(imgData, 0, 0);
        destCtx.save();
        destCtx.scale(1, -1);
        destCtx.drawImage(tempCanvas, 0, -destCanvas.height, destCanvas.width, destCanvas.height);
        destCtx.restore();
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return prefilteredMap;
  }

  public async generateBRDF(targetCanvasId: string): Promise<void> {
    const gl = this._gl;
    const size = this._options.brdfResolution;

    // Set up quad VAO
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    // Create target texture (LUT)
    const lutTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, size, size, 0, gl.RG, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lutTex, 0);

    gl.viewport(0, 0, size, size);
    gl.useProgram(this._brdfProgram);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Read back or draw to preview canvas
    const destCanvas = document.getElementById(targetCanvasId) as HTMLCanvasElement;
    const destCtx = destCanvas.getContext("2d")!;

    const pixels = new Float32Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, pixels);

    // Convert Float32 RG to Uint8ClampedArray for Canvas ImageData
    const imgData = destCtx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      imgData.data[i * 4] = MathUtils.clamp(pixels[i * 4]! * 255, 0, 255); // R
      imgData.data[i * 4 + 1] = MathUtils.clamp(pixels[i * 4 + 1]! * 255, 0, 255); // G
      imgData.data[i * 4 + 2] = 0; // B
      imgData.data[i * 4 + 3] = 255; // A
    }

    // Image is flipped vertically in WebGL, so flip it in canvas
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = size;
    tempCanvas.height = size;
    tempCanvas.getContext("2d")!.putImageData(imgData, 0, 0);

    destCtx.save();
    destCtx.scale(1, -1);
    destCtx.drawImage(tempCanvas, 0, -destCanvas.height, destCanvas.width, destCanvas.height);
    destCtx.restore();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Exports a cubemap as a horizontal-cross PNG, sRGB-encoded (1/2.2) like every 8-bit IBL file the
   * engine loads; the engine decodes it with sRGBToLinear (ADR 0048).
   */
  public exportCubemapToCross(texture: WebGLTexture, size: number, mip: number = 0): Promise<Blob> {
    return new Promise((resolve) => {
      const gl = this._gl;
      const crossCanvas = document.createElement("canvas");
      crossCanvas.width = size * 4;
      crossCanvas.height = size * 3;
      const ctx = crossCanvas.getContext("2d")!;

      const faces = [
        { face: gl.TEXTURE_CUBE_MAP_POSITIVE_X, col: 2, row: 1 },
        { face: gl.TEXTURE_CUBE_MAP_NEGATIVE_X, col: 0, row: 1 },
        { face: gl.TEXTURE_CUBE_MAP_POSITIVE_Y, col: 1, row: 0 },
        { face: gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, col: 1, row: 2 },
        { face: gl.TEXTURE_CUBE_MAP_POSITIVE_Z, col: 1, row: 1 },
        { face: gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, col: 3, row: 1 },
      ];

      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
      const pixels = new Float32Array(size * size * 4);
      const imgData = ctx.createImageData(size, size);
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = size;
      tempCanvas.height = size;
      const tempCtx = tempCanvas.getContext("2d")!;

      for (const face of faces) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, face.face, texture, mip);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, pixels);
        for (let i = 0; i < size * size; i++) {
          // Convert from HDR/Float to standard 8-bit. For a real engine, we'd export HDR formats.
          // Since we're exporting PNG, we tonemap or just clamp to 255.
          const r = Math.pow(pixels[i * 4]!, 1.0 / 2.2);
          const g = Math.pow(pixels[i * 4 + 1]!, 1.0 / 2.2);
          const b = Math.pow(pixels[i * 4 + 2]!, 1.0 / 2.2);
          imgData.data[i * 4] = MathUtils.clamp(r * 255, 0, 255);
          imgData.data[i * 4 + 1] = MathUtils.clamp(g * 255, 0, 255);
          imgData.data[i * 4 + 2] = MathUtils.clamp(b * 255, 0, 255);
          imgData.data[i * 4 + 3] = 255;
        }
        tempCtx.putImageData(imgData, 0, 0);

        ctx.save();
        ctx.translate(face.col * size, face.row * size + size);
        ctx.scale(1, -1);
        ctx.drawImage(tempCanvas, 0, 0);
        ctx.restore();
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      crossCanvas.toBlob((blob) => resolve(blob!), "image/png");
    });
  }

  /** Releases the GL programs, framebuffer and context. The baker is unusable afterwards. */
  public dispose(): void {
    const gl = this._gl;
    gl.deleteProgram(this._brdfProgram);
    gl.deleteProgram(this._equiProgram);
    gl.deleteProgram(this._irradianceProgram);
    gl.deleteProgram(this._prefilterProgram);
    gl.deleteFramebuffer(this._fbo);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  public exportBRDFToBlob(canvasId: string): Promise<Blob> {
    return new Promise((resolve) => {
      const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
      canvas.toBlob((blob) => resolve(blob!), "image/png");
    });
  }
}

/**
 * Initializes the standalone IBL Generator tool UI.
 * Only executes if #dropzone is present in the DOM.
 */
export function initIBLGenTool(): void {
  if (typeof document === "undefined") return;

  const dropzone = document.getElementById("dropzone");
  if (!dropzone) return;

  const input = document.getElementById("skyboxInput") as HTMLInputElement;
  const generateBtn = document.getElementById("generateBtn") as HTMLButtonElement;
  const exportBtn = document.getElementById("exportBtn") as HTMLButtonElement;
  if (!input || !generateBtn || !exportBtn) return;

  let baker: IBLBaker | null = null;

  try {
    baker = new IBLBaker();
  } catch (e: unknown) {
    console.error(e);
    alert("Initialization failed: " + (e as Error).message);
  }

  const dropzoneText = dropzone.querySelector(".dropzone-text") as HTMLElement;

  function handleFileSelect(file: File): void {
    if (file) {
      dropzoneText.innerText = file.name;
      generateBtn.disabled = false;
    }
  }

  input.addEventListener("change", (): void => {
    if (input.files && input.files.length > 0) {
      handleFileSelect(input.files[0]!);
    }
  });

  dropzone.addEventListener("click", () => input.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", (): void => {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files.length > 0) {
      input.files = e.dataTransfer.files;
      handleFileSelect(e.dataTransfer.files[0]!);
    }
  });

  let generatedEnvCube: WebGLTexture | null = null;
  let generatedIrradianceCube: WebGLTexture | null = null;
  let generatedPrefilteredCube: WebGLTexture | null = null;

  generateBtn.addEventListener("click", async (): Promise<void> => {
    if (!baker || !input.files || input.files.length === 0) return;
    generateBtn.disabled = true;
    exportBtn.disabled = true;
    const text = document.getElementById("progressText")!;
    text.style.display = "block";
    text.innerText = "Generating BRDF LUT...";

    try {
      await baker.generateBRDF("brdfCanvas");
      text.innerText = "BRDF LUT Generated! Equirectangular coming next...";

      text.innerText = "Loading HDR/Panorama...";
      const equiTex = await baker.loadEquirectangularImage(input.files[0]!);

      text.innerText = "Generating Environment CubeMap...";
      generatedEnvCube = await baker.generateEnvironmentCubemap(equiTex, "envCanvas");

      text.innerText = "Base CubeMap Generated! Generating Irradiance Convolution...";
      generatedIrradianceCube = await baker.generateIrradianceCubemap(
        generatedEnvCube,
        "irradianceCanvas",
      );

      text.innerText = "Irradiance Map Generated! Generating GGX Prefilter...";
      generatedPrefilteredCube = await baker.generatePrefilteredCubemap(
        generatedEnvCube,
        "prefilterCanvas",
      );

      text.innerText = "All Maps Generated! Ready for Export.";
      exportBtn.disabled = false;
      exportBtn.style.opacity = "1";
    } catch (e) {
      console.error(e);
      text.innerText = "Error occurred.";
    }
  });

  exportBtn.addEventListener("click", async (): Promise<void> => {
    if (!baker || !generatedEnvCube || !generatedIrradianceCube || !generatedPrefilteredCube)
      return;
    exportBtn.disabled = true;
    const originalText = exportBtn.innerText;
    exportBtn.innerText = "Zipping...";

    try {
      // @ts-expect-error - JSZip is loaded globally
      const zip = new JSZip();

      zip.file("env.webp", await baker.exportCubemapToCross(generatedEnvCube, 512, 0));
      zip.file("irradiance.webp", await baker.exportCubemapToCross(generatedIrradianceCube, 32, 0));

      // Export 5 mip levels for prefiltered
      const prefilterFolder = zip.folder("prefilter");
      let prefilterSize = 128;
      for (let i = 0; i < 5; i++) {
        prefilterFolder.file(
          `mip${i}.png`,
          await baker.exportCubemapToCross(generatedPrefilteredCube, prefilterSize, i),
        );
        prefilterSize = Math.floor(prefilterSize / 2);
      }

      zip.file("brdf_lut.webp", await baker.exportBRDFToBlob("brdfCanvas"));

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ibl_maps.zip";
      a.click();
      URL.revokeObjectURL(url);

      exportBtn.innerText = "Export Complete!";
      setTimeout((): void => {
        exportBtn.innerText = originalText;
        exportBtn.disabled = false;
      }, 2000);
    } catch (e) {
      console.error(e);
      alert("Error during export.");
      exportBtn.innerText = originalText;
      exportBtn.disabled = false;
    }
  });
}

// Auto-run only when loaded inside public/tools/ibl-gen.html
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", (): void => {
      if (document.getElementById("dropzone")) {
        initIBLGenTool();
      }
    });
  } else if (document.getElementById("dropzone")) {
    initIBLGenTool();
  }
}
