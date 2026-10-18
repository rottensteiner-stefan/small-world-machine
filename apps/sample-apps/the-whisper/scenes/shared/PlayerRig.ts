import type {
  AnimationAction,
  AnimationClip,
} from "@small-world-machine/engine/core/animation/index.js";
import { AnimationMixer, Bone } from "@small-world-machine/engine/core/animation/index.js";
import { GltfLoader } from "@small-world-machine/engine/loaders/GltfLoader.js";
import { MathPool, Object3D } from "@small-world-machine/engine";
import type { PointLight, StageMovementBehavior } from "@small-world-machine/engine";
import type { InputInterface } from "@small-world-machine/engine/core/input/Input.js";
import { BunkerKit } from "../../builder/BunkerKit.js";

/** Player character skins available in the-whisper's player showcases. */
export type PlayerRigType = "male" | "female" | "yoshi";

/** A character skin variant: its GLB path and the per-scene world scale (the diorama's real-3D
 *  floor and the tunnel's 2.5D stage use different heights, so scale stays scene-owned). */
export interface PlayerCharacterSpec {
  readonly url: string;
  readonly scale: number;
}

/** Prioritized candidate bones for left-hand lantern attachment across different rigs -- the
 *  canonical list both player showcases previously copy/pasted (agreed in
 *  `.agents/collaborate/lantern.md`'s consensus proposal): first the finger bones (grip center in
 *  palm), then wrist bones (Mixamo fallback), then the Tripo/Yoshi arm bones. */
const LANTERN_HAND_BONE_CANDIDATES: readonly string[] = [
  // 1. Finger bones (grip center in palm / fingers)
  "mixamorig:LeftHandMiddle1",
  "mixamorig1:LeftHandMiddle1",
  "mixamorig:LeftHandIndex1",
  "mixamorig1:LeftHandIndex1",
  // 2. Wrist bones (Mixamo fallback)
  "mixamorig:LeftHand",
  "mixamorig1:LeftHand",
  "L_Hand",
  // 3. Tripo / Yoshi bones
  "tripo::0_Left_Limb_2",
  "tripo::0_Left_Limb_3",
];

/**
 * THE canonical animation-clip table for the-whisper's player rigs. The two showcases previously
 * drifted: character-diorama played `walk_torch.glb`, flakturm-tunnel `walking_torch.glb`.
 * Both files are byte-for-byte identical (SHA-1 `5c52989f0f2f9836882cc7a646846f7be231f490`), so
 * there is no per-scene clip to preserve -- one table serves every scene with identical visuals.
 * The `walk_torch` KEY is what the scenes' animation logic references (both already used it), so
 * no scene code other than the URL mapping changes.
 */
const ANIMATION_CLIP_URLS: Readonly<Record<string, string>> = {
  // Idle variations
  idle_1: "/assets/the-whisper/mannequin/shared/anim/idle_1.glb",
  idle_2: "/assets/the-whisper/mannequin/shared/anim/idle_2.glb",
  idle_torch: "/assets/the-whisper/mannequin/shared/anim/idle_torch.glb",
  // Walk & Run (neutral)
  walk: "/assets/the-whisper/mannequin/shared/anim/walking.glb",
  run_1: "/assets/the-whisper/mannequin/shared/anim/running_1.glb",
  run_2: "/assets/the-whisper/mannequin/shared/anim/running_2.glb",
  // Walk & Run (with lantern / torch)
  walk_torch: "/assets/the-whisper/mannequin/shared/anim/walking_torch.glb",
  run_torch: "/assets/the-whisper/mannequin/shared/anim/running_torch.glb",
  // Stairs -- there is no usable descending clip (see the-whisper docs/log.md #147): the neutral
  // walk loops cleanly and the stairs geometry supplies the height drop.
  stairs_up: "/assets/the-whisper/mannequin/shared/anim/ascending_stairs.glb",
  stairs_down: "/assets/the-whisper/mannequin/shared/anim/walking.glb",
};

