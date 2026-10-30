import { describe, expect, it } from "vitest";
import {
  Object3D,
  StageMovementBehavior,
  MathPool,
  PointLight,
  Color,
  Vector3D,
} from "@small-world-machine/engine";
import { AnimationClip, Bone } from "@small-world-machine/engine/core/animation/index.js";
import { KeyframeTrack } from "@small-world-machine/engine/core/animation/KeyframeTrack.js";
import type { InputInterface } from "@small-world-machine/engine/core/input/Input.js";
import { PlayerRig } from "../scenes/shared/PlayerRig.js";
import type { PlayerRigLoader, PlayerRigType } from "../scenes/shared/PlayerRig.js";

/** Minimal input that StageMovementBehavior's constructor accepts without any DOM. */
const FAKE_INPUT: InputInterface = {
  mouse: {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    wheelX: 0,
    wheelY: 0,
    zoom: 0,
    left: false,
    right: false,
  },
  isPointerLocked: false,
  isPressed: (): boolean => false,
  getAxis: (): number => 0,
};

/** Camera position passed to the carried-fire driver, so the world-anchored trails can face a
 *  billboard -- a static shared vector (the driver only reads it). */
const CAMERA_POSITION = new Vector3D(0, 1.6, 3);

const CLIP_URLS: readonly string[] = [
  "/assets/the-whisper/mannequin/shared/anim/idle_1.glb",
  "/assets/the-whisper/mannequin/shared/anim/idle_2.glb",
  "/assets/the-whisper/mannequin/shared/anim/idle_torch.glb",
  "/assets/the-whisper/mannequin/shared/anim/walking.glb",
  "/assets/the-whisper/mannequin/shared/anim/walking_torch.glb",
  "/assets/the-whisper/mannequin/shared/anim/running_1.glb",
  "/assets/the-whisper/mannequin/shared/anim/running_2.glb",
  "/assets/the-whisper/mannequin/shared/anim/running_torch.glb",
  "/assets/the-whisper/mannequin/shared/anim/ascending_stairs.glb",
  "/assets/the-whisper/mannequin/shared/anim/walking.glb",
];

const CHARACTERS: Record<PlayerRigType, { url: string; scale: number }> = {
  male: { url: "male.glb", scale: 1.0 },
  female: { url: "female.glb", scale: 1.0 },
  yoshi: { url: "yoshi.glb", scale: 1.0 },
};

/** Builds a player whose left hand resolves to a `Bone` at a known world position. */
function makePlayer(bonePosition: [number, number, number] = [0, 1, 0]): Object3D {
  const player = new Object3D("player");
  const hand = new Bone("mixamorig:LeftHandMiddle1");
  hand.position.set(bonePosition[0], bonePosition[1], bonePosition[2]);
  player.add(hand);
  return player;
}

/** A valid single-keyframe clip; `includeHipsTranslation` emulates the Mixamo root-motion track
 *  the canonical pool must strip. */
function makeClip(name: string, includeHipsTranslation: boolean): AnimationClip {
  const tracks: KeyframeTrack[] = [
    new KeyframeTrack(
      "mixamorig:LeftHandMiddle1",
      "rotation",
      new Float32Array([0, 0.1]),
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]),
    ),
  ];
  if (includeHipsTranslation) {
    tracks.push(
      new KeyframeTrack(
        "mixamorig:Hips",
        "translation",
        new Float32Array([0, 0.1]),
        new Float32Array([0, 0, 0, 0.1, 0, 0]),
      ),
    );
  }
  return new AnimationClip(name, 0.1, tracks);
}

/** Deterministic fake loader: counts the number of clip-pool loads and character loads, and can be
 *  told to fail specific URLs so the fail-fast paths are exercised. */
class FakePlayerRigLoader implements PlayerRigLoader {
  public clipLoadCount: number = 0;
  public characterLoads: string[] = [];
  public readonly failCharacterUrl: string | undefined;
  public readonly failClipUrl: string | undefined;

  constructor(options: { failCharacterUrl?: string; failClipUrl?: string } = {}) {
    this.failCharacterUrl = options.failCharacterUrl;
    this.failClipUrl = options.failClipUrl;
  }

  public async loadCharacter(url: string): Promise<Object3D> {
    this.characterLoads.push(url);
    if (url === this.failCharacterUrl) throw new Error(`Fake load failure for ${url}`);
    return makePlayer();
  }

