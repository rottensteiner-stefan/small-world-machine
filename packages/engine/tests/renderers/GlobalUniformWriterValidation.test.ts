import "../../src/index.js";
import { describe, expect, it } from "vitest";
import { GlobalUniformWriter } from "../../src/renderers/WebGPU/managers/GlobalUniformWriter.js";
import { WebGPUGGlobalUniformLayout } from "../../src/renderers/GlobalUniformLayout.js";
import { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { Scene } from "../../src/core/Scene.js";
import { Vector3D } from "../../src/math/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

(globalThis as unknown as { GPUBufferUsage: Record<string, number> }).GPUBufferUsage ??= {
  COPY_DST: 8,
  UNIFORM: 0x40,
  STORAGE: 0x80,
};

const emptyLights = { pLights: [], sLights: [], aLights: [], dLights: [] };

function makeWriter(): { writer: GlobalUniformWriter; sizes: number[] } {
  const renderer = new WebGPURenderer() as Internals;
  const writer = new GlobalUniformWriter(renderer);
  const sizes: number[] = [];
  writer.init({
    createBuffer: (d: { size: number }): { destroy: () => void } => {
      sizes.push(d.size);
      return { destroy: () => undefined };
    },
  } as unknown as GPUDevice);
  return { writer, sizes };
}

function call(near: number, far: number, proj?: Float32Array): void {
  const { writer } = makeWriter();
  writer.update(
    new Float32Array(16),
    new Vector3D(),
    emptyLights as never,
    new Scene(),
    near,
    far,
    proj,
  );
}

describe("GlobalUniformWriter fail-fast + derived sizes", () => {
  it("derives buffer sizes from the layout and light-count constants", () => {
    const { sizes } = makeWriter();
    expect(sizes).toEqual([WebGPUGGlobalUniformLayout.totalBytes, 2048, 4096, 4096]);
  });

  it("rejects non-finite or inverted near/far instead of uploading garbage", () => {
    expect(() => call(1, 1)).toThrow(/Invalid camera near\/far/);
    expect(() => call(0.1, Number.NaN)).toThrow(/Invalid camera near\/far/);
    expect(() => call(10, 1)).toThrow(/Invalid camera near\/far/);
  });

  it("rejects a malformed projection matrix", () => {
    expect(() => call(0.1, 100, new Float32Array(4))).toThrow(/projMatrix must have 16/);
  });
});