/** Asset-loading seam so unit tests can inject fake character/clip loads. */
export interface PlayerRigLoader {
  loadCharacter(url: string): Promise<Object3D>;
  loadAnimations(url: string): Promise<readonly AnimationClip[]>;
}

/** Real loader backed by the engine's GltfLoader. */
class GltfPlayerRigLoader implements PlayerRigLoader {
  private readonly _gltfLoader: GltfLoader = new GltfLoader();

  public async loadCharacter(url: string): Promise<Object3D> {
    return this._gltfLoader.load(url);
  }

  public async loadAnimations(url: string): Promise<readonly AnimationClip[]> {
    return this._gltfLoader.loadAnimations(url);
  }
}

/** Per-scene configuration for a PlayerRig. All scene-specific differences stay here. */
export interface PlayerRigOptions {
  /** Scene node that owns the rig (`scene` for the tunnel, the diorama root for the diorama).
   *  The rig object is added under this node. */
  readonly parent: Object3D;
  /** The TRUE top-level scene root (identity transform). The lantern MUST be parented here -- its
   *  per-frame sync assigns a world position, which is only correct under an identity parent (a
   *  rotated/scaled intermediate such as the diorama's turntable root would drift it, the exact
   *  bug this convention encodes). */
  readonly lanternParent: Object3D;
  /** Input source forwarded into every StageMovementBehavior. */
  readonly input: InputInterface;
  /** Per-skin GLB URLs and scene scales. */
  readonly characters: Readonly<Record<PlayerRigType, PlayerCharacterSpec>>;
  /** Stage coordinates used when no previous StageMovementBehavior exists (first load only). */
  readonly defaultStartUV: Readonly<{ u: number; v: number }>;
  /** Builds the scene-specific StageMovementBehavior (zones, projection, callbacks). Called on
   *  EVERY switch with the preserved (u,v) stage position. PlayerRig removes the previous
   *  behavior from the rig before adding the new one (both showcases relied on that fix). */
  readonly createMovementBehavior: (
    startUv: Readonly<{ u: number; v: number }>,
  ) => StageMovementBehavior;
  /** Post-load material pass for a matte cloth-and-skin look; differs per scene. */
  readonly adjustMaterials: (player: Object3D) => void;
  /** Optional scene-owned point light attached inside the lantern group (moves with the hand).
   *  Its world position is repurposed to the lantern-local (0, -0.16, 0) at attach time -- the
   *  same spot both showcases already placed it. */
  readonly lanternLight?: PointLight;
  /** Called once after every successful character switch; the scene resets its HUD and picks the
   *  starting animation here. Runs with the new character fully in place, after the clips pool was
   *  loaded -- a throw here rejects the switch promise (the scene catches it at its key handler). */
  readonly onCharacterReady?: (type: PlayerRigType) => void;
  /** Asset loader seam (tests inject a fake); defaults to a GltfLoader-backed loader. */
  readonly loader?: PlayerRigLoader;
}

interface RigFade {
  from: AnimationAction | undefined;
  to: AnimationAction;
  elapsed: number;
  duration: number;
}

/**
 * Player-character rig owning everything the two the-whisper player showcases duplicated:
 *
 * 1. Character GLB loading (with fail-fast error propagation and a re-entrancy guard, so a fast
 *    double `C` never spawns two players and the rig stays in its previous valid state when a
 *    load fails).
 * 2. ONE animation-clip pool loaded once with `Promise.all` and reused across character switches
 *    (before, every switch re-fetched ~10 clips sequentially, and failures were swallowed).
 * 3. Crossfade playback (`play(name, { loop, fadeSeconds })` + `update(dt)`).
 * 4. Lantern attach: hand-bone lookup via the canonical candidate list, and a zero-allocation
 *    per-frame world-position sync via `MathPool` scratch vectors.
 * 5. The engine-facing rotation convention (`facingOffset = Math.PI` is supplied by each scene's
 *    movement factory; `root.rotation.y` is the only axis the rig/behavior ever writes).
 * 6. StageMovementBehavior re-attach: the previous behavior is removed before the new one is
 *    added, preserving the walkable (u,v) position across a switch.
 *
 * Scenes keep calling `update(dt)` (drives the fade, the mixer and the lantern sync) and
 * `switchCharacter(...)`; all other player plumbing lives here.
 */