  public async loadAnimations(url: string): Promise<readonly AnimationClip[]> {
    this.clipLoadCount++;
    if (url === this.failClipUrl) throw new Error(`Fake clip failure for ${url}`);
    return [makeClip("fake-clip", true)];
  }
}

interface RigHarness {
  rig: PlayerRig;
  parent: Object3D;
  torchParent: Object3D;
  loader: FakePlayerRigLoader;
}

function buildRig(options: { loader?: FakePlayerRigLoader } = {}): RigHarness {
  const parent = new Object3D("parent-root");
  const torchParent = new Object3D("scene-root");
  const loader = options.loader ?? new FakePlayerRigLoader();
  const rig = new PlayerRig({
    parent,
    torchParent,
    input: FAKE_INPUT,
    characters: CHARACTERS,
    defaultStartUV: { u: 0.5, v: 0.5 },
    torchLight: new PointLight({ color: new Color(1, 0.8, 0.4) }),
    adjustMaterials: (): void => {},
    createMovementBehavior: (startUv): StageMovementBehavior =>
      new StageMovementBehavior({
        input: FAKE_INPUT,
        projection: { mode: "flat-plane", width: 2, height: 2, z: 0, centerY: 0 },
        startUV: startUv,
      }),
    loader,
  });
  return { rig, parent, torchParent, loader };
}

describe("PlayerRig state machine", () => {
  it("re-entrancy guard: a fast double switch returns the same in-flight promise and loads ONE player", async () => {
    const { rig, loader } = buildRig();

    const first = rig.switchCharacter("female");
    const second = rig.switchCharacter("yoshi");

    // The second call must not start a second player -- it joins the same switch.
    expect(second).toBe(first);
    await first;

    expect(rig.currentType).toBe("female");
    expect(loader.characterLoads).toEqual(["female.glb"]);
    // The rig holds exactly one player child.
    const players = rig.root.children.filter((c) => c.name === "player");
    expect(players.length).toBe(1);
  });

  it("clip pool is loaded exactly ONCE and reused across character switches", async () => {
    const { rig, loader } = buildRig();

    await rig.switchCharacter("male");
    const loadCountAfterFirstSwitch = loader.clipLoadCount;
    // The pool is loaded once with Promise.all -- one call per canonical clip URL.
    expect(loadCountAfterFirstSwitch).toBe(CLIP_URLS.length);

    await rig.switchCharacter("female");
    expect(loader.clipLoadCount).toBe(loadCountAfterFirstSwitch);
  });

  it("canonical pool strips the Mixamo Hips root-motion translation track from every clip", async () => {
    const { rig } = buildRig();
    await rig.switchCharacter("male");

    for (const clip of rig.clips.values()) {
      const rootMotion = clip.tracks.filter(
        (track) => track.targetName.includes("Hips") && track.property === "translation",
      );
      expect(rootMotion.length).toBe(0);
    }
  });

  it("replaces the StageMovementBehavior instead of stacking (remove old before adding new)", async () => {
    const { rig } = buildRig();

    await rig.switchCharacter("male");
    const firstBehavior = rig.movementBehavior;
    expect(rig.root.behaviors.length).toBe(1);
    expect(firstBehavior).toBeInstanceOf(StageMovementBehavior);

    await rig.switchCharacter("female");
    expect(rig.root.behaviors.length).toBe(1);
    expect(rig.movementBehavior).not.toBe(firstBehavior);
    expect(rig.root.behaviors.includes(firstBehavior as StageMovementBehavior)).toBe(false);
  });

  it("propagates a failed character load and keeps the rig in its previous valid state", async () => {
    const loader = new FakePlayerRigLoader({ failCharacterUrl: "yoshi.glb" });
    const { rig, loader: l } = buildRig({ loader });
    void l;

    await rig.switchCharacter("male");
    const previousPlayer = rig.root.getObjectByName("player");
    const previousBehavior = rig.movementBehavior;
    expect(rig.currentType).toBe("male");

    await expect(rig.switchCharacter("yoshi")).rejects.toThrow(/Fake load failure/);

    // Fail fast: nothing was mutated -- the previous player, behavior and skin stay.
    expect(rig.currentType).toBe("male");
    expect(rig.root.getObjectByName("player")).toBe(previousPlayer);
    expect(rig.movementBehavior).toBe(previousBehavior);
    expect(rig.root.behaviors.length).toBe(1);
  });

  it("propagates a failed clip-pool load on first use and leaves the rig untouched", async () => {
    const loader = new FakePlayerRigLoader({
      failClipUrl: "/assets/the-whisper/mannequin/shared/anim/walking_torch.glb",
    });
    const { rig } = buildRig({ loader });

    await expect(rig.switchCharacter("male")).rejects.toThrow(/Fake clip failure/);

    // The rig never swapped in a player -- it has no player child and no new skin.
    expect(rig.root.getObjectByName("player")).toBeUndefined();
    expect(rig.root.behaviors.length).toBe(0);
  });
});

