import { describe, expect, it, vi } from "vitest";
import { GpuParticlesPassGPU } from "../../src/renderers/passes/GpuParticlesPassGPU.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

function makeRenderer(systemCount: number, activeRenderTarget: unknown): Internals {
  return {
    gpuParticleSystemCount: systemCount,
    activeRenderTarget,
    activeDepthView: { mock: "depth" },
    _recordGpuParticleSimulations: vi.fn(),
    _recordGpuParticleDraws: vi.fn(),
  };
}

function makeCe(): { ce: Internals; rp: Internals } {
  const rp = { end: vi.fn() };
  return { ce: { beginRenderPass: vi.fn(() => rp) }, rp };
}

function run(renderer: Internals, ce: Internals): void {
  new GpuParticlesPassGPU().execute(
    renderer,
    {} as Internals,
    ce,
    { mock: "target" } as Internals,
    new Float32Array(16),
    {} as Internals,
  );
}

describe("GpuParticlesPassGPU", () => {
  it("simulates and draws once on the main canvas", () => {
    const renderer = makeRenderer(1, null);
    const { ce, rp } = makeCe();
    run(renderer, ce);
    expect(renderer._recordGpuParticleSimulations).toHaveBeenCalledTimes(1);
    expect(ce.beginRenderPass).toHaveBeenCalledTimes(1);
    expect(renderer._recordGpuParticleDraws).toHaveBeenCalledWith(rp);
    expect(rp.end).toHaveBeenCalledTimes(1);
  });

  it("declares a read-only depth attachment WITHOUT load/store ops (WebGPU validation rejects both)", () => {
    const renderer = makeRenderer(1, null);
    const { ce } = makeCe();
    run(renderer, ce);
    const desc = ce.beginRenderPass.mock.calls[0][0];
    expect(desc.depthStencilAttachment.depthReadOnly).toBe(true);
    expect(desc.depthStencilAttachment).not.toHaveProperty("depthLoadOp");
    expect(desc.depthStencilAttachment).not.toHaveProperty("depthStoreOp");
  });

  it("is a complete no-op for offscreen sub-renders (reflection / probe) -- no extra sim step", () => {
    const renderer = makeRenderer(2, { mock: "offscreenTarget" });
    const { ce } = makeCe();
    run(renderer, ce);
    expect(renderer._recordGpuParticleSimulations).not.toHaveBeenCalled();
    expect(ce.beginRenderPass).not.toHaveBeenCalled();
    expect(renderer._recordGpuParticleDraws).not.toHaveBeenCalled();
  });

  it("is a no-op while no system is registered", () => {
    const renderer = makeRenderer(0, null);
    const { ce } = makeCe();
    run(renderer, ce);
    expect(renderer._recordGpuParticleSimulations).not.toHaveBeenCalled();
    expect(ce.beginRenderPass).not.toHaveBeenCalled();
  });
});
