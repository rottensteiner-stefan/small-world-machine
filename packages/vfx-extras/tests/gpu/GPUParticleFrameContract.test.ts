/**
 * Frame contract of `GPUParticleSystem` (review fixes): one-shot dt/emit lanes, accumulating
 * `update()`, simulation-owned ping-pong parity. Mock device, no WebGPU runtime.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { GPUParticleSystem } from "../../src/gpu/GPUParticleSystem.js";

const DIR = "../../../engine/src/renderers/shaders/source/web_gpu/particles/";
const COMPUTE = readFileSync(new URL(`${DIR}gpu_particles.wgsl`, import.meta.url), "utf8");
const DRAW = readFileSync(new URL(`${DIR}gpu_particles_draw.wgsl`, import.meta.url), "utf8");
const code = (src: string): string => src.replace(/\/\/.*$/gm, "");

const BOX = { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 1, z: 1 } };
const UNIFORM = 64;

interface BgDesc {
  entries: Array<{ binding: number; resource: { buffer?: unknown } }>;
}

function setup(): {
  sys: GPUParticleSystem;
  uploads: Array<{ emit: number; dt: number }>;
  sim: () => BgDesc;
  draw: () => BgDesc;
  dispatches: () => number;
} {
  Object.assign(globalThis, {
    GPUBufferUsage: { INDEX: 16, UNIFORM, STORAGE: 128, INDIRECT: 256, COPY_DST: 8 },
    GPUTextureUsage: { TEXTURE_BINDING: 4, COPY_DST: 2 },
    GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
    GPUColorWrite: { ALL: 15 },
  });
  const uploads: Array<{ emit: number; dt: number }> = [];
  let dispatchCount = 0;
  const none = (): undefined => undefined;
  const empty = (): object => ({});
  const device = {
    createBuffer: (d: { size: number; usage: number }): object => ({ ...d, destroy: none }),
    createTexture: (): object => ({ createView: empty, destroy: none }),
    createBindGroupLayout: (d: object): object => d,
    createPipelineLayout: (d: object): object => d,
    createShaderModule: empty,
    createComputePipeline: empty,
    createRenderPipeline: empty,
    createBindGroup: (d: BgDesc): BgDesc => d,
    queue: {
      writeBuffer: (b: { usage: number }, _o: number, data: Uint8Array): void => {
        if ((b.usage & UNIFORM) === 0) return;
        const copy = new Uint8Array(data); // queue.writeBuffer copies at call time
        uploads.push({
          emit: new Uint32Array(copy.buffer)[1]!,
          dt: new Float32Array(copy.buffer)[4]!,
        });
      },
      writeTexture: none,
    },
  };
  const host = {
    gpuDevice: device,
    globalBGL: {},
    globalBindGroup: {},
    globalUniformBuffer: {},
    particleComputeSource: "",
    particleDrawSource: "",
    activeDepthView: {},
    activeNormalView: undefined,
    particleTargetFormat: "bgra8unorm",
  };
  const sys = new GPUParticleSystem({ capacity: 64, spawnBox: BOX });
  sys.attachHost(host as never);

  const computePass = {
    setPipeline: none,
    setBindGroup: (i: number, bg: BgDesc): void => {
      if (i === 1) lastCompute = bg;
    },
    dispatchWorkgroups: (): number => ++dispatchCount,
    end: none,
  };
  let lastCompute: BgDesc | undefined;
  let lastDraw: BgDesc | undefined;
  const encoder = { beginComputePass: (): object => computePass };
  const pass = {
    setPipeline: none,
    setBindGroup: (i: number, bg: BgDesc): void => {
      if (i === 1) lastDraw = bg;
    },
    setIndexBuffer: none,
    drawIndexedIndirect: none,
  };
  return {
    sys,
    uploads,
    sim: (): BgDesc => {
      lastCompute = undefined;
      sys.recordSimulation(encoder as never);
      return lastCompute!;
    },
    draw: (): BgDesc => {
      lastDraw = undefined;
      sys.recordIndirectDraw(pass as never);
      return lastDraw!;
    },
    dispatches: (): number => dispatchCount,
  };
}

const buf = (bg: BgDesc, binding: number): unknown =>
  bg.entries.find((e) => e.binding === binding)!.resource.buffer;

describe("one-shot dt/emit lanes", () => {
  it("a simulation without a preceding update() uploads emit=0 and dt=0", () => {
    const t = setup();
    t.sys.emit(5);
    t.sys.update(0.016);
    t.sim();
    t.sim(); // paused / second camera / re-render
    t.sim();
    expect(t.uploads[0]).toEqual({ emit: 5, dt: Math.fround(0.016) });
    expect(t.uploads[1]).toEqual({ emit: 0, dt: 0 });
    expect(t.uploads).toHaveLength(2); // zero block uploaded once, then clean again
    expect(t.dispatches()).toBe(9);
  });

  it("a second update() before the simulation accumulates dt and emit count", () => {
    const t = setup();
    t.sys.emit(3);
    t.sys.update(0.25);
    t.sys.emit(4);
    t.sys.update(0.5);
    t.sim();
    expect(t.uploads[0]).toEqual({ emit: 7, dt: 0.75 });
  });
});

describe("ping-pong parity is owned by the simulation", () => {
  it("every simulation reads the list the previous one wrote, with or without draws", () => {
    const t = setup();
    const sims = [t.sim(), t.sim(), t.sim(), t.sim()]; // no draw pass in between
    for (let i = 1; i < sims.length; i++) {
      expect(buf(sims[i]!, 25), `sim ${i}`).toBe(buf(sims[i - 1]!, 26));
    }
  });

  it("a draw (even a second one) reads the list the last simulation wrote", () => {
    const t = setup();
    t.sim();
    const s = t.sim();
    expect(buf(t.draw(), 23)).toBe(buf(s, 26));
    expect(buf(t.draw(), 23)).toBe(buf(s, 26)); // second camera: no parity flip
    const s2 = t.sim();
    expect(buf(s2, 25)).toBe(buf(s, 26));
    expect(buf(t.draw(), 23)).toBe(buf(s2, 26));
  });
});

describe("csSimulate returns life <= 0 slots to the dead list (S34-POOL-PARTITION)", () => {
  const src = code(COMPUTE);
  const sim = src.slice(src.indexOf("fn csSimulate"), src.indexOf("fn csPrepareIndirect"));

  it("has no early return on `life <= 0.0` (slot would leave both lists)", () => {
    expect(sim).not.toMatch(/if \(life <= 0\.0\) \{\s*return;/);
  });

  it("routes a non-positive life through the single dead push", () => {
    expect(sim).toContain("var newLife = life;");
    expect(sim).toMatch(/if \(life > 0\.0\) \{[\s\S]*newLife = life - params\.u1\.x;/);
    expect(sim).toMatch(/if \(newLife > 0\.0\) \{[\s\S]*\} else \{[\s\S]*counters\.numDead/);
  });

  it("CPU oracle of the branch: every slot ends in exactly one of alive/dead", () => {
    const step = (life: number, dt: number): "alive" | "dead" => {
      let nl = life;
      if (life > 0) nl = life - dt;
      return nl > 0 ? "alive" : "dead";
    };
    expect(step(-0.5, 0.016)).toBe("dead");
    expect(step(0, 0.016)).toBe("dead");
    expect(step(1, 0.016)).toBe("alive");
    expect(step(1, 0)).toBe("alive");
  });
});

describe("fsParticle colour space (ADR 0049)", () => {
  it("converts the sRGB authoring tint with displayToTarget before premultiplying", () => {
    expect(code(DRAW)).toContain("displayToTarget(in.color.rgb) * in.color.a");
  });
});
