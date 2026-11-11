/// <reference types="vite/client" />
import type { AnimationAction, AnimationClip } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  AnimationMixer,
  BasicMaterial,
  CameraStrategyType,
  Color,
  Cube,
  DirectionalLight,
  GltfLoader,
  Keys,
  MathUtils,
  Object3D,
  StandardMaterial,
  Texture,
  TextureFilter,
  ToneMappingMode,
  Vector3D,
  defineShowcaseParams,
  readShowcaseParams,
} from "@small-world-machine/engine";

/** Placement of the player character model inside the 1x1 collision box. */
interface CharacterPlacement {
  /** Uniform base scale (the static fallback adds a duck squash on top). */
  readonly scale: number;
  /** Vertical offset so the feet sit on the bottom of the collision box. */
  readonly offsetY: number;
}

const DEFAULT_CHARACTER_URL = "./assets/character.glb";
const DEFAULT_CHARACTER_PLACEMENT: CharacterPlacement = { scale: 1.2, offsetY: -0.5 };

/**
 * Optional local character override (dev only): drop `character.glb` (+ optional
 * `character.json` with `{ "scale": number, "offsetY": number }`) into the git-ignored
 * `assets/local/` folder. Resolved at build time via `import.meta.glob`, so a clone without the
 * folder issues no request and logs nothing.
 */
const LOCAL_CHARACTER_URLS = import.meta.glob<string>("./assets/local/character.glb", {
  query: "?url",
  import: "default",
  eager: true,
});
const LOCAL_CHARACTER_PLACEMENTS = import.meta.glob<Partial<CharacterPlacement>>(
  "./assets/local/character.json",
  { import: "default", eager: true },
);

function resolveCharacter(): { readonly url: string; readonly placement: CharacterPlacement } {
  const localUrl = Object.values(LOCAL_CHARACTER_URLS)[0];
  if (localUrl === undefined) {
    return { url: DEFAULT_CHARACTER_URL, placement: DEFAULT_CHARACTER_PLACEMENT };
  }
  const local = Object.values(LOCAL_CHARACTER_PLACEMENTS)[0] ?? {};
  return { url: localUrl, placement: { ...DEFAULT_CHARACTER_PLACEMENT, ...local } };
}

/**
 * Skeletal locomotion states, one looping Mixamo clip each (rotation tracks drive the pose).
 * Hips translation is stripped from every clip, so the hips keep their standing height; `drop`
 * (fraction of character height, measured from the clip's hips track) lowers the whole model
 * instead, which keeps the feet on the ground for any character size.
 */
const LOCOMOTION_CLIPS = [
  { state: "idle", url: "./assets/idle.glb", drop: 0 },
  { state: "run", url: "./assets/running.glb", drop: 0 },
  { state: "jump", url: "./assets/jump.glb", drop: 0 },
  { state: "crouch", url: "./assets/crouch.glb", drop: 0.145 },
  { state: "crouchWalk", url: "./assets/crouch-walk.glb", drop: 0.067 },
  { state: "crawl", url: "./assets/crawl.glb", drop: 0.122 },
  { state: "slide", url: "./assets/slide.glb", drop: 0.11 },
] as const;

type LocomotionState = (typeof LOCOMOTION_CLIPS)[number]["state"];

interface StaticBlockAABB {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Showcase 9: A classic 2.5D Jump & Run with pure code physics and collision!
 */
/** URL parameters (`?help` prints them). */
const PARAMS = defineShowcaseParams({
  spawnX: { type: "int", default: 2, min: 1, doc: "spawn/respawn column (level-design testing)" },
});

export class Showcase extends AbstractShowcase {
  protected override defaultCameraController = "none" as const;

