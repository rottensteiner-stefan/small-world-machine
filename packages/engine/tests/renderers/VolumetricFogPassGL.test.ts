import { describe, it, expect } from "vitest";
import { VolumetricFogPassGL } from "../../src/renderers/post/passes/VolumetricFogPassGL.js";
import { VolumetricFogElement } from "../../src/renderers/post/elements/VolumetricFogElement.js";
import { PostProcessPassGL } from "../../src/renderers/post/passes/PostProcessPassGL.js";
import { PostProcessingGroup } from "../../src/renderers/post/PostProcessingGroup.js";
import { Vector3D } from "../../src/math/index.js";

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

    const result = pass.execute(
      {} as WebGLTexture,
      800,
      600,
      new Float32Array(16),
      new Vector3D(0, 0, 0),
      0.1,
      1000,
      undefined,
      null,
      element,
    );

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
    } as unknown as WebGL2RenderingContext;

    const pass = new VolumetricFogPassGL(mockGL2, true);
    const element = new VolumetricFogElement();
    element.enabled = false;

    // Disabled element
    const res1 = pass.execute(
      {} as WebGLTexture,
      800,
      600,
      new Float32Array(16),
      new Vector3D(0, 0, 0),
      0.1,
      1000,
      undefined,
      null,
      element,
    );
    expect(res1).toBeNull();

    // Zero dimensions
    element.enabled = true;
    const res2 = pass.execute(
      {} as WebGLTexture,
      0,
      0,
      new Float32Array(16),
      new Vector3D(0, 0, 0),
      0.1,
      1000,
      undefined,
      null,
      element,
    );
    expect(res2).toBeNull();
  });

  it("triggers a shader rebuild in PostProcessPassGL when VolumetricFogElement is enabled or disabled", () => {
    const glPass = new PostProcessPassGL({} as WebGL2RenderingContext, true);
    const getSig = (
      glPass as unknown as { _getSignature: (g: PostProcessingGroup) => string }
    )._getSignature.bind(glPass);

    const group = new PostProcessingGroup();
    const volFog = new VolumetricFogElement();
    volFog.enabled = false;
    group.add(volFog);

    const sigOff = getSig(group);

    volFog.enabled = true;
    const sigOn = getSig(group);

    expect(sigOn).not.toBe(sigOff);

    // Continuous tuning should not change signature
    volFog.density = 0.5;
    volFog.intensity = 2.0;
    volFog.asymmetry = 0.8;
    const sigTuned = getSig(group);

    expect(sigTuned).toBe(sigOn);
  });
});
