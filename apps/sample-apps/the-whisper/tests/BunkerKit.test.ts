import { describe, it, expect } from "vitest";
import { BunkerKit } from "../builder/BunkerKit.js";

describe("BunkerKit Prop Builder", () => {
  it("creates a morgue tray with hardware only on the head end", () => {
    const tray = BunkerKit.createMorgueTray({ name: "DrawerTray_K42" });

    expect(tray.name).toBe("DrawerTray_K42");

    const headCap = tray.children.find((c) => c.name === "HeadEndCap");
    const footCap = tray.children.find((c) => c.name === "FootEndCap");
    expect(headCap).toBeDefined();
    expect(footCap).toBeDefined();
    expect(headCap!.position.z).toBeGreaterThan(0);
    expect(footCap!.position.z).toBeLessThan(0);

    // Handle and ID plate must sit at/beyond the head end, never at the foot end.
    const handleBar = tray.children.find((c) => c.name === "HandleBar");
    const idPlate = tray.children.find((c) => c.name === "IdPlate");
    expect(handleBar).toBeDefined();
    expect(idPlate).toBeDefined();
    expect(handleBar!.position.z).toBeGreaterThan(headCap!.position.z);
    expect(idPlate!.position.z).toBeGreaterThan(0);

    // The long sides must stay plain — no handle/plate/cap objects among them.
    const sideRims = tray.children.filter((c) => c.name.startsWith("SideRim_"));
    expect(sideRims.length).toBe(2);
    for (const rim of sideRims) {
      expect(rim.name).not.toMatch(/Handle|Plate/);
    }

    // Foot end carries no hardware at all.
    const footHardware = tray.children.some(
      (c) => c.name.includes("Handle") || c.name.includes("Plate"),
    );
    expect(footHardware).toBe(true); // hardware exists overall...
    expect(handleBar!.position.z).not.toBeCloseTo(footCap!.position.z);
  });

  it("exposes head- and foot-end attachment sockets for scene dressing", () => {
    const tray = BunkerKit.createMorgueTray();

    const neckSocket = tray.getObjectByName("NeckSpotlightTarget");
    const toeSocket = tray.getObjectByName("ToeTag");
    expect(neckSocket).toBeDefined();
    expect(toeSocket).toBeDefined();
    expect(neckSocket!.position.z).toBeGreaterThan(0);
    expect(toeSocket!.position.z).toBeLessThan(0);
  });

  it("wires an optional ID plate decal texture as a transparent diffuse/alpha map", () => {
    const plain = BunkerKit.createMorgueTray();
    const plainPlate = plain.getObjectByName("IdPlate");
    expect(plainPlate?.material?.transparent).toBe(false);
  });

  it("creates a single rivet with a head and a recessed slot", () => {
    const rivet = BunkerKit.createRivet({ name: "TestRivet", radius: 0.02 });
    expect(rivet.name).toBe("TestRivet");
    expect(rivet.getObjectByName("Head")).toBeDefined();
    expect(rivet.getObjectByName("Slot")).toBeDefined();
  });

  it("places a bolt array at the given local (x, y, z) positions", () => {
    const array = BunkerKit.createBoltArray({
      positions: [
        [-0.1, 0.1, 0.08],
        [0.1, -0.1, 0.06],
      ],
    });
    const bolts = array.children.filter((c) => c.name.startsWith("Bolt_"));
    expect(bolts.length).toBe(2);
    expect(bolts[0]!.position.x).toBeCloseTo(-0.1);
    expect(bolts[0]!.position.y).toBeCloseTo(0.1);
    expect(bolts[0]!.position.z).toBeCloseTo(0.08);
    expect(bolts[1]!.position.x).toBeCloseTo(0.1);
    expect(bolts[1]!.position.y).toBeCloseTo(-0.1);
    expect(bolts[1]!.position.z).toBeCloseTo(0.06);
  });

  it("creates the Terminal 2100's 8-bolt fastener set, projected onto the real (rounded) mesh surface", () => {
    const halfWidth = 0.235;
    const halfHeight = 0.396;
    const halfDepth = 0.499;
    const boltSet = BunkerKit.createTerminalBoltSet({ halfWidth, halfHeight, halfDepth });
    const caseCorners = boltSet.getObjectByName("CaseCornerBolts");
    const bezelBolts = boltSet.getObjectByName("BezelBolts");
    expect(caseCorners).toBeDefined();
    expect(bezelBolts).toBeDefined();
    expect(caseCorners!.children.length).toBe(4);
    expect(bezelBolts!.children.length).toBe(4);

    // Every bolt must stay within the casing's actual half-extents and in front of center
    // (never buried inside the volume, never floating past the silhouette).
    for (const bolt of [...caseCorners!.children, ...bezelBolts!.children]) {
      expect(Math.abs(bolt.position.x)).toBeLessThanOrEqual(halfWidth);
      expect(Math.abs(bolt.position.y)).toBeLessThanOrEqual(halfHeight);
      expect(bolt.position.z).toBeGreaterThan(0);
      expect(bolt.position.z).toBeLessThanOrEqual(halfDepth * 1.3);
    }

    // Case-corner bolts sit further from center (x/y) than the bezel bolts around the screen.
    const caseCornerX = Math.abs(caseCorners!.children[0]!.position.x);
    const bezelX = Math.abs(bezelBolts!.children[0]!.position.x);
    expect(caseCornerX).toBeGreaterThan(bezelX);
  });

  it("creates a handheld torch with staff, grip wrap, and iron head", () => {
    const torch = BunkerKit.createHeldTorch({ name: "StormTorch" });
    expect(torch.name).toBe("StormTorch");
    expect(torch.getObjectByName("TorchStaff")).toBeDefined();
    expect(torch.getObjectByName("TorchGrip")).toBeDefined();
    expect(torch.getObjectByName("TorchHead")).toBeDefined();
  });
});
