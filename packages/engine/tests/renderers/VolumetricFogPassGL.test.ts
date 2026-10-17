import { describe, it, expect } from "vitest";
import { VolumetricFogPassGL } from "../../src/renderers/post/passes/VolumetricFogPassGL.js";
import { VolumetricFogElement } from "../../src/renderers/post/elements/VolumetricFogElement.js";
import { PostProcessPassGL } from "../../src/renderers/post/passes/PostProcessPassGL.js";
import { PostProcessingGroup } from "../../src/renderers/post/PostProcessingGroup.js";
import { PointLight, SpotLight } from "../../src/core/lights/index.js";
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

  it("accepts point lights and spot lights and uploads light uniforms on WebGL2", () => {
    const uniformCalls: Record<string, unknown> = {};
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
      getUniformLocation: (_prog: unknown, name: string) => name,
      createVertexArray: () => ({}),
      createTexture: () => ({}),
      bindTexture: () => {},
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
      activeTexture: () => {},
      bindVertexArray: () => {},
      drawArrays: () => {},
      uniform1i: (loc: unknown, val: number) => {
        uniformCalls[String(loc)] = val;
      },
      uniform1f: (loc: unknown, val: number) => {
        uniformCalls[String(loc)] = val;
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

    const pass = new VolumetricFogPassGL(mockGL2, true);
    const element = new VolumetricFogElement();
    element.enabled = true;
    element.color.set(1, 1, 1);
    element.scatteringAlbedo = 1.0;

    const pl = new PointLight({ distance: 25, intensity: 2.0 });
    pl.volumetricIntensity = 1.5;
    pl.position.set(5, 10, -15);
    pl.updateMatrixWorld();

    const sl = new SpotLight({ distance: 40, intensity: 3.0, angle: Math.PI / 4 });
    sl.volumetricIntensity = 0.8;
    sl.position.set(0, 20, 0);
    sl.direction.set(0, -1, 0);
    sl.updateMatrixWorld();

    const res = pass.execute(
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
      [],
      0,
      undefined,
      0,
      null,
      0,
      [pl],
      [sl],
    );

    expect(res).not.toBeNull();
    expect(uniformCalls["u_numPointLights"]).toBe(1);
    expect(uniformCalls["u_numSpotLights"]).toBe(1);

    const ptPos = uniformCalls["u_pointLightPos"] as number[];
    expect(ptPos).toBeDefined();
    expect(ptPos[0]).toBe(5);
    expect(ptPos[1]).toBe(10);
    expect(ptPos[2]).toBe(-15);
    expect(ptPos[3]).toBe(25);

    const spotPos = uniformCalls["u_spotLightPos"] as number[];
    expect(spotPos).toBeDefined();
    expect(spotPos[0]).toBe(0);
    expect(spotPos[1]).toBe(20);
    expect(spotPos[2]).toBe(0);
    expect(spotPos[3]).toBe(40);
  });
});
