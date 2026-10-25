import "../../src/index.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { describe, expect, it, vi } from "vitest";
import { SpotShadowPassGPU } from "../../src/renderers/passes/SpotShadowPassGPU.js";
import { Vector3D } from "../../src/math/index.js";
import { Topology, WireframeMode } from "../../src/enums/index.js";

// Node/vitest has no WebGPU global; stub the bit-flag constants this pass actually reads.
(globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage ??= {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

function setup(opaqueBatches: unknown[] = []): {
  renderer: Internals;
  run: () => void;
  drawnGroups: () => unknown[];
  lastCreatedGroup: () => unknown;
  createdCount: () => number;
} {
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const spotLight: Internals = {
    castShadow: true,
    shadowResolution: 256,
    shadowBias: 0.001,
    shadowNormalBias: 0.002,
    shadowCamera: { viewProjectionMatrix: identity, viewMatrix: identity },
    updateShadowCamera: vi.fn(),
  };
  let nextId = 0;
  const renderer: Internals = {
    extractLights: vi.fn(() => ({ sLights: [spotLight] })),
    gpuDevice: {
      createTexture: vi.fn((desc: { size: number[] }) => ({
        width: desc.size[0],
        depthOrArrayLayers: desc.size[2] ?? 1,
        createView: vi.fn(() => ({})),
      })),
      queue: { writeBuffer: vi.fn() },
    },
    currentColorTargetFormat: "rgba8unorm",
    deferDestroyTexture: vi.fn(),
    context: { shaderRegistry: new ShaderRegistry() },
    defaultDirShadowTextureView: {},
    dummyDirShadowTextureView: {},
    defaultSpotShadowTextureView: {},
    dummySpotShadowTextureView: {},
    // Every call returns a distinct object so the test can tell a rebuilt group from a stale one.
    _createGlobalBindGroup: vi.fn(() => ({ id: ++nextId })),
    _setViewMatrix: vi.fn(() => 0),
    _renderSubgroup: vi.fn(),
    scratchGlobalBufferData: new Float32Array(216),
    globalUniformBuffer: {},
    globalBindGroup: undefined,
    globalResourcesVersion: 0,
  };
  const scene: Internals = {
    getVisibleObjectsSorted: vi.fn(() => ({ opaqueBatches })),
  };
  const renderPass = { setBindGroup: vi.fn(), end: vi.fn() };
  const ce = { beginRenderPass: vi.fn(() => renderPass) };
  const pass = new SpotShadowPassGPU() as Internals;
  return {
    renderer,
    run: (): void =>
      pass.execute(renderer, scene, ce, {}, new Float32Array(16), new Vector3D(0, 0, 0)),
    drawnGroups: (): unknown[] => renderPass.setBindGroup.mock.calls.map((call) => call[1]),
    lastCreatedGroup: (): unknown =>
      (renderer._createGlobalBindGroup as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value,
    createdCount: (): number =>
      (renderer._createGlobalBindGroup as ReturnType<typeof vi.fn>).mock.calls.length,
  };
}

describe("SpotShadowPassGPU: cached caster bind group", () => {
  it("rebuilds it only when the renderer replaced a buffer of its global bind group", () => {
    const { renderer, run, createdCount } = setup();
    run();
    const afterFirstFrame = createdCount();

    run();
    expect(createdCount()).toBe(afterFirstFrame);

    // A resize replaces the cluster buffers: a stale cached group would reference destroyed buffers.
    renderer.globalResourcesVersion = 1;
    run();
    expect(createdCount()).toBe(afterFirstFrame + 1);

    run();
    expect(createdCount()).toBe(afterFirstFrame + 1);
  });

  it("draws with the rebuilt group after a resize, never with the stale one", () => {
    const { renderer, run, drawnGroups, lastCreatedGroup } = setup();
    run();
    run();
    const [firstFrame, secondFrame] = drawnGroups();
    expect(secondFrame).toBe(firstFrame);

    renderer.globalResourcesVersion = 1;
    run();
    const afterResize = drawnGroups().at(-1);
    expect(afterResize).not.toBe(firstFrame);
    expect(afterResize).toBe(lastCreatedGroup());
  });
});

describe("SpotShadowPassGPU: line casters", () => {
  it("forwards the batch's wireframeMode so line casters draw the edge index buffer, not the triangle one", () => {
    const caster = { castShadow: true };
    const batch = {
      shaderId: "test-batch",
      objects: [caster],
      topology: Topology.LINE_LIST,
      wireframeMode: WireframeMode.STRUCTURAL,
    };
    const { renderer, run } = setup([batch]);
    run();

    const call = (renderer._renderSubgroup as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1]).toEqual([caster]);
    expect(call[8]).toBe(WireframeMode.STRUCTURAL);
  });
});
