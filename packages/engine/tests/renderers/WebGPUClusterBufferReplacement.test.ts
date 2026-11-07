import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";

(globalThis as unknown as { GPUBufferUsage: Record<string, number> }).GPUBufferUsage ??= {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RendererInternals = any;

function makeRenderer(): { renderer: RendererInternals; deferred: unknown[]; created: unknown[] } {
  const created: unknown[] = [];
  const deferred: unknown[] = [];
  const renderer = new WebGPURenderer() as RendererInternals;
  renderer._device = {
    limits: {},
    createBuffer: vi.fn(() => {
      const buffer = { destroy: vi.fn() };
      created.push(buffer);
      return buffer;
    }),
  };
  renderer._fallback = { deferDestroyBuffer: vi.fn((b: unknown) => deferred.push(b)) };
  return { renderer, deferred, created };
}

describe("WebGPURenderer: replacing the clustered-light buffers", () => {
  it("counts every replacement so passes holding a copy of the global bind group can rebuild it", () => {
    const { renderer } = makeRenderer();
    const before = renderer.globalResourcesVersion;

    renderer._allocateClusterBuffers({ x: 2, y: 2, z: 2 }, 4);
    expect(renderer.globalResourcesVersion).toBe(before + 1);

    renderer._allocateClusterBuffers({ x: 4, y: 4, z: 2 }, 4);
    expect(renderer.globalResourcesVersion).toBe(before + 2);
  });

  it("queues the replaced buffers for destruction after the frame instead of destroying them now", () => {
    const { renderer, deferred, created } = makeRenderer();

    renderer._allocateClusterBuffers({ x: 2, y: 2, z: 2 }, 4);
    expect(deferred).toHaveLength(0);
    const firstGeneration = [...created];
    expect(firstGeneration).toHaveLength(4);

    renderer._allocateClusterBuffers({ x: 4, y: 4, z: 2 }, 4);
    expect(deferred).toEqual(firstGeneration);
    for (const buffer of firstGeneration as { destroy: ReturnType<typeof vi.fn> }[]) {
      expect(buffer.destroy).not.toHaveBeenCalled();
    }
  });
});
