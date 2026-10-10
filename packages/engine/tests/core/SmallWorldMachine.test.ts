// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SmallWorldMachine } from "../../src/core/index.js";
import { RendererType } from "../../src/enums/index.js";
import type { Renderer } from "../../src/interfaces/index.js";
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

  it("still executes the frame body after stop() and never toggles the run state (golden path)", () => {
    const app = new TestSmallWorldMachine();
    attachTestRuntime(app);

    app.stop();
    expect((app as unknown as { _isRunning: boolean })._isRunning).toBe(false);

    app.step(1 / 60);

    expect(app.recordedDeltaTimes).toEqual([1 / 60]);
    expect((app as unknown as { _isRunning: boolean })._isRunning).toBe(false);
  });

  it("routes a realtime frame through step via the RAF callback (loop wiring)", () => {
    const app = new TestSmallWorldMachine();
    attachTestRuntime(app);

    const rafCalls: FrameRequestCallback[] = [];
    const windowRef = window as unknown as {
      requestAnimationFrame?: (cb: FrameRequestCallback) => number;
    };
    const origRaf = windowRef.requestAnimationFrame;
    windowRef.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      rafCalls.push(cb);
      return 1;
    };

    try {
      const internal = app as unknown as {
        _isRunning: boolean;
        _lastTime: number;
        _loop(currentTime: number): void;
      };
      internal._isRunning = true;
      internal._lastTime = 1000;
      // 1060ms - 1000ms = 60ms -> 0.06s deltaTime, the exact body `step()` must receive.
      internal._loop(1060);

      expect(app.recordedDeltaTimes).toEqual([0.06]);
      expect(rafCalls).toHaveLength(1);
    } finally {
      if (origRaf === undefined) {
        delete windowRef.requestAnimationFrame;
      } else {
        windowRef.requestAnimationFrame = origRaf;
      }
    }
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
});
