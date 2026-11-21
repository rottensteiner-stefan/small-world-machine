import { describe, it, expect } from "vitest";
import { PerformanceGovernor } from "../../../src/core/quality/PerformanceGovernor.js";

describe("PerformanceGovernor (ADR 0035 Phase 4)", () => {
  it("stays inactive when disabled and keeps renderScale at maxScale", () => {
    const gov = new PerformanceGovernor({ enabled: false, maxScale: 0.9 });
    expect(gov.enabled).toBe(false);
    expect(gov.renderScale).toBe(0.9);
    for (let i = 0; i < 30; i++) {
      expect(gov.recordFrame(35, 2, i * 35)).toBeNull();
    }
    expect(gov.renderScale).toBe(0.9);
  });

  it("steps down renderScale on sustained GPU-bound frame budget misses after warmup + cooldown", () => {
    const gov = new PerformanceGovernor({
      enabled: true,
      targetFps: 60,
      minScale: 0.5,
      maxScale: 1.0,
      step: 0.1,
      cooldownMs: 1000,
      warmupFrames: 5,
    });

    // Warmup frames (4 frames): no change yet
    for (let i = 0; i < 4; i++) {
      expect(gov.recordFrame(28, 3, 1000 + i * 28)).toBeNull();
    }

    // Frame 5 finishes warmup and triggers first step down
    const first = gov.recordFrame(28, 3, 2000);
    expect(first).toBe(0.9);
    expect(gov.lastBottleneck).toBe("gpu");

    // Immediately afterwards (inside 1000ms cooldown): refused
    expect(gov.recordFrame(28, 3, 2500)).toBeNull();
    expect(gov.renderScale).toBe(0.9);

    // After cooldown expires: steps down again cleanly without float drift
    expect(gov.recordFrame(28, 3, 3000)).toBe(0.8);
  });

  it("refuses to downscale when frame misses are CPU-bound", () => {
    const gov = new PerformanceGovernor({
      enabled: true,
      targetFps: 60,
      warmupFrames: 3,
      cooldownMs: 0,
    });

    for (let i = 0; i < 5; i++) {
      expect(gov.recordFrame(30, 20, (i + 1) * 30)).toBeNull();
    }
    expect(gov.lastBottleneck).toBe("cpu");
    expect(gov.renderScale).toBe(1.0);
  });

  it("recovers scale up to maxScale with hysteresis headroom and ignores tab-switch spikes", () => {
    const gov = new PerformanceGovernor({
      enabled: true,
      targetFps: 60,
      minScale: 0.5,
      maxScale: 1.0,
      step: 0.1,
      cooldownMs: 500,
      warmupFrames: 2,
    });

    // Force downscale cleanly
    gov.recordFrame(30, 2, 100);
    expect(gov.recordFrame(30, 2, 200)).toBe(0.9);

    // Tab switch outlier (> 250ms) must be ignored cleanly
    expect(gov.recordFrame(2000, 5, 3000)).toBeNull();
    expect(gov.renderScale).toBe(0.9);

    // Sustained fast frames pull EMA below 60Hz * 0.82 (~13.67ms)
    let recovered: number | null = null;
    for (let i = 1; i <= 25; i++) {
      const next = gov.recordFrame(8, 2, 4000 + i * 500);
      if (next !== null) recovered = next;
    }
    expect(recovered).toBe(1.0);
    expect(gov.renderScale).toBe(1.0);
  });
});
