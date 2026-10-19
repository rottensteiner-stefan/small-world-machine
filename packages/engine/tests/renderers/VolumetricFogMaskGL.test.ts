import { describe, it, expect, vi } from "vitest";
import { VolumetricFogPassGL } from "../../src/renderers/post/passes/VolumetricFogPassGL.js";
import {
  createGLPostEffectContext,
  type GLPostEffectPassContext,
} from "../../src/renderers/post/passes/GLPostEffectPass.js";
import { VolumetricFogElement } from "../../src/renderers/post/elements/VolumetricFogElement.js";
import { DirectionalLight } from "../../src/core/lights/index.js";
import { FogVolume } from "../../src/core/objects/FogVolume.js";
import { VolumetricTexture } from "../../src/core/textures/index.js";
import { Vector3D } from "../../src/math/index.js";
import { Color } from "../../src/core/colors/index.js";

interface MaskUploadRecord {
  width: number;
  height: number;
  depth: number;
}

interface TextureBinding {
  target: number;
  texture: unknown;
}

/**
 * Builds a minimal WebGL2 pass context for these unit tests (mirrors the renderer's per-frame
 * repopulation of the reusable context; see GLPostEffectPassContext).
 */
function makeFogCtx(
  gl: WebGL2RenderingContext,
  element: VolumetricFogElement,
  dirLight?: DirectionalLight,
  volumes: FogVolume[] = [],
): GLPostEffectPassContext {
  const ctx = createGLPostEffectContext();
  ctx.gl = gl;
  ctx.width = 800;
  ctx.height = 600;
  ctx.colorTexture = {} as WebGLTexture;
  ctx.depthTexture = {} as WebGLTexture;
  ctx.viewProjMatrix = new Float32Array(16);
  ctx.camPos = new Vector3D(0, 0, 0);
  ctx.near = 0.1;
  ctx.far = 1000;
  ctx.element = element;
  ctx.fogVolumes = volumes;
  if (dirLight !== undefined) {
    ctx.lights = {
      aCol: new Color(0, 0, 0),
      aIntensity: 0,
      dDir: new Vector3D(0, 0, 0),
      dCol: new Color(0, 0, 0),
      dIntensity: 0,
      dLight: dirLight,
      pLights: [],
      sLights: [],
      aLights: [],
    };
  }
  return ctx;
}

