// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SmallWorldMachine } from "../../src/core/index.js";
import { RendererType } from "../../src/enums/index.js";
import { createFrameInfo, type Renderer } from "../../src/interfaces/index.js";
import { PostProcessingGroup, TaaElement } from "../../src/renderers/post/index.js";
import { makeMockAudioContext } from "../audio/mockAudioContext.js";

class TestSmallWorldMachine extends SmallWorldMachine {
  public readonly recordedDeltaTimes: number[] = [];

  constructor() {
    super();
  }

  protected override async setupScene(): Promise<void> {
    // Test scene: nothing to set up.
  }

  protected override update(deltaTime: number): void {
    this.recordedDeltaTimes.push(deltaTime);
  }
}

const attachedCanvases: HTMLCanvasElement[] = [];
let origAudioContext: unknown;

// jsdom has no GPU and `SmallWorldMachine` only acquires its real canvas/renderer in `start()`, so
// the fixed-timestep hooks are exercised against a stubbed canvas + renderer. The canvas must have
// a real size so the TAA jitter path is active, and is appended to the DOM so the `_loop` "canvas
// removed" guard keeps running instead of auto-destroying.
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

describe("SmallWorldMachine capture stepping determinism for temporal effects", () => {
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

  it("produces an identical deterministic frameInfo sequence across fresh instances for a fixed 60 Hz run", () => {
    const appA = new TestSmallWorldMachine();
    const appB = new TestSmallWorldMachine();
    attachTestRuntime(appA);
    attachTestRuntime(appB);

    const snapshotsA: Array<{ frameIndex: number; time: number; realTime: number }> = [];
    const snapshotsB: Array<{ frameIndex: number; time: number; realTime: number }> = [];
    for (let i = 0; i < 60; i++) {
      snapshotsA.push({
        frameIndex: appA.frameInfo.frameIndex,
        time: appA.frameInfo.time,
        realTime: appA.frameInfo.realTime,
      });
      snapshotsB.push({
        frameIndex: appB.frameInfo.frameIndex,
        time: appB.frameInfo.time,
        realTime: appB.frameInfo.realTime,
      });
      appA.step(1 / 60);
      appB.step(1 / 60);
    }

    expect(appA.frameInfo.frameIndex).toBe(60);
    expect(appB.frameInfo.frameIndex).toBe(60);
    expect(appA.frameInfo.time).toBeCloseTo(1.0, 9);
    expect(appA.frameInfo.realTime).toBeCloseTo(1.0, 9);
    // Pre-step snapshots verify every intermediate frame state, not just the final one.
    for (let i = 0; i < snapshotsA.length; i++) {
      expect(snapshotsA[i]!.frameIndex).toBe(i);
      expect(snapshotsB[i]!.frameIndex).toBe(i);
    }
    expect(snapshotsA).toEqual(snapshotsB);
    expect(appA.recordedDeltaTimes).toEqual(appB.recordedDeltaTimes);
    expect(appA.renderer.frameInfo).toBe(appA.frameInfo);
  });

  it("advances frameIndex by exactly one and time by exactly 1/60 on every step, with no dropped or repeated frames", () => {
    const run = (): Array<{ frameIndex: number; time: number; realTime: number }> => {
      const app = new TestSmallWorldMachine();
      attachTestRuntime(app);
      const out: Array<{ frameIndex: number; time: number; realTime: number }> = [];
      for (let i = 0; i < 30; i++) {
        app.step(1 / 60);
        out.push({
          frameIndex: app.frameInfo.frameIndex,
          time: app.frameInfo.time,
          realTime: app.frameInfo.realTime,
        });
      }
      return out;
    };

    const out = run();
    for (let i = 0; i < out.length; i++) {
      expect(out[i]!.frameIndex).toBe(i + 1);
      expect(out[i]!.time).toBeCloseTo((i + 1) / 60, 9);
      expect(out[i]!.realTime).toBeCloseTo((i + 1) / 60, 9);
    }
  });

  it("captureFrameRate fixes the realtime loop's step delta regardless of wall-clock hitch", () => {
    const app = new TestSmallWorldMachine();
    attachTestRuntime(app);
    app.captureFrameRate = 30;

    const windowRef = window as unknown as {
      requestAnimationFrame?: (cb: FrameRequestCallback) => number;
    };
    const origRaf = windowRef.requestAnimationFrame;
    windowRef.requestAnimationFrame = (): number => 1;

    try {
      const internal = app as unknown as {
        _isRunning: boolean;
        _lastTime: number;
        _loop(currentTime: number): void;
      };
      internal._isRunning = true;
      internal._lastTime = 1000;
      // A long hitch followed by a short frame: wall-clock distance must not leak into the capture.
      internal._loop(9999);
      internal._loop(10001);

      expect(app.recordedDeltaTimes).toEqual([1 / 30, 1 / 30]);
      expect(app.frameInfo.frameIndex).toBe(2);
      expect(app.frameInfo.time).toBeCloseTo(2 / 30, 9);
      expect(app.frameInfo.realTime).toBeCloseTo(2 / 30, 9);
    } finally {
      if (origRaf === undefined) {
        delete windowRef.requestAnimationFrame;
      } else {
        windowRef.requestAnimationFrame = origRaf;
      }
    }
  });

  it("TAA sub-pixel jitter follows a deterministic 16-frame cycle under capture stepping", () => {
    const run = (): Array<{ jitterX: number; jitterY: number }> => {
      const app = new TestSmallWorldMachine();
      attachTestRuntime(app);
      const taa = new TaaElement();
      taa.enabled = true;
      app.renderer.postProcessing.add(taa);

      const out: Array<{ jitterX: number; jitterY: number }> = [];
      for (let i = 0; i < 20; i++) {
        app.step(1 / 60);
        out.push({ jitterX: app.camera.jitterX, jitterY: app.camera.jitterY });
      }
      return out;
    };

    const a = run();
    const b = run();
    expect(a).toEqual(b);

    // The TAA jitter index advances (index % 16) + 1, so the baked offset is periodic with 16.
    for (let i = 0; i + 16 < a.length; i++) {
      expect(a[i + 16]!.jitterX).toBe(a[i]!.jitterX);
      expect(a[i + 16]!.jitterY).toBe(a[i]!.jitterY);
    }
    // The offset is a real per-frame camera-space sub-pixel jitter, bounded by one texel.
    for (const s of a) {
      expect(Math.abs(s.jitterX)).toBeLessThanOrEqual(1 / 320);
      expect(Math.abs(s.jitterY)).toBeLessThanOrEqual(1 / 200);
    }
    // Frames within a cycle are not constant -- otherwise there would be nothing to resolve temporally.
    expect(a[0]!.jitterX).not.toBe(a[1]!.jitterX);
    expect(a[1]!.jitterX).not.toBe(0);
  });
});