export class PlayerRig {
  /** The rig node; scenes may read/write `rotation.y` (e.g. manual SHIFT+arrow rotation). */
  public readonly root: Object3D;

  private readonly _options: PlayerRigOptions;
  private readonly _loader: PlayerRigLoader;

  private _currentType: PlayerRigType = "male";
  private _player: Object3D | undefined;
  private _mixer: AnimationMixer | undefined;
  private _clips: Map<string, AnimationClip> = new Map();
  private _activeAnimation: string | undefined;
  private _fade: RigFade | undefined;
  private _movementBehavior: StageMovementBehavior | undefined;

  private _lantern: Object3D | undefined;
  private _lanternHandBone: Bone | undefined;
  private _lanternOn: boolean = true;

  private _clipPoolPromise: Promise<ReadonlyMap<string, AnimationClip>> | undefined;
  private _switchInFlight: Promise<void> | undefined;

  constructor(options: PlayerRigOptions) {
    this._options = options;
    this._loader = options.loader ?? new GltfPlayerRigLoader();
    this.root = new Object3D("PlayerRig");
    options.parent.add(this.root);
  }

  /** The currently loaded character skin. */
  public get currentType(): PlayerRigType {
    return this._currentType;
  }

  /** The currently crossfaded animation clip name (undefined before any play). */
  public get activeAnimation(): string | undefined {
    return this._activeAnimation;
  }

  /** The loaded clip pool (read-only view for the scenes' HUD/debug readouts). */
  public get clips(): ReadonlyMap<string, AnimationClip> {
    return this._clips;
  }

  /** The active AnimationMixer (created per loaded character) or undefined. */
  public get mixer(): AnimationMixer | undefined {
    return this._mixer;
  }

  /** The currently attached StageMovementBehavior, or undefined on the very first load. */
  public get movementBehavior(): StageMovementBehavior | undefined {
    return this._movementBehavior;
  }

  /** Whether the lantern is currently shown (also drives the attached point light). */
  public get lanternEnabled(): boolean {
    return this._lanternOn;
  }

  /** The lantern group (only exists once a hand bone was found), or undefined. */
  public get lantern(): Object3D | undefined {
    return this._lantern;
  }

  /**
   * Switches to the given character skin. Re-entrancy guarded: a second call while a switch is in
   * flight returns the SAME in-flight promise (a fast double `C` can never create two players).
   * Errors propagate to the caller (a failed clip-pool or character load THROWS -- the scene's key
   * handler logs it once, see the showcases) and the rig stays in its previous valid state because
   * nothing is mutated until every async load has succeeded.
   */
  public switchCharacter(type: PlayerRigType): Promise<void> {
    if (this._switchInFlight) return this._switchInFlight;
    this._switchInFlight = this._performSwitch(type).finally(() => {
      this._switchInFlight = undefined;
    });
    return this._switchInFlight;
  }

  /** Crossfades to the named clip. No-op if the clip isn't loaded or is already active. */
  public play(name: string, options: { loop?: boolean; fadeSeconds?: number } = {}): void {
    if (!this._mixer || name === this._activeAnimation) return;
    const clip = this._clips.get(name);
    if (!clip) return;

    // A fade already in flight gets cut short here -- its `from` is dropped from tracking below,
    // so it must be stopped now or it would keep blending forever at its last, stale weight.
    if (this._fade?.from) this._fade.from.stop();

    const fromAction =
      this._activeAnimation !== undefined
        ? this._mixer.clipAction(this._clips.get(this._activeAnimation)!)
        : undefined;
    const toAction = this._mixer.clipAction(clip);
    toAction.setLoop(options.loop ?? true);
    toAction.weight = 0;
    toAction.reset();
    toAction.play();

    this._fade = {
      from: fromAction,
      to: toAction,
      elapsed: 0,
      duration: Math.max(0, options.fadeSeconds ?? 0.25),
    };
    this._activeAnimation = name;
  }

