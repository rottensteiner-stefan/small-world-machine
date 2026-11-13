import { describe, it, expect } from "vitest";
import { VolumetricFogPassGL } from "../../src/renderers/post/passes/VolumetricFogPassGL.js";
import {
  createGLPostEffectContext,
  type GLPostEffectPassContext,
} from "../../src/renderers/post/passes/GLPostEffectPass.js";
import { VolumetricFogElement } from "../../src/renderers/post/elements/VolumetricFogElement.js";
import { type PointLight, type SpotLight } from "../../src/core/lights/index.js";
import { Vector3D } from "../../src/math/index.js";

/**
 * Builds a minimal pass context for these unit tests (mirrors the renderer's per-frame
 * repopulation of the reusable context; see GLPostEffectPassContext).
 */
function makeFogCtx(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  element: VolumetricFogElement,
  pointLights: PointLight[] = [],
  spotLights: SpotLight[] = [],
  width: number = 800,
  height: number = 600,
): GLPostEffectPassContext {
  const ctx = createGLPostEffectContext();
  ctx.gl = gl;
  ctx.width = width;
  ctx.height = height;
  ctx.colorTexture = {} as WebGLTexture;
  ctx.depthTexture = {} as WebGLTexture;
  ctx.viewProjMatrix = new Float32Array(16);
  ctx.camPos = new Vector3D(0, 0, 0);
  ctx.near = 0.1;
  ctx.far = 1000;
  ctx.element = element;
  ctx.pointLights = pointLights;
  ctx.spotLights = spotLights;
  return ctx;
}

describe("VolumetricFogPassGL", () => {
  it("degrades gracefully and returns null on WebGL1", () => {
    // Mock minimal WebGL1 context
    const mockGL1 = {
      createShader: () => null,
      createProgram: () => null,
    } as unknown as WebGLRenderingContext;

    const pass = new VolumetricFogPassGL(mockGL1, false);
    const element = new VolumetricFogElement();
    element.enabled = true;

    const result = pass.execute(makeFogCtx(mockGL1, element));

    expect(result).toBeNull();
    expect(() => pass.destroy()).not.toThrow();
  });

  it("returns null when element is disabled or viewport is zero", () => {
    const mockGL2 = {
      createShader: () => ({}),
      shaderSource: () => {},
      compileShader: () => {},
      getShaderParameter: () => true,
      createProgram: () => ({}),
      attachShader: () => {},
      linkProgram: () => {},
      deleteShader: () => {},
      getProgramParameter: () => true,
      getUniformLocation: () => ({}),
      createVertexArray: () => ({}),
      MAX_FRAGMENT_UNIFORM_VECTORS: 0x8dfd,
      getParameter: () => 1024,
    } as unknown as WebGL2RenderingContext;

    const pass = new VolumetricFogPassGL(mockGL2, true);
    const element = new VolumetricFogElement();
    element.enabled = false;

    // Disabled element
    const res1 = pass.execute(makeFogCtx(mockGL2, element));
    expect(res1).toBeNull();

    // Zero dimensions
    element.enabled = true;
    const res2 = pass.execute(makeFogCtx(mockGL2, element, [], [], 0, 0));
    expect(res2).toBeNull();
  });
});