  private _player!: Object3D;
  private _characterModel?: Object3D;
  private _mixer?: AnimationMixer;
  /** Indexed like `LOCOMOTION_CLIPS`; `undefined` where a clip failed to load. */
  private readonly _actions: (AnimationAction | undefined)[] = [];
  private _locomotion: LocomotionState = "idle";
  private _facingRight: boolean = true;
  private _characterBaseScale: number = DEFAULT_CHARACTER_PLACEMENT.scale;
  private _characterOffsetY: number = DEFAULT_CHARACTER_PLACEMENT.offsetY;
  /** Smoothed model drop (fraction of character height) of the current ducking clip. */
  private _duckDrop: number = 0;
  private readonly _camTarget: Vector3D = new Vector3D(2, 2.8, 0);

  private readonly _blocks: Object3D[] = [];
  private readonly _staticBlockBounds: StaticBlockAABB[] = [];

  // Physics & Movement
  private _velocity: Vector3D = new Vector3D();
  private _gravity: number = -25.0;
  private _jumpForce: number = 12.0;
  private readonly _jogSpeed: number = 5.5;
  private readonly _sprintSpeed: number = 8.0;
  private _moveSpeed: number = 5.5;
  private _isGrounded: boolean = false;

  // Procedural Animation & Ducking State
  private _isDucking: boolean = false;
  /** Spawn/respawn column; `?spawnX=<column>` starts mid-level (level-design testing). */
  private readonly _spawnX: number = readShowcaseParams(PARAMS).values.spawnX;
  /** Ducked at speed: momentum carries the player until it decays to crawl speed. */
  private _isSliding: boolean = false;
  private _duckAmount: number = 0;

  // The Level Map (1-3 = blocks with different textures, 4 = low ceiling slab, 0 = air)
  // Expansive 200-block stage across 10 diverse platforming zones
  private _levelMap: number[][] = Showcase._createLevelMap();

  private static _createLevelMap(): number[][] {
    const s0: number[][] = [
      // 0..19: Tutorial & Plains Intro
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 3, 3, 3],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 3, 2, 3, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0],
      [1, 0, 0, 2, 3, 0, 0, 0, 3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ];

    const s1: number[][] = [
      // 20..39: Twin Bridges & Low Hurdles
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 2, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 1, 1, 1, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1],
    ];

    const s2: number[][] = [
      // 40..59: Step Pyramids & Elevated Route
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 2, 3, 2, 0],
      [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ];

    const s3: number[][] = [
      // 60..79: Floating Islands & Gap Crossing
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 1, 1, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
    ];

    const s4: number[][] = [
      // 80..99: Pillar Gauntlet
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 3, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 2, 2, 0, 0, 1, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ];

    const s5: number[][] = [
      // 100..119: The Double Decker Highway
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 2, 3, 2, 0, 0, 0, 0, 2, 3, 2, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ];

