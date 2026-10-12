// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Decal, Matrix4, Object3D, Vector3D } from "@small-world-machine/engine";
import {
  DecalStampTool,
  decalEulerFromNormal,
  quaternionFromNormal,
  type DecalStampContext,
  type DecalStampHit,
} from "../../src/maker/DecalStampTool.js";

const key = (k: string, init: KeyboardEventInit = {}): KeyboardEvent =>
  new KeyboardEvent("keydown", { key: k, cancelable: true, ...init });

/** Where the decal's local +Y ends up in world space for the given Euler angles. */
function worldUp(euler: Vector3D): Vector3D {
  const m = new Matrix4().compose(new Vector3D(0, 0, 0), euler, new Vector3D(1, 1, 1));
  const d = m.data;
  return new Vector3D(d[4]!, d[5]!, d[6]!);
}

describe("decal orientation from a surface normal", () => {
  const normals: [string, Vector3D][] = [
    ["floor", new Vector3D(0, 1, 0)],
    ["ceiling", new Vector3D(0, -1, 0)],
    ["east wall", new Vector3D(1, 0, 0)],
    ["west wall", new Vector3D(-1, 0, 0)],
    ["south wall", new Vector3D(0, 0, 1)],
    ["slope", new Vector3D(1, 2, -3).normalize()],
  ];

  for (const [name, n] of normals) {
    it(`maps +Y onto the normal (${name}), whatever the spin`, () => {
      for (const spin of [0, Math.PI / 12, -Math.PI / 2, 2.5]) {
        const up = worldUp(decalEulerFromNormal(n, spin));
        expect(up.x).toBeCloseTo(n.x, 5);
        expect(up.y).toBeCloseTo(n.y, 5);
        expect(up.z).toBeCloseTo(n.z, 5);
      }
    });
  }

  it("leaves a floor decal unrotated at zero spin", () => {
    const e = decalEulerFromNormal(new Vector3D(0, 1, 0), 0);
    expect([e.x, e.y, e.z].map((v) => Math.abs(v) < 1e-9)).toEqual([true, true, true]);
  });

  it("spin rotates about the normal: the image axis turns by exactly the spin angle", () => {
    const n = new Vector3D(1, 0, 0);
    const m0 = new Matrix4().compose(
      new Vector3D(),
      decalEulerFromNormal(n, 0),
      new Vector3D(1, 1, 1),
    );
    const m1 = new Matrix4().compose(
      new Vector3D(),
      decalEulerFromNormal(n, Math.PI / 2),
      new Vector3D(1, 1, 1),
    );
    const x0 = new Vector3D(m0.data[0]!, m0.data[1]!, m0.data[2]!);
    const x1 = new Vector3D(m1.data[0]!, m1.data[1]!, m1.data[2]!);
    expect(x0.x * n.x + x0.y * n.y + x0.z * n.z).toBeCloseTo(0);
    expect(x0.x * x1.x + x0.y * x1.y + x0.z * x1.z).toBeCloseTo(0); // 90 degrees apart
  });

  it("returns a unit quaternion even for the antiparallel case", () => {
    const q = quaternionFromNormal(new Vector3D(0, -1, 0));
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1);
  });
});

