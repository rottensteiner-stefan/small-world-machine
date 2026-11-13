import { describe, expect, it } from "vitest";
import {
  CANDLE_COUNT,
  DEFAULT_FIRE_STRENGTH,
  fireStrengthParams,
  LIGHT_SCENES,
  sceneToState,
} from "../lighting.js";

describe("showcase 37 fire strength mapping", () => {
  it("reproduces the authored hearth exactly at the default strength", () => {
    const p = fireStrengthParams(DEFAULT_FIRE_STRENGTH);
    expect(p.scale).toBeCloseTo(1, 10);
    expect(p.flame).toBeCloseTo(1, 10);
    expect(p.glow).toBeCloseTo(1, 10);
    expect(p.light).toBeCloseTo(1, 10);
    expect(p.temperatureK).toBeCloseTo(1950, 6);
    expect(p.flameOn && p.embersOn).toBe(true);
  });

  it("burns down to embers only at 0 and grows monotonically to roaring at 1", () => {
    const glut = fireStrengthParams(0);
    expect(glut.flameOn).toBe(false);
    expect(glut.embersOn).toBe(false);
    expect(glut.light).toBeGreaterThan(0); // the ember bed still lights the hearth a little
    const roar = fireStrengthParams(1);
    for (const k of ["scale", "flame", "glow", "light", "temperatureK"] as const) {
      expect(roar[k]).toBeGreaterThan(fireStrengthParams(DEFAULT_FIRE_STRENGTH)[k]);
      expect(fireStrengthParams(DEFAULT_FIRE_STRENGTH)[k]).toBeGreaterThan(glut[k]);
    }
  });

  it("clamps out-of-range strengths", () => {
    expect(fireStrengthParams(-1)).toEqual(fireStrengthParams(0));
    expect(fireStrengthParams(2)).toEqual(fireStrengthParams(1));
  });
});

describe("showcase 37 lighting scenes", () => {
  it("expands the candle flag to one state per candle (independent copies)", () => {
    const a = sceneToState(LIGHT_SCENES[0]!);
    const b = sceneToState(LIGHT_SCENES[0]!);
    expect(a.candles).toHaveLength(CANDLE_COUNT);
    a.candles[0] = false;
    expect(b.candles[0]).toBe(true);
  });
});
