import { describe, it, expect } from "vitest";
import { FlakturmKit } from "../builder/FlakturmKit.js";
import { Vector3D, PointLight } from "@small-world-machine/engine";

describe("FlakturmKit Prop & Material Builder", () => {
  it("creates a caged industrial fluorescent lamp with light source", () => {
    const lamp = FlakturmKit.createFluorescentLamp({
      name: "BunkerHallLamp",
      length: 1.5,
      caged: true,
      intensity: 2.0,
    });

    expect(lamp.name).toBe("BunkerHallLamp");
    expect(lamp.children.length).toBeGreaterThan(5);

    const pointLight = lamp.children.find((c) => c instanceof PointLight) as PointLight | undefined;
    expect(pointLight).toBeDefined();
    expect(pointLight?.intensity).toBe(2.0);

    const housing = lamp.children.find((c) => c.name === "Housing");
    expect(housing).toBeDefined();
    expect(housing?.scale.z).toBe(1.5);
  });

  it("creates an uncaged bare fluorescent lamp", () => {
    const lamp = FlakturmKit.createFluorescentLamp({
      caged: false,
      length: 1.0,
    });

    expect(lamp.name).toBe("FluorescentLamp");
    const cageHoop = lamp.children.find((c) => c.name.startsWith("CageHoop"));
    expect(cageHoop).toBeUndefined();
  });

  it("creates modular electrical conduit wiring with junction boxes", () => {
    const conduit = FlakturmKit.createConduitRun([
      {
        start: new Vector3D(0, 2.0, 0),
        end: new Vector3D(2.0, 2.0, 0),
        junctionAtStart: true,
        junctionAtEnd: true,
      },
      {
        start: new Vector3D(2.0, 2.0, 0),
        end: new Vector3D(2.0, 1.0, 0),
        junctionAtEnd: true,
      },
    ]);

    expect(conduit.name).toBe("ConduitRun");
    expect(conduit.children.length).toBeGreaterThan(4);

    const startBox = conduit.children.find((c) => c.name === "JunctionBox_Start_0");
    const endBox = conduit.children.find((c) => c.name === "JunctionBox_End_0");
    expect(startBox).toBeDefined();
    expect(endBox).toBeDefined();
  });

  it("creates a procedural rubble and rebar debris cluster", () => {
    const debris = FlakturmKit.createDebrisCluster(6, 0.8);
    expect(debris.name).toBe("DebrisCluster");
    expect(debris.children.length).toBeGreaterThanOrEqual(6);

    const rebarHook = debris.children.find((c) => c.name.startsWith("RebarHook"));
    expect(rebarHook).toBeDefined();
  });

  it("creates a wall-mounted ventilation hatch with mesh door", () => {
    const hatch = FlakturmKit.createVentHatch({
      name: "CorridorVentHatch",
      width: 0.9,
      height: 1.0,
      openAngle: Math.PI / 3,
    });

    expect(hatch.name).toBe("CorridorVentHatch");
    const collar = hatch.children.find((c) => c.name === "WallCollar");
    const hinge = hatch.children.find((c) => c.name === "DoorHinge");
    expect(collar).toBeDefined();
    expect(hinge).toBeDefined();
    expect(hinge?.rotation.y).toBeCloseTo(Math.PI / 3);
  });

  it("creates a reinforced concrete pillar with base and capital (ADR 0019)", () => {
    const pillar = FlakturmKit.createPillar({
      name: "HallPillar_1",
      width: 0.6,
      depth: 0.6,
      height: 3.5,
    });

    expect(pillar.name).toBe("HallPillar_1");
    expect(pillar.children.length).toBe(3); // shaft + base + capital
    const shaft = pillar.children.find((c) => c.name === "PillarShaft");
    const base = pillar.children.find((c) => c.name === "PillarBase");
    const cap = pillar.children.find((c) => c.name === "PillarCapital");
    expect(shaft).toBeDefined();
    expect(base).toBeDefined();
    expect(cap).toBeDefined();
    expect(shaft?.scale.y).toBe(3.5);
  });

  it("creates a ceiling beam girder (ADR 0019)", () => {
    const beam = FlakturmKit.createBeam({
      name: "CeilingGirder_1",
      length: 8.0,
      width: 0.5,
      height: 0.6,
    });

    expect(beam.name).toBe("CeilingGirder_1");
    const mesh = beam.children.find((c) => c.name === "BeamMesh");
    expect(mesh).toBeDefined();
    expect(mesh?.scale.z).toBe(8.0);
  });

  it("creates a modular segmented wall with damp baseboard and pilasters (ADR 0019)", () => {
    const wall = FlakturmKit.createSegmentedWall({
      name: "NorthHallWall",
      totalWidth: 10.0,
      height: 3.2,
      segmentWidth: 3.5,
      hasPillars: true,
    });

    expect(wall.name).toBe("NorthHallWall");
    // 10m / ~3.5m = 3 segments => 3 base panels + 3 upper panels + 4 pilasters
    const basePanels = wall.children.filter((c) => c.name.startsWith("BasePanel_"));
    const upperPanels = wall.children.filter((c) => c.name.startsWith("UpperPanel_"));
    const pilasters = wall.children.filter((c) => c.name.startsWith("Pilaster_"));

    expect(basePanels.length).toBe(3);
    expect(upperPanels.length).toBe(3);
    expect(pilasters.length).toBe(4);
  });
});