describe("DecalStampTool", () => {
  let hit: DecalStampHit | undefined;
  let added: Decal[];
  let sceneChildren: Object3D[];
  let ctx: DecalStampContext;
  let tool: DecalStampTool;
  const armed = {
    kitDecal: "kit/sign",
    name: "Sign",
    size: [2, 1, 0.5] as [number, number, number],
  };

  /** Lets the async ghost creation (hydrate) settle. */
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    hit = { point: new Vector3D(1, 0, 2), normal: new Vector3D(0, 1, 0) };
    added = [];
    sceneChildren = [];
    ctx = {
      raycast: vi.fn(() => hit),
      scene: {
        add: (o: Object3D): void => void sceneChildren.push(o),
        remove: (o: Object3D): void => void sceneChildren.splice(sceneChildren.indexOf(o), 1),
      },
      hydrate: vi.fn().mockResolvedValue(true),
      addObject: vi.fn((d: Decal) => void added.push(d)),
      getNudgeStep: (): number => 0.5,
      getScaleStep: (): number => 0.25,
      setStatus: vi.fn(),
    };
    tool = new DecalStampTool(ctx);
  });

  it("D toggles the mode; Ctrl/Cmd+D is left to duplicate", () => {
    const button = document.createElement("button");
    tool.setButton(button);
    expect(tool.handleKeyDown(key("d"))).toBe(true);
    expect(tool.isActive).toBe(true);
    expect(button.classList.contains("active")).toBe(true);
    expect(tool.handleKeyDown(key("D"))).toBe(true);
    expect(tool.isActive).toBe(false);
    expect(button.classList.contains("active")).toBe(false);

    expect(tool.handleKeyDown(key("d", { ctrlKey: true }))).toBe(false);
    expect(tool.handleKeyDown(key("d", { metaKey: true }))).toBe(false);
    expect(tool.isActive).toBe(false);
  });

  it("does not swallow R, arrows or Escape while inactive", () => {
    for (const k of ["r", "ArrowLeft", "ArrowUp", "Escape"]) {
      expect(tool.handleKeyDown(key(k))).toBe(false);
    }
  });

  it("arming switches the mode on and shows a semi-transparent ghost over the surface", async () => {
    tool.arm(armed);
    expect(tool.isActive).toBe(true);
    await flush();
    tool.handlePointerMove(10, 10);

    expect(sceneChildren).toHaveLength(1);
    const ghost = sceneChildren[0] as Decal;
    expect(ghost).toBeInstanceOf(Decal);
    expect(tool.isGhost(ghost)).toBe(true);
    expect((ghost.material as { color: { a: number } }).color.a).toBeLessThan(1);
    expect(ghost.position.x).toBeCloseTo(1);
    expect(ghost.position.z).toBeCloseTo(2);
    expect(ghost.scale.x).toBeCloseTo(2); // width
    expect(ghost.scale.y).toBeCloseTo(0.5); // projection depth
    expect(ghost.scale.z).toBeCloseTo(1); // height
  });

  it("R spins by 15 degrees about the normal, Shift+R reverses", async () => {
    tool.arm(armed);
    await flush();
    tool.handleKeyDown(key("r"));
    expect(tool.spin).toBeCloseTo(Math.PI / 12);
    tool.handleKeyDown(key("r", { shiftKey: true }));
    tool.handleKeyDown(key("R", { shiftKey: true }));
    expect(tool.spin).toBeCloseTo(-Math.PI / 12);
  });

  it("arrows nudge in the tangent plane by the snap step and reset when the mouse moves", async () => {
    tool.arm(armed);
    await flush();
    tool.handlePointerMove(0, 0);
    const ghost = sceneChildren[0] as Decal;

    tool.handleKeyDown(key("ArrowRight"));
    expect(ghost.position.x).toBeCloseTo(1.5);
    tool.handleKeyDown(key("ArrowUp")); // -Z on a floor
    expect(ghost.position.z).toBeCloseTo(1.5);
    expect(ghost.position.y).toBeCloseTo(0);

    tool.handlePointerMove(1, 1);
    expect(ghost.position.x).toBeCloseTo(1);
    expect(ghost.position.z).toBeCloseTo(2);
  });

  it("nudges along the wall plane, not through it", async () => {
    hit = { point: new Vector3D(0, 1, -3), normal: new Vector3D(0, 0, 1) };
    tool.arm(armed);
    await flush();
    tool.handlePointerMove(0, 0);
    const ghost = sceneChildren[0] as Decal;
    tool.handleKeyDown(key("ArrowUp"));
    expect(ghost.position.z).toBeCloseTo(-3);
    expect(ghost.position.y).toBeCloseTo(1.5); // up on screen
  });

  it("Shift+arrows scale uniformly and keep the aspect ratio", async () => {
    tool.arm(armed);
    await flush();
    tool.handleKeyDown(key("ArrowRight", { shiftKey: true }));
    expect(tool.size[0]).toBeCloseTo(2.25);
    expect(tool.size[0] / tool.size[1]).toBeCloseTo(2);
    for (let i = 0; i < 40; i++) tool.handleKeyDown(key("ArrowLeft", { shiftKey: true }));
    expect(tool.size[0]).toBeGreaterThan(0);
  });

  it("Escape leaves the mode and removes the ghost", async () => {
    tool.arm(armed);
    await flush();
    tool.handlePointerMove(0, 0);
    expect(sceneChildren).toHaveLength(1);
    expect(tool.handleKeyDown(key("Escape"))).toBe(true);
    expect(tool.isActive).toBe(false);
    expect(sceneChildren).toHaveLength(0);
  });

  it("a click stamps exactly one real, hydrated Decal with the ghost's pose", async () => {
    tool.arm(armed);
    await flush();
    tool.handlePointerMove(0, 0);
    tool.handleKeyDown(key("r"));

    await expect(tool.handlePointerDown(0, 0)).resolves.toBe(true);
    expect(ctx.addObject).toHaveBeenCalledTimes(1);
    const decal = added[0]!;
    expect(decal).toBeInstanceOf(Decal);
    expect(decal.kitDecal).toBe("kit/sign");
    expect((decal.material as { color: { a: number } }).color.a).toBe(1);
    expect(decal.scale.x).toBeCloseTo(2);
    expect(decal.scale.y).toBeCloseTo(0.5);
    expect(decal.scale.z).toBeCloseTo(1);
    expect(decal.position.x).toBeCloseTo(1);
    expect(decal.position.z).toBeCloseTo(2);
    // hydrated before it was added
    expect(ctx.hydrate).toHaveBeenCalledWith(decal);
    expect(tool.isGhost(decal)).toBe(false);
    // the mode stays on for the next stamp
    expect(tool.isActive).toBe(true);
  });

  it("does not stamp over empty space or without an armed decal", async () => {
    tool.handleKeyDown(key("d"));
    await tool.handlePointerDown(0, 0);
    expect(ctx.setStatus).toHaveBeenCalled();
    expect(ctx.addObject).not.toHaveBeenCalled();

    tool.arm(armed);
    await flush();
    hit = undefined;
    await tool.handlePointerDown(0, 0);
    expect(ctx.addObject).not.toHaveBeenCalled();
  });

  it("keeps a stamp at the world origin away from addObject's (0,0,0) respawn rule", async () => {
    hit = { point: new Vector3D(0, 0, 0), normal: new Vector3D(0, 1, 0) };
    tool.arm(armed);
    await flush();
    await tool.handlePointerDown(0, 0);
    const p = added[0]!.position;
    expect(0 === p.x && 0 === p.y && 0 === p.z).toBe(false);
  });

  it("stamp raycasts are driven by the context, which never sees the ghost (isGhost filters it)", async () => {
    tool.arm(armed);
    await flush();
    tool.handlePointerMove(0, 0);
    const ghost = sceneChildren[0]!;
    expect(tool.isGhost(ghost)).toBe(true);
    expect(tool.isGhost(new Object3D("other"))).toBe(false);
    expect(ghost.isCollidable).toBe(false);
  });
});