  /** Advances the crossfade, animates the active player and re-locks the lantern to the hand bone. */
  public update(deltaTime: number): void {
    this._advanceFade(deltaTime);
    if (this._mixer) this._mixer.update(deltaTime);
    this._syncLantern();
  }

  /** Shows/hides the lantern mesh and its attached point light. */
  public setLanternEnabled(enabled: boolean): void {
    this._lanternOn = enabled;
    this._applyLanternState();
  }

  private async _performSwitch(type: PlayerRigType): Promise<void> {
    const spec = this._options.characters[type];
    if (!spec) throw new Error(`[PlayerRig] Unknown character type "${String(type)}".`);

    // Load the clip pool (once) and the character BEFORE touching any live state -- any failure
    // throws out of here and leaves the rig exactly where it was.
    const clips = await this._ensureClipPool();
    const player = await this._loader.loadCharacter(spec.url);
    player.scale.set(spec.scale, spec.scale, spec.scale);
    this._options.adjustMaterials(player);

    const handBone: Bone | undefined = PlayerRig._resolveHandBone(player);
    if (handBone) this._ensureLantern();

    // --- swap: everything below is synchronous and only runs after all loads succeeded ---
    const rig = this.root;
    const prevUv = this._movementBehavior?.uv ?? { ...this._options.defaultStartUV };
    const newBehavior = this._options.createMovementBehavior(prevUv); // may throw; still pre-mutation

    if (this._player) rig.remove(this._player);
    if (this._movementBehavior) rig.removeBehavior(this._movementBehavior);

    this._player = player;
    rig.add(player);
    this._movementBehavior = newBehavior;
    rig.addBehavior(newBehavior);

    this._clips = new Map(clips);
    this._mixer = new AnimationMixer(player);
    this._fade = undefined;
    this._activeAnimation = undefined;
    this._lanternHandBone = handBone;
    this._currentType = type;

    if (handBone) this._applyLanternState();
    this._options.onCharacterReady?.(type);
  }

  /** Loads and returns the shared clip pool exactly once; subsequent calls await the same promise. */
  private _ensureClipPool(): Promise<ReadonlyMap<string, AnimationClip>> {
    if (!this._clipPoolPromise) {
      this._clipPoolPromise = this._loadClipPool();
    }
    return this._clipPoolPromise;
  }

  private async _loadClipPool(): Promise<ReadonlyMap<string, AnimationClip>> {
    const loader = this._loader;
    const entries = Object.entries(ANIMATION_CLIP_URLS);
    const results = await Promise.all(
      entries.map(async ([name, url]): Promise<[string, AnimationClip]> => {
        const clips = await loader.loadAnimations(url);
        const clip = clips[0];
        if (!clip) {
          throw new Error(`[PlayerRig] Animation clip "${name}" at ${url} contains no animation.`);
        }
        // Strip the Mixamo root-motion track once, at load time -- see the class doc comment.
        // StageMovementBehavior positions the rig; letting the Hips translation through would
        // fight that positioning with a per-frame drift and a loop-boundary snap.
        clip.tracks = clip.tracks.filter((track) => {
          return !(track.targetName.includes("Hips") && track.property === "translation");
        });
        return [name, clip];
      }),
    );
    return new Map(results);
  }

  private static _resolveHandBone(character: Object3D): Bone | undefined {
    for (const boneName of LANTERN_HAND_BONE_CANDIDATES) {
      const found = character.getObjectByName(boneName);
      if (found instanceof Bone) return found;
    }
    return undefined;
  }

