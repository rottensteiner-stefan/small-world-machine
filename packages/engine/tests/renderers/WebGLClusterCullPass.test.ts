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
    clusterIndexCapacity:
      Math.ceil((numClusters.x * numClusters.y * numClusters.z * 16) / 1024) * 1024,
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
  it("packs lit cells back to back and uploads only the used index rows", () => {
    const pass = new WebGLClusterCullPass();
    // 800x600 canvas, 16 px tiles: 50x38x24 = 45600 clusters -> 713 index rows if the whole
    // 16-slot-per-cell table were uploaded
    const dims = { x: 50, y: 38, z: 24 };
    const numClusters = dims.x * dims.y * dims.z;
    const { renderer, gl } = makeMockWebGL2Renderer(dims);
    (renderer as { quality: unknown }).quality = { clusteredLighting: { tileSize: [16, 16] } };

    const light = new PointLight({ distance: 2 });
    light.position.set(0, 0, -5);
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

    pass.execute(
      renderer as unknown as WebGL2Renderer,
      new Scene(),
      vp,
      new Vector3D(0, 0, 0),
      undefined,
      { opaqueLookup: new Map(), opaqueBatches: [], transparent: [], decals: [] },
      extractedLights,
      0.1,
      100,
      projMatrix,
    );

    const internals = pass as unknown as { _pointNext: number; _grid: Uint32Array };
    const litCells = internals._pointNext / 16;
    const offsets: number[] = [];
    for (let cell = 0; cell < numClusters; cell++) {
      if (internals._grid[cell * 4 + 1]! > 0) offsets.push(internals._grid[cell * 4]!);
    }
    expect(litCells).toBeGreaterThan(0);
    expect(offsets.length).toBe(litCells);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets.map((_, i) => i * 16));

    const indexUpload = gl.texSubImage2D.mock.calls[1]!;
    expect(indexUpload[5]).toBe(Math.max(1, Math.ceil(internals._pointNext / 1024)));
    expect(indexUpload[5]).toBeLessThan(713);
  });

  it("clamps the index texture to MAX_TEXTURE_SIZE and never uploads or indexes past it", () => {
    // Showcase 39 on a 2268x1029 canvas: 8 px tiles x 64 slices = 284x129x64 clusters, whose
    // 16-slot index table needs 36636 rows -- far beyond MAX_TEXTURE_SIZE (16384 there).
    const dims = { x: 284, y: 129, z: 64 };
    const maxTextureSize = 64;
    const gl = {
      MAX_TEXTURE_SIZE: 0x0d33,
      RGBA32UI: 1,
      RG32UI: 2,
      RGBA_INTEGER: 3,
      RG_INTEGER: 4,
      getParameter: vi.fn(() => maxTextureSize),
      createTexture: vi.fn(() => ({})),
      deleteTexture: vi.fn(),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      texImage2D: vi.fn(),
    };
    const owner = Object.create(WebGL2Renderer.prototype) as { gl: unknown };
    owner.gl = gl;
    (
      owner as unknown as { _allocateClusterTextures(d: typeof dims, m: number): void }
    )._allocateClusterTextures(dims, 16);
    const indexAlloc = gl.texImage2D.mock.calls.find((c) => c[2] === gl.RG32UI)!;
    expect(indexAlloc[4]).toBe(maxTextureSize);
    const capacity = (owner as unknown as WebGL2Renderer).clusterIndexCapacity;
    expect(capacity).toBe(maxTextureSize * 1024);

    const pass = new WebGLClusterCullPass();
    const mock = makeMockWebGL2Renderer({ x: 16, y: 16, z: 16 });
    const renderer = mock.renderer as { clusterIndexCapacity: number; quality: unknown };
    // 4096 clusters x 16 slots would need 64 rows; give it only 2 rows (128 lit cells).
    renderer.clusterIndexCapacity = 2 * 1024;
    renderer.quality = { clusteredLighting: { tileSize: [16, 16] } };
    const light = new PointLight({ distance: 50 });
    light.position.set(0, 0, -5);
    light.updateMatrixWorld();
    const vp = new Float32Array(16);
    vp[0] = 1;
    vp[5] = 1;
    vp[10] = 1;
    vp[15] = 1;
    const projMatrix = new Float32Array(16);
    projMatrix[0] = 1;
    projMatrix[5] = 1;
    pass.execute(
      renderer as unknown as WebGL2Renderer,
      new Scene(),
      vp,
      new Vector3D(0, 0, 0),
      undefined,
      { opaqueLookup: new Map(), opaqueBatches: [], transparent: [], decals: [] },
      {
        pLights: [light],
        sLights: [],
        aLights: [],
        aCol: new Color(0, 0, 0),
        aIntensity: 0,
        dDir: new Vector3D(0, -1, 0),
        dCol: new Color(1, 1, 1),
        dIntensity: 0,
      },
      0.1,
      100,
      projMatrix,
    );

    const internals = pass as unknown as { _pointNext: number; _indices: Uint32Array };
    expect(internals._pointNext).toBe(2 * 1024);
    expect(internals._indices.length).toBe(2 * 1024 * 2);
    const indexUpload = mock.gl.texSubImage2D.mock.calls[1]!;
    expect(indexUpload[5]).toBe(2);
  });
});
