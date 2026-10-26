import { describe, it, expect } from "vitest";
import { StageZone } from "../../../src/core/stage/StageZone.js";
import { StageZoneMarker } from "../../../src/core/stage/StageZoneMarker.js";

describe("StageZoneMarker", () => {
  function makeZone(): StageZone {
    return new StageZone({
      id: "zone_a",
      name: "ZONE A: TEST",
      points: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
        { u: 0, v: 1 },
      ],
    });
  }

  it("uses the zone's id as its own Object3D name", () => {
    const marker = new StageZoneMarker(makeZone());
    expect(marker.name).toBe("zone_a");
  });

  it("has no geometry/material -- it is a non-renderable marker node", () => {
    const marker = new StageZoneMarker(makeZone());
    expect(marker.geometry).toBeUndefined();
    expect(marker.material).toBeUndefined();
  });

  it("clone() deep-clones the held zone's points, not just a shared reference", () => {
    const marker = new StageZoneMarker(makeZone());
    const copy = marker.clone();

    expect(copy.zone).not.toBe(marker.zone);
    expect(copy.zone.points).not.toBe(marker.zone.points);
    expect(copy.zone.points).toEqual(marker.zone.points);

    copy.zone.points[0]!.u = 0.99;
    expect(marker.zone.points[0]!.u).toBe(0);
  });

  it("clone() deep-clones scaleGradient configuration", () => {
    const zone = new StageZone({
      id: "gradient_zone",
      name: "Gradient Zone",
      points: [
        { u: 0, v: 0 },
        { u: 1, v: 0 },
        { u: 1, v: 1 },
      ],
      scaleGradient: {
        mode: "linear",
        start: { u: 0.5, v: 1.0, scale: 1.0 },
        end: { u: 0.5, v: 0.0, scale: 0.3 },
      },
      useScaleGradient: true,
    });
    const marker = new StageZoneMarker(zone);
    const copy = marker.clone();

    expect(copy.zone.scaleGradient).toEqual(zone.scaleGradient);
    expect(copy.zone.scaleGradient).not.toBe(zone.scaleGradient);
    expect(copy.zone.useScaleGradient).toBe(true);
  });
});
