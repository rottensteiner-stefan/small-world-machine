// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SmallWorldMachine } from "../../src/core/index.js";
import { RendererType } from "../../src/enums/index.js";
import { createFrameInfo, type Renderer } from "../../src/interfaces/index.js";
import { PostProcessingGroup } from "../../src/renderers/post/index.js";
import { makeMockAudioContext } from "../audio/mockAudioContext.js";

class TestSmallWorldMachine extends SmallWorldMachine {
  public readonly recordedDeltaTimes: number[] = [];
  public readonly updatePayloads: string[] = [];

  constructor() {
    super();
  }

  protected override async setupScene(): Promise<void> {
    // Test scene: nothing to set up.
  }

  protected override update(deltaTime: number): void {
    this.recordedDeltaTimes.push(deltaTime);
    this.updatePayloads.push(`frame-${this.recordedDeltaTimes.length}:${deltaTime}`);
  }
}

const attachedCanvases: HTMLCanvasElement[] = [];
let origAudioContext: unknown;

// jsdom has no GPU and `SmallWorldMachine` only acquires its real canvas/renderer in `start()`, so the
// step hook is run against a stubbed canvas + renderer. The body requires a canvas with a real
// size and a renderer with a post-processing group; the shuffled canvas is appended to the DOM
// so the `_loop` "canvas removed" guard keeps running instead of auto-destroying.
function attachTestRuntime(app: TestSmallWorldMachine): void {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 320 });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 200 });
  attachedCanvases.push(canvas);
  app.canvas = canvas;

  app.renderer = {
    type: RendererType.WEB_GL2,
    postProcessing: new PostProcessingGroup(),
    frameInfo: createFrameInfo(),
    render: (): void => {},
    setSize: (): void => {},
  } as unknown as Renderer;
}

describe("SmallWorldMachine public step(deltaTime) hook", () => {
  beforeEach(() => {
    origAudioContext = (window as unknown as { AudioContext: unknown }).AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      constructor() {
        return makeMockAudioContext();
      }
    };
  });

  afterEach(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
    for (const canvas of attachedCanvases.splice(0)) {
      document.body.removeChild(canvas);
    }
  });

  it("calls update exactly once, forwarding the exact deltaTime of step(1/60)", () => {
    const app = new TestSmallWorldMachine();
    attachTestRuntime(app);

    app.step(1 / 60);

    expect(app.recordedDeltaTimes).toEqual([1 / 60]);
  });

  it("produces identical recorded state across fresh instances for an identical step sequence", () => {
    const a = new TestSmallWorldMachine();
    const b = new TestSmallWorldMachine();
    attachTestRuntime(a);
    attachTestRuntime(b);

    for (let i = 0; i < 5; i++) {
      a.step(1 / 60);
      b.step(1 / 60);
    }

    expect(a.recordedDeltaTimes).toEqual(b.recordedDeltaTimes);
    expect(a.updatePayloads).toEqual(b.updatePayloads);
  });

  it("fails fast on negative / NaN deltaTime and after destroy()", () => {
    const app = new TestSmallWorldMachine();
    attachTestRuntime(app);

    expect(() => app.step(-0.1)).toThrow(/deltaTime/);
    expect(() => app.step(Number.NaN)).toThrow(/deltaTime/);
    expect(app.recordedDeltaTimes).toEqual([]);

    app.destroy();
    expect(() => app.step(1 / 60)).toThrow(/after destroy/);
  });

  it("accumulates gameplay time, real time and frame index, and hands the context to the renderer", () => {
    const app = new TestSmallWorldMachine();
    attachTestRuntime(app);

    app.step(0.25);
    app.step(0.25);

    expect(app.frameInfo.frameIndex).toBe(2);
    expect(app.frameInfo.time).toBeCloseTo(0.5, 6);
    expect(app.frameInfo.realTime).toBeCloseTo(0.5, 6);
    expect(app.frameInfo.deltaTime).toBeCloseTo(0.25, 6);
    expect(app.renderer.frameInfo).toBe(app.frameInfo);
  });

  it("scales gameplay time by hit-stop but not real time", () => {
    const app = new TestSmallWorldMachine();
    attachTestRuntime(app);

    app.triggerHitStop(1.0, 0.5);
    app.step(0.1);

    expect(app.frameInfo.time).toBeCloseTo(0.05, 6);
    expect(app.frameInfo.realTime).toBeCloseTo(0.1, 6);
    expect(app.frameInfo.realDeltaTime).toBeCloseTo(0.1, 6);
  });

  it("deduplicates concurrent start() and aborts cleanly if destroy() runs mid-init (AR01/AR03)", async () => {
    let resolveSetup!: () => void;
    let setupCalls = 0;

    class SlowInitApp extends TestSmallWorldMachine {
      protected override async setupScene(): Promise<void> {
        setupCalls++;
        await new Promise<void>((r) => {
          resolveSetup = r;
        });
      }
    }

    const canvas = document.createElement("canvas");
    canvas.id = "SmallWorldMachine";
    document.body.appendChild(canvas);
    attachedCanvases.push(canvas);

    const { ShaderBootstrap } = await import("../../src/renderers/shaders/index.js");
    const { RendererFactory } = await import("../../src/renderers/index.js");
    const { vi } = await import("vitest");

    const destroySpy = vi.fn();
    const shaderSpy = vi.spyOn(ShaderBootstrap, "init").mockResolvedValue(undefined);
    const factorySpy = vi.spyOn(RendererFactory, "create").mockResolvedValue({
      type: RendererType.WEB_GL2,
      postProcessing: new PostProcessingGroup(),
      frameInfo: createFrameInfo(),
      render: (): void => {},
      setSize: (): void => {},
      destroy: destroySpy,
    } as unknown as Renderer);

    try {
      const app = new SlowInitApp();
      const p1 = app.start();
      const p2 = app.start();
      expect(p1).toBe(p2);

      // Wait until setupScene is entered, then destroy mid-init.
      await new Promise((r) => setTimeout(r, 10));
      app.destroy();
      resolveSetup();
      await p1;

      expect(setupCalls).toBe(1);
      expect(destroySpy).toHaveBeenCalledTimes(1);
    } finally {
      shaderSpy.mockRestore();
      factorySpy.mockRestore();
    }
  });
});
