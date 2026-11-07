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
  Vector3D,
} from "@small-world-machine/engine";

/** Placement of the player character model inside the 1x1 collision box. */
interface CharacterPlacement {
  /** Uniform base scale (procedural squash/stretch multiplies on top). */
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

interface StaticBlockAABB {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Showcase 9: A classic 2.5D Jump & Run with pure code physics and collision!
 */
export class Showcase extends AbstractShowcase {
  protected override defaultCameraController = "none" as const;

  private _player!: Object3D;
  private _characterModel?: Object3D;
  private _mixer?: AnimationMixer;
  private _runAction?: AnimationAction;
  private _idleAction?: AnimationAction;
  private _jumpAction?: AnimationAction;
  private _crouchAction?: AnimationAction;
  private _crawlAction?: AnimationAction;
  private _facingRight: boolean = true;
  private _characterBaseScale: number = DEFAULT_CHARACTER_PLACEMENT.scale;
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
  private _duckAmount: number = 0;
  private _jumpStretch: number = 0;
  private _prevVelocityY: number = 0;

  // The Level Map (1-3 = blocks with different textures, 0 = air)
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
      // 160..179: Sprint & High Ramps
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
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
    this._camTarget.set(2, 2.8, 0);
    this.camera.target.copyFrom(this._camTarget);

    const pitch = MathUtils.degToRad(5.0);
    const distance = 13.5;
    this.camera.position.set(
      this._camTarget.x,
      this._camTarget.y + distance * Math.sin(pitch),
      distance * Math.cos(pitch),
    );

