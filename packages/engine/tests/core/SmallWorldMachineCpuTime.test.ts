// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmallWorldMachine } from "../../src/core/index.js";
import { makeMockAudioContext } from "../audio/mockAudioContext.js";

let origAudioContext: unknown;
const installAudioMock = (): void => {
  origAudioContext = (window as unknown as { AudioContext: unknown }).AudioContext;
  (window as unknown as { AudioContext: unknown }).AudioContext = class {
    constructor() {
      return makeMockAudioContext();
    }
  };
};
const restoreAudioMock = (): void => {
  (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
};

class TestMachine extends SmallWorldMachine {
  public stepCalls = 0;
  constructor() {
    super();
  }
  protected override async setupScene(): Promise<void> {}
  protected override update(_deltaTime: number): void {}
  public override step(_deltaTime: number): void {
    this.stepCalls++;
  }
  /** Drives one realtime frame the way the rAF callback does. */
  public frame(timestamp: number): void {
    const internals = this as unknown as { _isRunning: boolean; _loop(t: number): void };
    internals._isRunning = true;
    internals._loop(timestamp);
  }
}

describe("SmallWorldMachine.lastCpuTimeMs", () => {
  beforeEach(installAudioMock);
  afterEach(() => {
    restoreAudioMock();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts at 0 before any frame ran", () => {
    expect(new TestMachine().lastCpuTimeMs).toBe(0);
  });

  it("holds the wall time of the frame's step() and is overwritten each frame", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    const machine = new TestMachine();
    // `_loop` brackets `step()` with exactly two performance.now() reads (cpuStart, end).
    const now = vi.spyOn(performance, "now");

    now.mockReturnValueOnce(100).mockReturnValueOnce(104.5);
    machine.frame(16);
    expect(machine.stepCalls).toBe(1);
    expect(machine.lastCpuTimeMs).toBeCloseTo(4.5, 10);

    now.mockReturnValueOnce(200).mockReturnValueOnce(201.25);
    machine.frame(32);
    expect(machine.lastCpuTimeMs).toBeCloseTo(1.25, 10);
  });

  it("is not touched by a direct step() call (only the realtime loop measures)", () => {
    const machine = new TestMachine();
    machine.step(0.016);
    expect(machine.lastCpuTimeMs).toBe(0);
  });
});
