import { describe, expect, it, vi } from "vitest";
import { ClusterCullPassGPU } from "../../src/renderers/passes/ClusterCullPassGPU.js";
import { Scene } from "../../src/core/Scene.js";
import { Vector3D } from "../../src/math/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RendererStub = any;

function makeMockCommandEncoder(): {
  ce: { beginComputePass: ReturnType<typeof vi.fn> };
  computePass: {
    setPipeline: ReturnType<typeof vi.fn>;
    setBindGroup: ReturnType<typeof vi.fn>;
    dispatchWorkgroups: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
} {
  const computePass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    end: vi.fn(),
  };
  const ce = {
    beginComputePass: vi.fn(() => computePass),
  };
  return { ce, computePass };
}

describe("ClusterCullPassGPU", () => {
  it("dispatches one workgroup per 4x4x4 block of cluster cells, rounding up", () => {
    const pass = new ClusterCullPassGPU();
    const { ce, computePass } = makeMockCommandEncoder();
    const renderer: RendererStub = {
      clusterDims: { x: 30, y: 17, z: 6 },
      clusterCullPipeline: { id: "pipeline" },
      globalBindGroup: { id: "bindGroup" },
    };

    pass.execute(
      renderer,
      new Scene(),
      ce as unknown as GPUCommandEncoder,
      undefined as unknown as GPUTextureView,
      new Float32Array(16),
      Vector3D.ZERO,
      undefined,
    );

    expect(ce.beginComputePass).toHaveBeenCalledTimes(1);
    expect(computePass.setPipeline).toHaveBeenCalledWith(renderer.clusterCullPipeline);
    expect(computePass.setBindGroup).toHaveBeenCalledWith(0, renderer.globalBindGroup);
    expect(computePass.dispatchWorkgroups).toHaveBeenCalledWith(8, 5, 2);
    expect(computePass.end).toHaveBeenCalledTimes(1);
  });

  it("still dispatches at least one workgroup per axis for a single-cluster grid", () => {
    const pass = new ClusterCullPassGPU();
    const { ce, computePass } = makeMockCommandEncoder();
    const renderer: RendererStub = {
      clusterDims: { x: 1, y: 1, z: 1 },
      clusterCullPipeline: { id: "pipeline" },
      globalBindGroup: { id: "bindGroup" },
    };

    pass.execute(
      renderer,
      new Scene(),
      ce as unknown as GPUCommandEncoder,
      undefined as unknown as GPUTextureView,
      new Float32Array(16),
      Vector3D.ZERO,
      undefined,
    );

    expect(computePass.dispatchWorkgroups).toHaveBeenCalledWith(1, 1, 1);
  });
});

describe("ClusterCullPassGPU offscreen", () => {
  it("still dispatches in an offscreen sub-render: culling reads the active camera's vp/viewPos", () => {
    const pass = new ClusterCullPassGPU();
    const { ce, computePass } = makeMockCommandEncoder();
    const renderer: RendererStub = {
      activeRenderTarget: { mock: "offscreen" },
      clusterDims: { x: 4, y: 4, z: 4 },
      clusterCullPipeline: {},
      globalBindGroup: {},
    };
    pass.execute(
      renderer,
      new Scene(),
      ce as unknown as GPUCommandEncoder,
      undefined as unknown as GPUTextureView,
      new Float32Array(16),
      Vector3D.ZERO,
    );
    expect(computePass.dispatchWorkgroups).toHaveBeenCalledTimes(1);
  });
});