    // 2. Lights
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.45 }));
    const sun = new DirectionalLight({ color: Color.WHITE, intensity: 0.95 });
    sun.direction.set(0.5, -1, -0.5).normalize();
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
        const topExposed = y === 0 || this._levelMap[y - 1]![x] === 0;

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
        }

        // Precompute static collision bounds once (Zero-GC in frame-loop)
        this._staticBlockBounds.push({
          minX: x - 0.5,
          maxX: x + 0.5,
          minY: blockY - 0.5,
          maxY: blockY + 0.5,
        });
      }
    }

    // 5. Spieler & Charakter-Modell laden
    this._player = new Object3D("Player");
    this._player.position.set(2, 1.001, 0); // Start grounded on the brick platform
    this.scene.add(this._player);
    this._isGrounded = true;

    const gltfLoader = new GltfLoader();
    try {
      const { url, placement } = resolveCharacter();
      const character = await gltfLoader.load(url);
      character.name = "Character";
      this._characterBaseScale = placement.scale;
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
        const [idleClips, runClips, jumpClips, crouchClips, crawlClips] = await Promise.all([
          gltfLoader.loadAnimations("./assets/idle.glb"),
          gltfLoader.loadAnimations("./assets/running.glb"),
          gltfLoader.loadAnimations("./assets/jump.glb"),
          gltfLoader.loadAnimations("./assets/crouch.glb"),
          gltfLoader.loadAnimations("./assets/crawl.glb"),
        ]);

        const stripHipsTranslation = (clip: AnimationClip): void => {
          clip.tracks = clip.tracks.filter(
            (track) => !(track.targetName.includes("Hips") && track.property === "translation"),
          );
        };

        if (idleClips[0]) stripHipsTranslation(idleClips[0]);
        if (runClips[0]) stripHipsTranslation(runClips[0]);
        if (jumpClips[0]) stripHipsTranslation(jumpClips[0]);
        if (crouchClips[0]) stripHipsTranslation(crouchClips[0]);
        if (crawlClips[0]) stripHipsTranslation(crawlClips[0]);

        this._mixer = new AnimationMixer(character);
        if (idleClips[0]) {
          this._idleAction = this._mixer.clipAction(idleClips[0]);
          this._idleAction.play();
        }
        if (runClips[0]) {
          this._runAction = this._mixer.clipAction(runClips[0]);
          this._runAction.weight = 0;
          this._runAction.play();
        }
        if (jumpClips[0]) {
          this._jumpAction = this._mixer.clipAction(jumpClips[0]);
          this._jumpAction.weight = 0;
          this._jumpAction.play();
        }
        if (crouchClips[0]) {
          this._crouchAction = this._mixer.clipAction(crouchClips[0]);
          this._crouchAction.weight = 0;
          this._crouchAction.play();
        }
        if (crawlClips[0]) {
          this._crawlAction = this._mixer.clipAction(crawlClips[0]);
          this._crawlAction.weight = 0;
          this._crawlAction.play();
        }
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

    // Head clearance check when attempting to stand up under low ceilings
    let hasCeilingObstacle = false;
    if (!wantsDuck && this._isDucking) {
      const headMinX = this._player.position.x - 0.45;
      const headMaxX = this._player.position.x + 0.45;
      const headMinY = this._player.position.y + 0.05;
      const headMaxY = this._player.position.y + 0.5;
      for (let i = 0; i < this._staticBlockBounds.length; i++) {
        const b = this._staticBlockBounds[i]!;
        if (headMinX <= b.maxX && headMaxX >= b.minX && headMinY <= b.maxY && headMaxY >= b.minY) {
          hasCeilingObstacle = true;
          break;
        }
      }
    }
    this._isDucking = wantsDuck || hasCeilingObstacle;

    const targetDuck = this._isDucking ? 1.0 : 0.0;
    this._duckAmount += (targetDuck - this._duckAmount) * this._expDecay(18.0, deltaTime);

    const isSprinting = this.input.isPressed(Keys.SHIFT_L) || this.input.isPressed(Keys.SHIFT_R);
    const crawlSpeed = 2.2;
    this._moveSpeed = this._isDucking
      ? crawlSpeed
      : isSprinting
        ? this._sprintSpeed
        : this._jogSpeed;

    let inputX = 0;
    if (this.input.isPressed(Keys.A) || this.input.isPressed(Keys.LEFT)) {
      inputX = -1;
      this._facingRight = false;
    }
    if (this.input.isPressed(Keys.D) || this.input.isPressed(Keys.RIGHT)) {
      inputX = 1;
      this._facingRight = true;
    }

    if (inputX !== 0) {
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

    // --- 2. VERTIKALE BEWEGUNG (Y) & JUMP STRETCH / SQUASH ---
    const wasGrounded = this._isGrounded;
    this._prevVelocityY = this._velocity.y;

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
      this._jumpStretch = 0.42; // Launch stretch
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

    // Landing detection for procedural impact squash
    if (!wasGrounded && this._isGrounded && this._prevVelocityY < -3.0) {
      this._jumpStretch = -MathUtils.clamp(-this._prevVelocityY * 0.022, 0.15, 0.42);
    }

    // Target stretch in air vs grounded
    let targetStretch = 0;
    if (!this._isGrounded) {
      if (midAirFastFall) {
        targetStretch = -0.28;
      } else if (this._velocity.y > 0) {
        targetStretch = MathUtils.clamp(this._velocity.y * 0.026, 0.0, 0.35);
      } else {
        targetStretch = MathUtils.clamp(this._velocity.y * 0.012, -0.15, 0.0);
      }
    }
    this._jumpStretch += (targetStretch - this._jumpStretch) * this._expDecay(14.0, deltaTime);

    // Death Zone & Respawn
    if (this._player.position.y < -10) {
      this._player.position.set(2, 1.001, 0);
      this._velocity.set(0, 0, 0);
      this._isGrounded = true;
      this._isDucking = false;
      this._duckAmount = 0;
      this._jumpStretch = 0;
      this._prevVelocityY = 0;
    }

    // --- 3. CHARAKTER-AUSRICHTUNG, DUCK & SQUASH/STRETCH ---
    if (this._characterModel) {
      // Smooth facing turn with frame-rate independent exponential decay
      const targetRotY = this._facingRight ? MathUtils.HALF_PI : -MathUtils.HALF_PI;
      let diff = targetRotY - this._characterModel.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this._characterModel.rotation.y += diff * this._expDecay(18.0, deltaTime);

      // Dynamic tilt during air flight and forward lean during crouch-slide
      const airTilt = this._isGrounded ? 0 : MathUtils.clamp(this._velocity.y * 0.022, -0.22, 0.28);
      const duckTilt =
        this._isDucking && this._isGrounded
          ? (this._facingRight ? 0.14 : -0.14) * (Math.abs(this._velocity.x) > 0.1 ? 1.0 : 0.4)
          : 0;
      const targetTilt = (this._facingRight ? airTilt : -airTilt) + duckTilt;
      this._characterModel.rotation.z +=
        (targetTilt - this._characterModel.rotation.z) * this._expDecay(14.0, deltaTime);

      // Procedural Squash & Stretch (Scale)
      const baseScale = this._characterBaseScale;
      const duckY = 1.0 - 0.46 * this._duckAmount;
      const duckXZ = 1.0 + 0.32 * this._duckAmount;
      const jumpY = 1.0 + this._jumpStretch;
      const jumpXZ = 1.0 - this._jumpStretch * 0.38;

      const finalScaleY = baseScale * duckY * jumpY;
      const finalScaleXZ = baseScale * duckXZ * jumpXZ;
      this._characterModel.scale.set(finalScaleXZ, finalScaleY, finalScaleXZ);
    }

    if (this._mixer) {
      this._mixer.update(deltaTime);
      const isMoving = Math.abs(this._velocity.x) > 0.1 && this._isGrounded;

      // Target weights for the 5 locomotion states
      let targetIdle = 0.0;
      let targetRun = 0.0;
      let targetJump = 0.0;
      let targetCrouch = 0.0;
      let targetCrawl = 0.0;

      if (!this._isGrounded) {
        targetJump = 1.0;
      } else if (this._isDucking) {
        if (isMoving) {
          targetCrawl = 1.0;
        } else {
          targetCrouch = 1.0;
        }
      } else if (isMoving) {
        targetRun = 1.0;
      } else {
        targetIdle = 1.0;
      }

      const blendSpeed = 14.0;
      if (this._idleAction) {
        this._idleAction.weight +=
          (targetIdle - this._idleAction.weight) * this._expDecay(blendSpeed, deltaTime);
      }
      if (this._runAction) {
        this._runAction.weight +=
          (targetRun - this._runAction.weight) * this._expDecay(blendSpeed, deltaTime);
        if (isMoving && !this._isDucking) {
          this._runAction.timeScale = Math.abs(this._velocity.x) * 0.245;
        }
      }
      if (this._jumpAction) {
        this._jumpAction.weight +=
          (targetJump - this._jumpAction.weight) * this._expDecay(blendSpeed, deltaTime);
      }
      if (this._crouchAction) {
        this._crouchAction.weight +=
          (targetCrouch - this._crouchAction.weight) * this._expDecay(blendSpeed, deltaTime);
      }
      if (this._crawlAction) {
        this._crawlAction.weight +=
          (targetCrawl - this._crawlAction.weight) * this._expDecay(blendSpeed, deltaTime);
        if (isMoving && this._isDucking) {
          this._crawlAction.timeScale = Math.abs(this._velocity.x) * 0.45;
        }
      }
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