describe("PlayerRig torch", () => {
  it("attaches the torch + fire under the identity scene root, syncs to the hand bone and drives the fire, allocation-free", async () => {
    // MathPool is a shared static pool; this file runs isolated per worker, and this test runs
    // first in the file, so the pool is fresh. A pool-based sync puts its two scratch vectors
    // back after the first frame (growth) and then stays put across thousands of frames
    // (strict balance = nothing allocated per frame once warm).
    const poolBefore = (MathPool as unknown as { readonly _VECTOR_POOL: unknown[] })._VECTOR_POOL
      .length;

    const { rig, torchParent } = buildRig();
    await rig.switchCharacter("male");

    // Complete the rig's scene-graph matrices so the bone world matrix is current.
    rig.root.updateMatrixWorld();

    // First frame -- warms the pool with the sync's scratch vectors on every valid implementation.
    rig.update(0.016);
    rig.updateTorch(0.016, CAMERA_POSITION);
    const poolAfterWarm = (MathPool as unknown as { readonly _VECTOR_POOL: unknown[] })._VECTOR_POOL
      .length;
    // The sync acquires and returns vectors to the pool (it does NOT allocate fresh vectors per
    // frame -- that is the old diorama bug this rig fixes). `updateTorch` adds none (its lean and
    // scratch vectors are persistent members, not pool vectors).
    expect(poolAfterWarm).toBeGreaterThan(poolBefore);
    const warmLevel = poolAfterWarm;

    // The torch hangs from the finger-bone grip: hand at (0,1,0), finger offset (0,+0.01,0),
    // bone scale 1 -> world grip stays at the hand plus the tiny forward offset.
    const torch = rig.torch;
    expect(torch).toBeDefined();
    expect(torch!.parent).toBe(torchParent);
    expect(torch!.position.y).toBeCloseTo(1.01, 6);
    expect(torch!.position.x).toBeCloseTo(0, 6);
    expect(torch!.position.z).toBeCloseTo(0, 6);

    // The carried fire is assembled with the scene's light reparented into the head and preserved
    // in colour, and the flame/glow/trails ride the torch.
    const fire = rig.torchFire;
    expect(fire).toBeDefined();
    expect(fire!.root.parent).toBe(torch);
    expect(fire!.light.isVisible).toBe(true);
    expect(fire!.flame.time).toBeGreaterThan(0);
    expect(fire!.lightBehavior.time).toBeGreaterThan(0);

    // Thousands of sync + fire frames: the pool must stay EXACTLY at its warm level
    // (acquire/release is strictly balanced -- no per-frame allocation, no pool leak), and the
    // carried fire keeps advancing (a frozen flame would fail the living-light contract).
    for (let i = 0; i < 1000; i++) {
      rig.update(0.016);
      rig.updateTorch(0.016, CAMERA_POSITION);
    }
    const poolAfter = (MathPool as unknown as { readonly _VECTOR_POOL: unknown[] })._VECTOR_POOL
      .length;
    expect(poolAfter).toBe(warmLevel);
    expect(torch!.position.y).toBeCloseTo(1.01, 6);
    expect(fire!.flame.time).toBeCloseTo(1001 * 0.016, 4);
    expect(fire!.lightBehavior.time).toBeCloseTo(1001 * 0.016, 4);
  });

  it("setTorchEnabled toggles the mesh AND the fire's attached scene light together", async () => {
    const { rig } = buildRig();
    await rig.switchCharacter("male");
    const torch = rig.torch;
    const fire = rig.torchFire;
    expect(torch).toBeDefined();
    expect(fire).toBeDefined();
    expect(rig.torchEnabled).toBe(true);
    expect(torch!.isVisible).toBe(true);
    expect(fire!.light.isVisible).toBe(true);

    rig.setTorchEnabled(false);
    expect(rig.torchEnabled).toBe(false);
    expect(torch!.isVisible).toBe(false);
    expect(fire!.light.isVisible).toBe(false);

    rig.setTorchEnabled(true);
    expect(rig.torchEnabled).toBe(true);
    expect(torch!.isVisible).toBe(true);
    expect(fire!.light.isVisible).toBe(true);
  });
});
