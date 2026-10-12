import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { GPUPipelineCache } from "../../src/renderers/WebGPU/managers/GPUPipelineCache.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { RenderManifest } from "../../src/renderers/shaders/RenderManifest.js";
import { Object3D } from "../../src/core/Object3D.js";

(globalThis as unknown as { GPUShaderStage: Record<string, number> }).GPUShaderStage ??= {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
};

const SHADER_ID = "test/pipeline-refcount-shader";

function makeCache(): { cache: GPUPipelineCache; createRenderPipeline: ReturnType<typeof vi.fn> } {
  const createRenderPipeline = vi.fn((desc: { layout: unknown }) => ({ layout: desc.layout }));
  const device = {
    createBindGroupLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: (): Promise<{ messages: unknown[] }> => Promise.resolve({ messages: [] }),
    })),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline,
    limits: { maxSampledTexturesPerShaderStage: 16 },
  } as unknown as GPUDevice;
  if (!ShaderRegistry.instance.get(SHADER_ID)) {
    ShaderRegistry.instance.register({
      id: SHADER_ID,
      sources: { wgsl: "@vertex fn vs() -> Out { var o: Out; return o; }" },
      layout: { uniforms: {}, uniformLayout: [], textures: {} },
    });
  }
  const cache = new GPUPipelineCache(
    device,
    { getLimit: () => 16 } as never,
    {} as GPUBindGroupLayout,
    {} as GPUBindGroupLayout,
    {} as GPUBindGroupLayout,
    ShaderRegistry.instance,
  );
  return { cache, createRenderPipeline };
}

const manifest: RenderManifest = { shaderId: SHADER_ID, properties: {}, textures: {} };

/** One frame the way WebGPURenderer._renderSubgroup drives the cache for a single object. */
function drawWith(cache: GPUPipelineCache, obj: Object3D, targetFormat: GPUTextureFormat): void {
  cache.getPipeline(manifest, "triangle-list", false, targetFormat);
  cache.acquirePipeline(
    obj,
    cache.pipelineCacheKey(manifest, "triangle-list", false, targetFormat),
  );
}

describe("GPUPipelineCache refcounting across passes", () => {
  it("does not rebuild pipelines every frame for an object drawn into two targets", () => {
    const { cache, createRenderPipeline } = makeCache();
    const obj = new Object3D("both-passes");

    for (let frame = 0; frame < 3; frame++) {
      drawWith(cache, obj, "rgba16float"); // main pass (HDR)
      drawWith(cache, obj, "bgra8unorm"); // e.g. a planar-reflection pass
    }

    expect(createRenderPipeline).toHaveBeenCalledTimes(2);
  });

  it("keeps a pipeline alive while any object still uses it and drops it with the last user", () => {
    const { cache, createRenderPipeline } = makeCache();
    const a = new Object3D("a");
    const b = new Object3D("b");
    drawWith(cache, a, "rgba16float");
    drawWith(cache, b, "rgba16float");

    cache.releasePipelineFor(a);
    drawWith(cache, b, "rgba16float");
    expect(createRenderPipeline).toHaveBeenCalledTimes(1);

    cache.releasePipelineFor(b);
    drawWith(cache, a, "rgba16float");
    expect(createRenderPipeline).toHaveBeenCalledTimes(2);
  });
});
