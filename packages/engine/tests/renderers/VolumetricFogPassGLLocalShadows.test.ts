import { describe, expect, it } from "vitest";
import { VolumetricFogPassGL } from "../../src/renderers/post/passes/VolumetricFogPassGL.js";
import { createGLPostEffectContext } from "../../src/renderers/post/passes/GLPostEffectPass.js";
import { VolumetricFogElement } from "../../src/renderers/post/elements/VolumetricFogElement.js";
import { SpotLight } from "../../src/core/lights/index.js";
import { Vector3D } from "../../src/math/index.js";

interface Recorded {
  uniforms: Record<string, number[]>;
  /** texture unit -> texture bound to TEXTURE_2D while that unit was active at draw time */
  boundAtDraw: Record<number, unknown>;
}

/** Runs one WebGL2 fog pass with a recording mock context. */
function run(
  configure: (element: VolumetricFogElement, spot: SpotLight) => void,
  shadowTextures: (WebGLTexture | null)[],
  fallback: WebGLTexture,
): Recorded {
  const rec: Recorded = { uniforms: {}, boundAtDraw: {} };
  let activeUnit = 0;
  const bound: Record<number, unknown> = {};
  const set = (loc: unknown, val: ArrayLike<number> | number): void => {
    rec.uniforms[String(loc)] = typeof val === "number" ? [val] : Array.from(val);
  };
  const gl = {
    TEXTURE0: 33984,
    TEXTURE_2D: 3553,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    deleteShader: () => {},
    getProgramParameter: () => true,
    getUniformLocation: (_p: unknown, name: string) => name,
    createVertexArray: () => ({}),
    createTexture: () => ({}),
    bindTexture: (_target: number, tex: unknown) => {
      bound[activeUnit] = tex;
    },
    texParameteri: () => {},
    texImage2D: () => {},
    createFramebuffer: () => ({}),
    bindFramebuffer: () => {},
    framebufferTexture2D: () => {},
    createRenderbuffer: () => ({}),
    bindRenderbuffer: () => {},
    renderbufferStorage: () => {},
    framebufferRenderbuffer: () => {},
    FRAMEBUFFER_COMPLETE: 36053,
    checkFramebufferStatus: () => 36053,
    viewport: () => {},
    disable: () => {},
    depthMask: () => {},
    useProgram: () => {},
    activeTexture: (unit: number) => {
      activeUnit = unit - 33984;
    },
    bindVertexArray: () => {},
    drawArrays: () => {
      Object.assign(rec.boundAtDraw, bound);
    },
    uniform1i: set,
    uniform1f: set,
    uniform1iv: set,
    uniform2f: () => {},
    uniform3f: () => {},
    uniform4f: () => {},
    uniform4fv: set,
    uniformMatrix4fv: (loc: unknown, _t: boolean, val: Float32Array) => set(loc, val),
  } as unknown as WebGL2RenderingContext;

  const element = new VolumetricFogElement();
  element.enabled = true;
  const spot = new SpotLight({ distance: 40, intensity: 3.0, angle: Math.PI / 4 });
  spot.position.set(0, 20, 0);
  spot.direction.set(0, -1, 0);
  spot.shadowBias = 0.004;
  spot.castShadow = true;
  spot.updateShadowCamera();
  spot.updateMatrixWorld();
  configure(element, spot);

  // Repopulate the pass context the same way the renderer does each frame.
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
  ctx.spotLights = [spot];
  ctx.spotShadowTextures = shadowTextures;
  ctx.fallbackShadowTexture = fallback;
  new VolumetricFogPassGL(gl, true).execute(ctx);
  return rec;
}

describe("VolumetricFogPassGL local light shadows", () => {
  const real = { id: "real" } as unknown as WebGLTexture;
  const fallback = { id: "fallback" } as unknown as WebGLTexture;

  it("binds the spot's shadow map to unit 3 and switches slot 0 on with its bias", () => {
    const rec = run(() => {}, [real, null, null, null], fallback);
    expect(rec.uniforms["u_spotShadowMap"]).toEqual([3, 4, 5, 6]);
    expect(rec.boundAtDraw[3]).toBe(real);
    expect(rec.boundAtDraw[4]).toBe(fallback);
    const info = rec.uniforms["u_spotShadowInfo"]!;
    expect(info[0]).toBeCloseTo(0.004, 6);
    expect(info[2]).toBe(1);
    expect(info.slice(4)).toEqual(new Array(12).fill(0));
    expect(rec.uniforms["u_spotShadowMatrix"]).toHaveLength(64);
  });

  it("switches the slot off when localLightShadows is false", () => {
    const rec = run((e) => (e.localLightShadows = false), [real, null, null, null], fallback);
    expect(rec.uniforms["u_spotShadowInfo"]![2]).toBe(0);
    expect(rec.boundAtDraw[3]).toBe(fallback);
  });

  it("switches the slot off for a spot that does not cast a shadow", () => {
    const rec = run((_e, s) => (s.castShadow = false), [real, null, null, null], fallback);
    expect(rec.uniforms["u_spotShadowInfo"]![2]).toBe(0);
  });

  it("switches the slot off when the renderer has no shadow texture for it", () => {
    const rec = run(() => {}, [null, null, null, null], fallback);
    expect(rec.uniforms["u_spotShadowInfo"]![2]).toBe(0);
  });
});