/** Builds a WebGL2 mock that records uniform uploads, 3D-texture uploads and per-unit bindings. */
function makeMaskGl(): {
  gl2: WebGL2RenderingContext;
  uniformCalls: Record<string, unknown>;
  bindUnit: (unit: number) => TextureBinding | undefined;
  texImage3DCalls: MaskUploadRecord[];
  createdTextures: () => number;
  deletedTextures: () => number;
} {
  const uniformCalls: Record<string, unknown> = {};
  const bindings = new Map<number, TextureBinding>();
  const texImage3DCalls: MaskUploadRecord[] = [];
  let currentUnit = 0;
  let createdTextures = 0;
  let deletedTextures = 0;

  const gl2 = {
    TEXTURE0: 0x84c0,
    TEXTURE_CUBE_MAP: 0x8513,
    TEXTURE_2D: 0x0de1,
    TEXTURE_3D: 0x806f,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_WRAP_R: 0x8072,
    RGBA8: 0x8058,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    NEAREST_MIPMAP_NEAREST: 0x2700,
    NEAREST_MIPMAP_LINEAR: 0x2702,
    LINEAR_MIPMAP_NEAREST: 0x2701,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    CLAMP_TO_EDGE: 0x812f,
    REPEAT: 0x2901,
    MIRRORED_REPEAT: 0x8370,
    RGBA16F: 0x881a,
    HALF_FLOAT: 0x140b,
    FLOAT: 0x1406,
    FRAMEBUFFER: 0x8d40,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    RENDERBUFFER: 0x8d41,
    DEPTH24_STENCIL8: 0x88f0,
    DEPTH_STENCIL_ATTACHMENT: 0x821a,
    DEPTH_TEST: 0x0b71,
    BLEND: 0x0be2,
    TRIANGLES: 0x0004,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    deleteShader: () => {},
    deleteProgram: () => {},
    getProgramParameter: () => true,
    getUniformLocation: (_prog: unknown, name: string) => name,
    createVertexArray: () => ({}),
    deleteVertexArray: () => {},
    createTexture: () => {
      createdTextures++;
      return { id: createdTextures };
    },
    deleteTexture: () => {
      deletedTextures++;
    },
    deleteFramebuffer: () => {},
    deleteRenderbuffer: () => {},
    bindTexture: (target: number, texture: unknown) => {
      bindings.set(currentUnit, { target, texture });
    },
    activeTexture: (unit: number) => {
      currentUnit = unit;
    },
    texParameteri: () => {},
    texImage2D: () => {},
    texImage3D: (
      _target: number,
      _level: number,
      _internalformat: number,
      width: number,
      height: number,
      depth: number,
      _border: number,
      _format: number,
      _type: number,
      _source: Uint8Array,
    ) => {
      texImage3DCalls.push({ width, height, depth });
    },
    generateMipmap: () => {},
    createFramebuffer: () => ({}),
    bindFramebuffer: () => {},
    framebufferTexture2D: () => {},
    createRenderbuffer: () => ({}),
    bindRenderbuffer: () => {},
    renderbufferStorage: () => {},
    framebufferRenderbuffer: () => {},
    checkFramebufferStatus: () => 0x8cd5,
    viewport: () => {},
    disable: () => {},
    depthMask: () => {},
    useProgram: () => {},
    bindVertexArray: () => {},
    drawArrays: () => {},
    uniform1i: (loc: unknown, val: number) => {
      uniformCalls[String(loc)] = val;
    },
    uniform1f: (loc: unknown, val: number) => {
      uniformCalls[String(loc)] = val;
    },
    uniform1iv: (loc: unknown, val: Int32Array) => {
      uniformCalls[String(loc)] = Array.from(val);
    },
    uniform2f: () => {},
    uniform3f: (loc: unknown, x: number, y: number, z: number) => {
      uniformCalls[String(loc)] = [x, y, z];
    },
    uniform4f: () => {},
    uniform4fv: (loc: unknown, val: Float32Array) => {
      uniformCalls[String(loc)] = Array.from(val);
    },
    uniformMatrix4fv: () => {},
  } as unknown as WebGL2RenderingContext;

  return {
    gl2,
    uniformCalls,
    bindUnit: (unit: number) => bindings.get(unit),
    texImage3DCalls,
    createdTextures: () => createdTextures,
    deletedTextures: () => deletedTextures,
  };
}

/** Runs a single masked-volume execute against its own fresh pass + GL mock. */
function runMaskedVolume(
  volumes: FogVolume[],
  scatterAlbedo = 0.5,
): {
  mock: ReturnType<typeof makeMaskGl>;
  pass: VolumetricFogPassGL;
  element: VolumetricFogElement;
} {
  const mock = makeMaskGl();
  const pass = new VolumetricFogPassGL(mock.gl2, true);
  const element = new VolumetricFogElement();
  element.enabled = true;
  element.scatteringAlbedo = scatterAlbedo;
  pass.execute(makeFogCtx(mock.gl2, element, undefined, volumes));
  return { mock, pass, element };
}

