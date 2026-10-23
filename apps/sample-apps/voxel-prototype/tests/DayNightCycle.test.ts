import { describe, expect, it } from "vitest";
import { DayNightCycle } from "../voxel/environment/DayNightCycle.js";

describe("DayNightCycle (M4)", () => {
  it("initializes with default options and progresses over time", () => {
    const cycle = new DayNightCycle({ cycleDuration: 100, initialTime: 0 });
    expect(cycle.time).toBe(0);

    cycle.update(25);
    expect(cycle.time).toBeCloseTo(0.25, 4);

    cycle.update(75);
    expect(cycle.time).toBeCloseTo(0, 4); // rolled over 1.0 -> 0.0
  });

  it("calculates peak daylight at noon and minimum at midnight", () => {
    const cycle = new DayNightCycle();

    // Noon
    cycle.setTime(0.25);
    expect(cycle.getDaylight()).toBeCloseTo(1.0, 2);
    expect(cycle.getTimePhase()).toBe("day");

    // Sunset
    cycle.setTime(0.5);
    expect(cycle.getDaylight()).toBeCloseTo(0.15, 2);
    expect(cycle.getTimePhase()).toBe("sunset");

    // Midnight
    cycle.setTime(0.75);
    expect(cycle.getDaylight()).toBeCloseTo(0.15, 2);
    expect(cycle.getTimePhase()).toBe("night");

    // Sunrise
    cycle.setTime(0.0);
    expect(cycle.getDaylight()).toBeCloseTo(0.15, 2);
    expect(cycle.getTimePhase()).toBe("sunrise");
  });

  it("produces valid normalized sun directions", () => {
    const cycle = new DayNightCycle();
    for (let t = 0; t < 1.0; t += 0.1) {
      cycle.setTime(t);
      const [x, y, z] = cycle.getSunDirection();
      const length = Math.hypot(x, y, z);
      expect(length).toBeCloseTo(1.0, 4);
      expect(y).toBeGreaterThan(0); // sun always points with some downward light
    }
  });

  it("interpolates sky colors across day and night", () => {
    const cycle = new DayNightCycle();

    // Noon: bright blue
    cycle.setTime(0.25);
    const dayColor = cycle.getSkyColor();
    expect(dayColor.b).toBeGreaterThan(dayColor.r);

    // Midnight: dark navy
    cycle.setTime(0.75);
    const nightColor = cycle.getSkyColor();
    expect(nightColor.r).toBeLessThan(0.1);
    expect(nightColor.g).toBeLessThan(0.1);
    expect(nightColor.b).toBeLessThan(0.1);
  });
});