    const s6: number[][] = [
      // 120..139: Chasm Jumps & Floating Steps
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 3, 3, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1],
    ];

    const s7: number[][] = [
      // 140..159: Wave Platformer
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0, 3, 3, 3, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 2, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ];

    const s8: number[][] = [
      // 160..179: Sprint & High Ramps, then a crawl tunnel (slide in at sprint speed)
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 3, 3, 3, 3, 0, 0],
      [0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ];

    const s9: number[][] = [
      // 180..199: Final Staircase & Goal Castle
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1],
      [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1],
      [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 2, 2, 0, 0, 1],
      [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ];

    const sections = [s0, s1, s2, s3, s4, s5, s6, s7, s8, s9];
    const fullMap: number[][] = [];
    for (let r = 0; r < 8; r++) {
      const row: number[] = [];
      for (const s of sections) {
        row.push(...s[r]!);
      }
      fullMap.push(row);
    }
    return fullMap;
  }

  protected override async setupScene(): Promise<void> {
    this.input.debug = true;
    this.renderer.setClearColor(new Color(0.5, 0.7, 1.0));

    // 1. Camera Setup - Classic 2.5D Side-Scroller Perspective
    this.defaultFov = MathUtils.degToRad(52);
    this.configureCamera();

    this.camera.setStrategy(CameraStrategyType.MANUAL);
    this._camTarget.set(this._spawnX, 2.8, 0);
    this.camera.target.copyFrom(this._camTarget);

    const pitch = MathUtils.degToRad(5.0);
    const distance = 13.5;
    this.camera.position.set(
      this._camTarget.x,
      this._camTarget.y + distance * Math.sin(pitch),
      distance * Math.cos(pitch),
    );

    // 2. Lights
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.85 }));
    const sun = new DirectionalLight({ color: Color.WHITE, intensity: 1.3 });
    sun.direction.set(0.4, -0.7, -1).normalize();

    // Linear forward tone curve: the default Reinhard halves and desaturates the character's
    // saturated albedo (orange -> brown). No post pass needed; blocks are unlit either way.
    this.renderer.quality.toneMapping = ToneMappingMode.NONE;
    this.scene.add(sun);

    // 3. Texturen laden (Kenney "Pixel Platformer" + "Pixel Platformer Blocks", CC0; 18 px tiles
    // upscaled x4 as lossless WebP, sampled with NEAREST)
    const loadPixelTexture = async (url: string): Promise<Texture> => {
      const tex = await Texture.fromUrl(url);
      tex.magFilter = TextureFilter.NEAREST;
      tex.minFilter = TextureFilter.NEAREST;
      return tex;
    };

    const groundTopTex = await loadPixelTexture("./assets/ground-top.webp");
    const groundTex = await loadPixelTexture("./assets/ground.webp");
    const exclaimTex = await loadPixelTexture("./assets/block-exclaim.webp");
    const brickTex = await loadPixelTexture("./assets/block-brick.webp");

    // Flat, unlit pixel-art look: BasicMaterial ignores scene lights and reproduces the
    // textures 1:1 on every renderer tier.
    const createBlockMaterial = (diffuseMap: Texture): BasicMaterial =>
      new BasicMaterial({ color: Color.WHITE, diffuseMap });

    const groundTopMat = createBlockMaterial(groundTopTex);
    const groundMat = createBlockMaterial(groundTex);
    const exclaimMat = createBlockMaterial(exclaimTex);
    const brickMat = createBlockMaterial(brickTex);

    // Exposed ground = grass-edge body + thin flat grass slab. Engine limits: one material per
    // Object3D, cube faces map full UVs -- the grass-edge tile would otherwise repeat on the
    // top face. ground-top.webp is cropped to 15 of 18 tile rows to match the body height.
    const blockBodyHeight = 0.85;
    const topSlabHeight = 1 - blockBodyHeight;
    const grassSlabMat = new BasicMaterial({
      color: new Color(0x36 / 255, 0xe3 / 255, 0x77 / 255),
    });

    // Low ceiling slab: hangs below a block so the 1.0-high player only passes ducked (top at
    // +0.04 above the box center); the gap underneath stays inside the head zone (+0.05..+0.5).
    const lowCeilingHeight = 0.4;

    // 4. Level aufbauen
    const blockGeo = new Cube({ size: 1 }).getGeometryData();

    const rows = this._levelMap.length;
    const cols = this._levelMap[0]!.length;

    const addBlockPart = (
      name: string,
      x: number,
      centerY: number,
      height: number,
      mat: BasicMaterial,
    ): void => {
      const part = new Object3D(name);
      part.geometry = blockGeo;
      part.material = mat;
      part.scale.set(1, height, 1);
      part.position.set(x, centerY, 0);
      this.scene.add(part);
      this._blocks.push(part);
    };

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cellType = this._levelMap[y]![x];
        if (cellType === undefined || cellType <= 0) continue;

        const blockY = rows - y - 1;
        // Exposed when no block covers this cell from above (world space)
        // (a low ceiling slab hangs in the upper part of its cell and leaves the top exposed)
        const above = y === 0 ? 0 : this._levelMap[y - 1]![x];
        const topExposed = above === 0 || above === 4;

        if (cellType === 1 && topExposed) {
          const bodyY = blockY - topSlabHeight / 2;
          addBlockPart(`Ground_${x}_${blockY}`, x, bodyY, blockBodyHeight, groundTopMat);
          const slabY = blockY + 0.5 - topSlabHeight / 2;
          addBlockPart(`GroundTop_${x}_${blockY}`, x, slabY, topSlabHeight, grassSlabMat);
        } else if (cellType === 1) {
          addBlockPart(`Ground_${x}_${blockY}`, x, blockY, 1, groundMat);
        } else if (cellType === 2) {
          // Bevelled tiles read as solid 3D blocks, so the face may repeat on the top.
          addBlockPart(`Exclaim_${x}_${blockY}`, x, blockY, 1, exclaimMat);
        } else if (cellType === 3) {
          addBlockPart(`Brick_${x}_${blockY}`, x, blockY, 1, brickMat);
        } else if (cellType === 4) {
          const slabY = blockY + 0.5 - lowCeilingHeight / 2;
          addBlockPart(`LowCeiling_${x}_${blockY}`, x, slabY, lowCeilingHeight, brickMat);
        }

        // Precompute static collision bounds once (Zero-GC in frame-loop)
        this._staticBlockBounds.push({
          minX: x - 0.5,
          maxX: x + 0.5,
          minY: cellType === 4 ? blockY + 0.5 - lowCeilingHeight : blockY - 0.5,
          maxY: blockY + 0.5,
        });
      }
    }

    // 5. Spieler & Charakter-Modell laden
    this._player = new Object3D("Player");
    this._player.position.set(this._spawnX, 1.001, 0); // Start grounded on the ground row
    this.scene.add(this._player);
    this._isGrounded = true;

    const gltfLoader = new GltfLoader();
    try {
      const { url, placement } = resolveCharacter();
      const character = await gltfLoader.load(url);
      character.name = "Character";
      this._characterBaseScale = placement.scale;
      this._characterOffsetY = placement.offsetY;
      character.scale.set(placement.scale, placement.scale, placement.scale);
      // Offset so the feet align precisely with the bottom of the 1x1 collision box
      character.position.set(0, placement.offsetY, 0);
      character.rotation.y = MathUtils.HALF_PI; // Default facing right (+X)

      // Matte finish matching classic vinyl figurine aesthetics
      const setupMatteMaterials = (node: Object3D): void => {
        if (node.material && node.material instanceof StandardMaterial) {
          node.material.roughness = 0.88;
          node.material.metallic = 0.05;
        }
        for (const child of node.children) {
          setupMatteMaterials(child);
        }
      };
      setupMatteMaterials(character);

      this._characterModel = character;
      this._player.add(character);

      // Skeletal animations
      try {
        const clipSets = await Promise.all(
          LOCOMOTION_CLIPS.map((entry) => gltfLoader.loadAnimations(entry.url)),
        );

        const stripHipsTranslation = (clip: AnimationClip): void => {
          clip.tracks = clip.tracks.filter(
            (track) => !(track.targetName.includes("Hips") && track.property === "translation"),
          );
        };

        const mixer = new AnimationMixer(character);
        this._mixer = mixer;
        clipSets.forEach((clips, i) => {
          const clip = clips[0];
          if (!clip) return;
          stripHipsTranslation(clip);
          const action = mixer.clipAction(clip);
          action.weight = LOCOMOTION_CLIPS[i]!.state === "idle" ? 1 : 0;
          action.play();
          this._actions[i] = action;
        });
      } catch (animErr) {
        console.warn(
          "[Showcase 9] Animation clips could not be loaded, using static pose:",
          animErr,
        );
      }
    } catch (err) {
      console.error("[Showcase 9] Failed to load the character:", err);
      // Honest Fallback: Visible green avatar cube so the game remains 100% playable
      const fallbackMat = new BasicMaterial({ color: new Color(0.2, 0.85, 0.3) });
      const fallbackMesh = new Object3D("PlayerFallback");
      fallbackMesh.geometry = new Cube({ size: 1.0 }).getGeometryData();
      fallbackMesh.material = fallbackMat;
      this._characterModel = fallbackMesh;
      this._player.add(fallbackMesh);
    }
  }

  /**
   * Frame-rate independent exponential smoothing factor.
   * Equivalent to exponential decay towards target: val += (target - val) * factor.
   */
  private _expDecay(rate: number, deltaTime: number): number {
    return 1.0 - Math.exp(-rate * deltaTime);
  }

  protected override update(deltaTime: number): void {
    // --- 1. DUCKING & HORIZONTALE BEWEGUNG (X) ---
    const wantsDuck = this.input.isPressed(Keys.S) || this.input.isPressed(Keys.DOWN);

    // Head clearance: blocks inside the standing head zone keep the player ducked (no stand-up
    // under low ceilings) and switch ducked movement from crouch-walk to crawl.
    let headBlocked = false;
    if (wantsDuck || this._isDucking) {
      const headMinX = this._player.position.x - 0.45;
      const headMaxX = this._player.position.x + 0.45;
      const headMinY = this._player.position.y + 0.05;
      const headMaxY = this._player.position.y + 0.5;
      for (let i = 0; i < this._staticBlockBounds.length; i++) {
        const b = this._staticBlockBounds[i]!;
        if (headMinX <= b.maxX && headMaxX >= b.minX && headMinY <= b.maxY && headMaxY >= b.minY) {
          headBlocked = true;
          break;
        }
      }
    }
    const wasDucking = this._isDucking;
    this._isDucking = wantsDuck || (this._isDucking && headBlocked);

    // Ducking at speed starts a slide that keeps the momentum (any direction input is ignored).
    const crawlSpeed = 2.2;
    if (
      this._isDucking &&
      !wasDucking &&
      this._isGrounded &&
      Math.abs(this._velocity.x) > crawlSpeed + 1.0
    ) {
      this._isSliding = true;
    }
    if (!this._isDucking || !this._isGrounded || Math.abs(this._velocity.x) <= crawlSpeed) {
      this._isSliding = false;
    }

    const targetDuck = this._isDucking ? 1.0 : 0.0;
    this._duckAmount += (targetDuck - this._duckAmount) * this._expDecay(18.0, deltaTime);

    const isSprinting = this.input.isPressed(Keys.SHIFT_L) || this.input.isPressed(Keys.SHIFT_R);
    this._moveSpeed = this._isDucking
      ? crawlSpeed
      : isSprinting
        ? this._sprintSpeed
        : this._jogSpeed;

    let inputX = 0;
    if (this.input.isPressed(Keys.A) || this.input.isPressed(Keys.LEFT)) inputX = -1;
    if (this.input.isPressed(Keys.D) || this.input.isPressed(Keys.RIGHT)) inputX = 1;
    if (inputX !== 0 && !this._isSliding) this._facingRight = inputX > 0;

    if (this._isSliding) {
      this._velocity.x += (0 - this._velocity.x) * this._expDecay(1.1, deltaTime);
    } else if (inputX !== 0) {
      this._velocity.x = inputX * this._moveSpeed;
    } else if (this._isDucking && this._isGrounded) {
      // Crouch-slide deceleration
      this._velocity.x += (0 - this._velocity.x) * this._expDecay(4.0, deltaTime);
      if (Math.abs(this._velocity.x) < 0.05) this._velocity.x = 0;
    } else {
      this._velocity.x = 0;
    }

    this._player.position.x += this._velocity.x * deltaTime;

    // Horizontale Kollision prüfen & korrigieren (Zero-GC, ohne Objekt-Allokationen)
    const px = this._player.position.x;
    const py = this._player.position.y;
    const currentTop = py + 0.5 - 0.46 * this._duckAmount;
    const pMinX = px - 0.48;
    const pMaxX = px + 0.48;
    const pMinY = py - 0.5;
    const pMaxY = currentTop;

    for (let i = 0; i < this._staticBlockBounds.length; i++) {
      const b = this._staticBlockBounds[i]!;
      if (pMinX <= b.maxX && pMaxX >= b.minX && pMinY <= b.maxY && pMaxY >= b.minY) {
        if (this._velocity.x > 0) {
          this._player.position.x = b.minX - 0.481;
        } else if (this._velocity.x < 0) {
          this._player.position.x = b.maxX + 0.481;
        }
        this._velocity.x = 0;
        break;
      }
    }

    // --- 2. VERTIKALE BEWEGUNG (Y) ---
    const midAirFastFall = !this._isGrounded && wantsDuck;
    const effectiveGravity = midAirFastFall ? this._gravity * 1.5 : this._gravity;
    this._velocity.y += effectiveGravity * deltaTime;

    if (
      this._isGrounded &&
      (this.input.isPressed(Keys.SPACE) ||
        this.input.isPressed(Keys.W) ||
        this.input.isPressed(Keys.UP))
    ) {
      this._velocity.y = this._jumpForce;
      this._isGrounded = false;
    }

    this._player.position.y += this._velocity.y * deltaTime;

    // Vertikale Kollision prüfen & korrigieren (Zero-GC, ohne Objekt-Allokationen)
    this._isGrounded = false;
    const curPx = this._player.position.x;
    const curPy = this._player.position.y;
    const curTop = curPy + 0.5 - 0.46 * this._duckAmount;
    const curPMinX = curPx - 0.48;
    const curPMaxX = curPx + 0.48;
    const curPMinY = curPy - 0.5;
    const curPMaxY = curTop;

    for (let i = 0; i < this._staticBlockBounds.length; i++) {
      const b = this._staticBlockBounds[i]!;
      if (curPMinX <= b.maxX && curPMaxX >= b.minX && curPMinY <= b.maxY && curPMaxY >= b.minY) {
        if (this._velocity.y < 0) {
          this._player.position.y = b.maxY + 0.501;
          this._isGrounded = true;
          this._velocity.y = 0;
        } else if (this._velocity.y > 0) {
          this._player.position.y = b.minY - (0.5 - 0.46 * this._duckAmount) - 0.001;
          this._velocity.y = 0;
        }
      }
    }

    // Death Zone & Respawn
    if (this._player.position.y < -10) {
      this._player.position.set(this._spawnX, 1.001, 0);
      this._velocity.set(0, 0, 0);
      this._isGrounded = true;
      this._isDucking = false;
      this._isSliding = false;
      this._duckAmount = 0;
    }

    // --- 3. CHARAKTER-AUSRICHTUNG & DUCK ---
    if (this._characterModel) {
      // Smooth facing turn with frame-rate independent exponential decay
      const targetRotY = this._facingRight ? MathUtils.HALF_PI : -MathUtils.HALF_PI;
      let diff = targetRotY - this._characterModel.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this._characterModel.rotation.y += diff * this._expDecay(18.0, deltaTime);

      // Dynamic tilt during air flight; ducking poses come from the skeletal clips.
      const skeletal = this._mixer !== undefined;
      const airTilt = this._isGrounded ? 0 : MathUtils.clamp(this._velocity.y * 0.022, -0.22, 0.28);
      const duckTilt =
        !skeletal && this._isDucking && this._isGrounded
          ? (this._facingRight ? 0.14 : -0.14) * (Math.abs(this._velocity.x) > 0.1 ? 1.0 : 0.4)
          : 0;
      const targetTilt = (this._facingRight ? airTilt : -airTilt) + duckTilt;
      this._characterModel.rotation.z +=
        (targetTilt - this._characterModel.rotation.z) * this._expDecay(14.0, deltaTime);

      // The skeletal clips carry jump and duck poses, so a rigged character keeps its base
      // scale; only the static fallback squashes to show the smaller duck hitbox.
      const baseScale = this._characterBaseScale;
      const fallbackDuck = skeletal ? 0 : this._duckAmount;
      const finalScaleY = baseScale * (1.0 - 0.46 * fallbackDuck);
      const finalScaleXZ = baseScale * (1.0 + 0.32 * fallbackDuck);
      this._characterModel.scale.set(finalScaleXZ, finalScaleY, finalScaleXZ);
      // Hips translation is stripped from the clips: lower the model by the clip's hips drop.
      this._characterModel.position.y = this._characterOffsetY - this._duckDrop * finalScaleY;
    }

    if (this._mixer) {
      this._mixer.update(deltaTime);
      const speed = Math.abs(this._velocity.x);
      const isMoving = speed > 0.1 && this._isGrounded;

      let next: LocomotionState;
      if (!this._isGrounded) next = "jump";
      else if (this._isSliding) next = "slide";
      else if (this._isDucking) next = isMoving ? (headBlocked ? "crawl" : "crouchWalk") : "crouch";
      else next = isMoving ? "run" : "idle";

      const blend = this._expDecay(14.0, deltaTime);
      let targetDrop = 0;
      for (let i = 0; i < LOCOMOTION_CLIPS.length; i++) {
        const entry = LOCOMOTION_CLIPS[i]!;
        const action = this._actions[i];
        const active = entry.state === next;
        if (active) targetDrop = entry.drop;
        if (!action) continue;
        if (active && entry.state !== this._locomotion && entry.state === "slide") action.reset();
        action.weight += ((active ? 1 : 0) - action.weight) * blend;
        if (!active) continue;
        if (entry.state === "run") action.timeScale = speed * 0.245;
        else if (entry.state === "crouchWalk" || entry.state === "crawl")
          action.timeScale = speed / 2.2;
        else if (entry.state === "slide") {
          // One-shot: hold the low end pose instead of looping back to the run-in.
          action.timeScale = action.time >= action.clip.duration - 0.05 ? 0 : 1;
        }
      }
      this._locomotion = next;
      this._duckDrop += (targetDrop - this._duckDrop) * blend;
    }

    // --- 4. KLASSISCHE RUN & JUMP KAMERAFÜHRUNG ---
    // Sanfter Vorlauf (Lookahead) in Blickrichtung
    const lookAhead =
      (this._facingRight ? 1.5 : -1.5) * (Math.abs(this._velocity.x) > 0.1 ? 1.0 : 0.4);
    const maxCamX = (this._levelMap[0]?.length ?? 20) - 5.0;
    const desiredTargetX = MathUtils.clamp(this._player.position.x + lookAhead, 4.0, maxCamX);

    // Sanfte vertikale Führung: Horizont bleibt ruhig beim Springen, folgt nur bei erhöhtem Untergrund
    const targetAnchorY = this._isGrounded
      ? this._player.position.y * 0.35 + 2.4
      : this._camTarget.y;
    const desiredTargetY = MathUtils.clamp(targetAnchorY, 2.5, 5.8);

    this._camTarget.x += (desiredTargetX - this._camTarget.x) * this._expDecay(5.0, deltaTime);
    this._camTarget.y += (desiredTargetY - this._camTarget.y) * this._expDecay(3.5, deltaTime);
    this._camTarget.z = 0;

    this.camera.target.copyFrom(this._camTarget);

    const pitch = MathUtils.degToRad(5.0);
    const distance = 13.5;
    this.camera.position.set(
      this._camTarget.x,
      this._camTarget.y + distance * Math.sin(pitch),
      distance * Math.cos(pitch),
    );
  }
}

const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase9] Failed to start:", err));