describe("VolumetricFogPassGL density masks", () => {
  it("leaves the no-mask rendering path untouched (no 3D texture work, element mask disabled)", () => {
    const mock = makeMaskGl();
    const pass = new VolumetricFogPassGL(mock.gl2, true);
    const element = new VolumetricFogElement();
    element.enabled = true;
    element.scatteringAlbedo = 0.5;

    pass.execute(makeFogCtx(mock.gl2, element));

    expect(mock.texImage3DCalls).toHaveLength(0);
    expect(mock.uniformCalls["u_elementMaskEnabled"]).toBe(0);
    const info = mock.uniformCalls["u_fogVolumeMaskInfo"] as number[];
    expect(info).toBeDefined();
    expect(info.length).toBe(64);
    expect(info.every((v) => v === 0)).toBe(true);
  });

  it("bakes the global albedo into the sun colour when no element mask is bound", () => {
    const mock = makeMaskGl();
    const pass = new VolumetricFogPassGL(mock.gl2, true);
    const element = new VolumetricFogElement();
    element.enabled = true;
    element.scatteringAlbedo = 0.5;

    const sun = new DirectionalLight({ intensity: 2 });
    sun.volumetricIntensity = 1.5;
    sun.color.set(0.8, 0.6, 0.4);
    sun.direction.set(0, -1, 0);

    pass.execute(makeFogCtx(mock.gl2, element, sun));

    // baked: sunScale = 2 * 1.5 * 0.5 = 1.5, times the light/element tint.
    const sunColor = mock.uniformCalls["u_sunColor"] as number[];
    expect(sunColor).toBeDefined();
    expect(sunColor[0]).toBeCloseTo(0.8 * 1.0 * 1.5, 10);
    expect(sunColor[1]).toBeCloseTo(0.6 * 1.0 * 1.5, 10);
    expect(sunColor[2]).toBeCloseTo(0.4 * 1.0 * 1.5, 10);
    expect(mock.uniformCalls["u_elementMaskEnabled"]).toBe(0);
  });

  it("unbakes the albedo and enables the element mask when one is bound", () => {
    const mock = makeMaskGl();
    const pass = new VolumetricFogPassGL(mock.gl2, true);
    const element = new VolumetricFogElement();
    element.enabled = true;
    element.scatteringAlbedo = 0.5;
    element.densityMask = VolumetricTexture.fromData(new Uint8Array(4 * 2 * 2 * 2), 2, 2, 2);
    element.maskPosition.set(10, 20, 30);
    element.maskSize.set(5, 6, 7);

    const sun = new DirectionalLight({ intensity: 2 });
    sun.volumetricIntensity = 1.5;
    sun.color.set(0.8, 0.6, 0.4);
    sun.direction.set(0, -1, 0);

    pass.execute(makeFogCtx(mock.gl2, element, sun));

    // unbaked: sunScale = 2 * 1.5 * 1.0 = 3.0, the per-cell albedo is applied in the shader.
    const sunColor = mock.uniformCalls["u_sunColor"] as number[];
    expect(sunColor[0]).toBeCloseTo(0.8 * 1.0 * 3.0, 10);
    expect(sunColor[1]).toBeCloseTo(0.6 * 1.0 * 3.0, 10);
    expect(sunColor[2]).toBeCloseTo(0.4 * 1.0 * 3.0, 10);

    expect(mock.uniformCalls["u_elementMaskEnabled"]).toBe(1);
    expect(mock.uniformCalls["u_elementMaskAlbedo"]).toBe(0.5);
    const box = mock.uniformCalls["u_elementMaskBox"] as number[];
    expect(box).toBeDefined();
    expect(box[0]).toBe(10);
    expect(box[1]).toBe(20);
    expect(box[2]).toBe(30);
    const size = mock.uniformCalls["u_elementMaskSize"] as number[];
    expect(size[0]).toBe(5);
    expect(size[1]).toBe(6);
    expect(size[2]).toBe(7);

    // The element mask must be bound on its own unit (7) as a TEXTURE_3D.
    const binding = mock.bindUnit(0x84c7);
    expect(binding).toBeDefined();
    expect(binding!.target).toBe(0x806f);
    // The mask data was uploaded once (2x2x2), plus the lazily created identity placeholder (1x1x1).
    const upload = mock.texImage3DCalls.find(
      (c) => c.width === 2 && c.height === 2 && c.depth === 2,
    );
    expect(upload).toBeDefined();
  });

  it("assigns a per-volume mask to the first slot and records it per volume index", () => {
    const mask = VolumetricTexture.fromData(new Uint8Array(4 * 1 * 1 * 1), 1, 1, 1);
    const volume = new FogVolume({ densityMask: mask, size: new Vector3D(4, 5, 6) });
    const { mock } = runMaskedVolume([volume]);

    expect(mock.uniformCalls["u_elementMaskEnabled"]).toBe(0);
    const info = mock.uniformCalls["u_fogVolumeMaskInfo"] as number[];
    expect(info[0]).toBe(1); // volume 0 has a bound mask
    expect(info[1]).toBe(0); // compacted to slot 0
    // Slot 0 must be bound as TEXTURE_3D on unit 8.
    expect(mock.bindUnit(0x84c8)!.target).toBe(0x806f);
  });

  it("ties mask slots to the volume index, not the compaction order", () => {
    const plain = new FogVolume({ density: 0.05 });
    const mask = VolumetricTexture.fromData(new Uint8Array(4 * 1 * 1 * 1), 1, 1, 1);
    const masked = new FogVolume({ densityMask: mask });
    const { mock } = runMaskedVolume([plain, masked]);

    const info = mock.uniformCalls["u_fogVolumeMaskInfo"] as number[];
    // The plain volume at index 0 keeps no slot; the masked volume at index 1 gets slot 0.
    expect(info[0]).toBe(0);
    expect(info[1]).toBe(0);
    expect(info[4]).toBe(1);
    expect(info[5]).toBe(0);
  });

  it("re-uploads a volume mask when needsUpdate is flagged and clears the flag", () => {
    const mask = VolumetricTexture.fromData(new Uint8Array(4 * 2 * 2 * 2), 2, 2, 2);
    const volume = new FogVolume({ densityMask: mask });
    const { mock, pass, element } = runMaskedVolume([volume]);

    const uploadsAfterFirst = mock.texImage3DCalls.length;
    // identity (1x1x1) + mask (2x2x2)
    expect(uploadsAfterFirst).toBe(2);
    expect(mask.needsUpdate).toBe(false);

    mask.needsUpdate = true;
    pass.execute(makeFogCtx(mock.gl2, element, undefined, [volume]));

    // Re-uploaded exactly once; the identity placeholder and cache hit must not re-upload.
    expect(mock.texImage3DCalls.length).toBe(uploadsAfterFirst + 1);
    expect(mask.needsUpdate).toBe(false);
  });

  it("drops masked volumes beyond the slot budget and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const volumes: FogVolume[] = [];
      for (let i = 0; i < 9; i++) {
        volumes.push(
          new FogVolume({
            densityMask: VolumetricTexture.fromData(new Uint8Array(4 * 1 * 1 * 1), 1, 1, 1),
          }),
        );
      }
      const { mock, pass } = runMaskedVolume(volumes, 0.5);
      void pass;

      const info = mock.uniformCalls["u_fogVolumeMaskInfo"] as number[];
      for (let i = 0; i < 8; i++) {
        const base = i * 4;
        expect(info[base]).toBe(1);
        expect(info[base + 1]).toBe(i);
      }
      // The ninth masked volume exceeds the 8-slot budget and is dropped (its info row stays 0).
      expect(info[8 * 4]).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("destroys the mask textures and the identity placeholder", () => {
    const mask = VolumetricTexture.fromData(new Uint8Array(4 * 1 * 1 * 1), 1, 1, 1);
    const volume = new FogVolume({ densityMask: mask });
    const { mock, pass } = runMaskedVolume([volume]);

    const created = mock.createdTextures();
    expect(created).toBeGreaterThan(0);
    expect(() => pass.destroy()).not.toThrow();
    expect(mock.deletedTextures()).toBe(created);
  });
});
