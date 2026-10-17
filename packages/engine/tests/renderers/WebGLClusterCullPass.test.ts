import { describe, expect, it, vi } from "vitest";
import { WebGLClusterCullPass } from "../../src/renderers/passes/WebGLClusterCullPass.js";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import { Scene } from "../../src/core/Scene.js";
import { Vector3D } from "../../src/math/index.js";
import { PointLight } from "../../src/core/lights/PointLight.js";

import { Color } from "../../src/core/colors/Color.js";
import type { LightDataInterface } from "../../src/interfaces/LightData.js";
import { DeviceCaps, DeviceLimit } from "../../src/core/DeviceCaps.js";

function makeMockWebGL2Renderer(numClusters: { x: number; y: number; z: number }): {
  renderer: unknown;
  gl: {
    canvas: { width: number; height: number };
    activeTexture: ReturnType<typeof vi.fn>;
    bindTexture: ReturnType<typeof vi.fn>;
    texSubImage2D: ReturnType<typeof vi.fn>;
    texImage2D: ReturnType<typeof vi.fn>;
    uniform1i: ReturnType<typeof vi.fn>;
    getUniformLocation: ReturnType<typeof vi.fn>;
    createTexture: ReturnType<typeof vi.fn>;
    pixelStorei: ReturnType<typeof vi.fn>;
    texParameteri: ReturnType<typeof vi.fn>;
  };
} {
  const gl = {
    canvas: { width: 800, height: 600 },
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    texSubImage2D: vi.fn(),
    texImage2D: vi.fn(),
    uniform1i: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    pixelStorei: vi.fn(),
    texParameteri: vi.fn(),
  };

  const caps = new DeviceCaps();
  vi.spyOn(caps, "getLimit").mockImplementation((limit: DeviceLimit) => {
    if (limit === DeviceLimit.WEBGL2_MAX_TEXTURE_IMAGE_UNITS) return 32;
    return 16;
  });

  const renderer = {
    webglContext: gl,
    clusterDims: numClusters,
    clusterMaxLightsPerCluster: 16,
    quality: { clusteredLighting: { tileSize: 64 } },
    writeClusterGridUniforms: vi.fn(),
    clusterGridTexture: {},
    clusterIndexTexture: {},
    context: { deviceCaps: caps, shaderRegistry: {}, assetManager: {} },
  };

  Object.setPrototypeOf(renderer, WebGL2Renderer.prototype);
  return { renderer, gl };
}

describe("WebGLClusterCullPass (BLK-R1 Regression)", () => {
  it("reallocates _pointCounts and _spotCounts when numClusters > 1 even if gridHeight === 1", () => {
    const pass = new WebGLClusterCullPass();
    // 8x8x4 = 256 clusters (gridHeight = 1 because 256 <= 1024)
    const { renderer, gl } = makeMockWebGL2Renderer({ x: 8, y: 8, z: 4 });

    const scene = new Scene();
    const light = new PointLight({ distance: 10 });
    light.position.set(5, 5, 5);
    light.updateMatrixWorld();

    const extractedLights: LightDataInterface = {
      pLights: [light],
      sLights: [],
      aLights: [],
      aCol: new Color(0, 0, 0),
      aIntensity: 0,
      dDir: new Vector3D(0, -1, 0),
      dCol: new Color(1, 1, 1),
      dIntensity: 0,
    };

    const vp = new Float32Array(16);
    vp[0] = 1;
    vp[5] = 1;
    vp[10] = 1;
    vp[15] = 1;

    const projMatrix = new Float32Array(16);
    projMatrix[0] = 1;
    projMatrix[5] = 1;

    expect(() => {
      pass.execute(
        renderer as unknown as WebGL2Renderer,
        scene,
        vp,
        new Vector3D(0, 0, 0),
        undefined,
        { opaqueLookup: new Map(), opaqueBatches: [], transparent: [], decals: [] },
        extractedLights,
        0.1,
        100,
        projMatrix,
      );
    }).not.toThrow();

    // Verify upload to WebGL was called with textures
    expect(gl.activeTexture).toHaveBeenCalled();
    expect(gl.bindTexture).toHaveBeenCalled();
  });
});