  /** Creates the shared lantern (via BunkerKit, the single implementation both scenes use) exactly
   *  once, attaches the scene's point light into it and parents it under the identity scene root. */
  private _ensureLantern(): void {
    if (this._lantern) return;
    const lantern = BunkerKit.createHeldLantern({ name: "LanternPlaceholder" });
    if (this._options.lanternLight) {
      this._options.lanternLight.position.set(0, -0.16, 0);
      lantern.add(this._options.lanternLight);
    }
    this._options.lanternParent.add(lantern);
    this._lantern = lantern;
  }

  private _applyLanternState(): void {
    if (!this._lantern) return;
    this._lantern.isVisible = this._lanternOn;
    if (this._options.lanternLight) this._options.lanternLight.isVisible = this._lanternOn;
  }

  private _advanceFade(deltaTime: number): void {
    const fade = this._fade;
    if (!fade) return;

    if (fade.duration <= 0) {
      fade.to.weight = 1;
      if (fade.from) fade.from.stop();
      this._fade = undefined;
      return;
    }

    fade.elapsed += deltaTime;
    const t = Math.min(1, fade.elapsed / fade.duration);
    fade.to.weight = t;
    if (fade.from) fade.from.weight = 1 - t;

    if (t >= 1) {
      if (fade.from) fade.from.stop();
      this._fade = undefined;
    }
  }

  /** Keeps the lantern's world POSITION locked to the hand bone's grip point every frame, via a
   *  bone-local offset transformed through the bone's full world matrix (rotation included) --
   *  this stays correct through character rotation/scale, unlike a raw world-space additive
   *  offset. Never touches `lantern.rotation` (left at the identity BunkerKit sets), so it always
   *  hangs straight down instead of tumbling with the hand.
   *
   *  Mixamo-rigged hand bones (player-male/player-female) carry a large accumulated world-space
   *  scale (~94x, a leftover cm-to-m FBX unit conversion baked into the skeleton -- see
   *  `Bone.getAccumulatedWorldScale()`). `worldMatrix.transformVector()` applies that scale to the
   *  local offset too, so a naive physically-small offset (0.01) explodes into a ~0.9 unit
   *  position error. Dividing the local offset by that scale before transforming cancels it back
   *  out (matrix = T·R·S, so feeding `offset / S` yields `T + R·offset`, the correctly-rotated but
   *  unscaled result).
   *
   *  Yoshi (an Easter-egg asset, auto-rigged by Mixamo) uses this exact same path, resolving to
   *  `mixamorig:LeftHandIndex1` like the humans; his bone scale is already ~1, so the `/ boneScale`
   *  division is a no-op, not a special case (see the-whisper docs/log.md #77).
   *
   *  Hot path is zero-allocation: both vectors come from `MathPool` and are returned after use.
   */
  private _syncLantern(): void {
    const lantern = this._lantern;
    if (!lantern || !this._player) return;
    const bone = this._lanternHandBone;
    if (!bone) return;

    // Finger bones (Middle1/Index1) have their origin at the finger base inside the palm already;
    // wrist bones (LeftHand) need a forward offset along +Y to reach the palm.
    const isFingerBone =
      bone.name.includes("Middle") || bone.name.includes("Index") || bone.name.includes("Limb_3");
    const boneScale = bone.getAccumulatedWorldScale();
    const localOffset = MathPool.acquireVector().set(
      0,
      (isFingerBone ? 0.01 : 0.08) / boneScale,
      (isFingerBone ? 0.0 : 0.01) / boneScale,
    );

    const worldPos = MathPool.acquireVector();
    bone.worldMatrix.transformVector(localOffset, worldPos);

    lantern.position.copyFrom(worldPos);
    lantern.updateMatrixWorld();

    MathPool.releaseVector(localOffset);
    MathPool.releaseVector(worldPos);
  }
}
