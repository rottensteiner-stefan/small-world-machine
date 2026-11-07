import { SmallWorldMachine, Object3D } from "@small-world-machine/engine/core/index.js";
import { AmbientLight } from "@small-world-machine/engine/core/lights/index.js";
import { Color } from "@small-world-machine/engine/core/colors/index.js";
import {
  StandardMaterial,
  WireframeMaterial,
} from "@small-world-machine/engine/core/materials/index.js";
import { Cube, Ground, Grid as GridGeometry } from "@small-world-machine/engine/geometry/index.js";
import { Vector3D } from "@small-world-machine/engine/math/index.js";
import { OrthographicProjection } from "@small-world-machine/engine/math/projections/index.js";
import {
  CameraStrategyType,
  CameraEffectType,
  PostProcessingEffectType,
  Keys,
} from "@small-world-machine/engine/enums/index.js";
import type { BloomElement } from "@small-world-machine/engine/renderers/post/elements/index.js";
import { ArenaGrid } from "./core/ArenaGrid.js";
import { Cycle } from "./core/Cycle.js";
import { CycleAI } from "./core/CycleAI.js";
import { Hud } from "./core/Hud.js";
import { Events } from "./Events.js";

const GRID_SIZE = 4;
/** 24x24 cells -> a 96x96 world-unit arena. Small enough to read as one screen from the
 *  isometric camera, big enough for a real chase to develop before the walls close in. */
const ARENA_CELLS = 24;
const CYCLE_SPEED = 13;
const TRAIL_HEIGHT = 1.6;
/** Worst case every cell in the arena ends up as one cycle's trail. */
const MAX_TRAIL_SEGMENTS = ARENA_CELLS * ARENA_CELLS;
/** How close to "frozen" time gets while the player isn't holding a direction. Not exactly 0:
 *  a few systems (audio, effects) assume a nonzero deltaTime, and a small trickle still reads
 *  as "the world is holding its breath" rather than a hard pause. */
const IDLE_TIME_SCALE = 0.08;
const TIME_SCALE_LERP_SPEED = 6.0;

const PLAYER_COLOR = new Color(0.533, 0.929, 0.977);
const AI_COLOR = new Color(1, 0.621, 0.762);

/**
 * Light Cycle Arena -- a Tron-style grid duel built almost entirely out of engine primitives
 * that existed but had zero usages anywhere before this: `GridMovementBehavior` (orthogonal
 * movement, 90-degree turns only at grid intersections), the `Ground`/`Grid` geometries (the
 * whole glowing floor grid needs no texture asset), and `InstancedMesh` for each cycle's
 * permanent trail wall.
 *
 * The twist: time only flows at full speed while the player holds a direction. Let go and the
 * whole arena -- both cycles, not just the player's clock -- slows to a crawl, turning what
 * would otherwise be a reflex chase into a deliberate, almost turn-based routing puzzle. See
 * `update()` for how that's implemented (manually-driven `GridMovementBehavior.update()` calls
 * with a scaled deltaTime, bypassing `Scene`'s automatic per-behavior update pass entirely).
 */
export class App extends SmallWorldMachine {
  private _grid!: ArenaGrid;
  private _player!: Cycle;
  private _ai!: Cycle;
  private _hud!: Hud;
  private _timeScale: number = 1.0;
  private _roundOver: boolean = false;
  private readonly _playerDesiredDir: Vector3D = new Vector3D(1, 0, 0);

  constructor() {
    super({ fullscreen: true });
  }

  protected override async setupScene(): Promise<void> {
    const scene = this.scene;

    // Top-down isometric view: the whole arena stays readable at a glance, which the time-warp
    // mechanic leans on -- players need to actually SEE the full grid to plan a route while
    // time is nearly frozen, not just react to whatever's directly ahead.
    const orthoHalfHeight = ARENA_CELLS * GRID_SIZE * 0.62;
    this.camera.projection = new OrthographicProjection({
      left: -orthoHalfHeight * this.camera.aspect,
      right: orthoHalfHeight * this.camera.aspect,
      bottom: -orthoHalfHeight,
      top: orthoHalfHeight,
      near: 0.1,
      far: 1000,
    });
    this.camera.updateProjectionMatrix();
    this.camera.setStrategy(CameraStrategyType.ISOMETRIC);

    scene.add(new AmbientLight({ color: new Color(0.73, 0.762, 0.85), intensity: 0.75 }));

    this._grid = new ArenaGrid(GRID_SIZE, ARENA_CELLS);
    const arenaWorldSize = ARENA_CELLS * GRID_SIZE;

    // --- Floor: a dark ground plane plus a glowing wireframe grid overlay. `Ground` and
    // `Grid` both had zero usages anywhere in the engine before this -- turns out they're
    // exactly the "glowing floor grid" a Tron arena needs, no texture asset required.
    const floor = new Object3D("Floor");
    floor.geometry = new Ground({ width: arenaWorldSize, depth: arenaWorldSize }).getGeometryData();
    floor.material = new StandardMaterial({
      color: new Color(0.169, 0.169, 0.232),
      roughness: 0.9,
    });
    floor.isCollidable = false;
    scene.add(floor);

    const gridLines = new Object3D("FloorGrid");
    gridLines.geometry = new GridGeometry({
      size: arenaWorldSize,
      divisions: ARENA_CELLS,
    }).getGeometryData();
    gridLines.material = new WireframeMaterial(new Color(0.533, 0.929, 0.977));
    gridLines.position.y = 0.02; // clear of the floor plane, avoids z-fighting
    gridLines.isCollidable = false;
    scene.add(gridLines);

    // --- Perimeter walls: four glowing slabs marking the arena bounds ---
    const wallMat = new StandardMaterial({
      color: new Color(0.793, 0.85, 1),
      emissiveColor: new Color(0.793, 0.85, 1),
      emissiveIntensity: 2.0,
      roughness: 0.4,
    });
    const wallGeo = new Cube({ size: 1 }).getGeometryData();
    const half = arenaWorldSize / 2 + GRID_SIZE / 2;
    const makeWall = (name: string, x: number, z: number, sx: number, sz: number): void => {
      const wall = new Object3D(name);
      wall.geometry = wallGeo;
      wall.material = wallMat;
      wall.setScale(sx, TRAIL_HEIGHT * 1.5, sz);
      wall.position.set(x, TRAIL_HEIGHT * 0.75, z);
      wall.isCollidable = false;
      scene.add(wall);
    };
    makeWall("WallNorth", 0, -half, arenaWorldSize + GRID_SIZE * 2, GRID_SIZE * 0.4);
    makeWall("WallSouth", 0, half, arenaWorldSize + GRID_SIZE * 2, GRID_SIZE * 0.4);
    makeWall("WallEast", half, 0, GRID_SIZE * 0.4, arenaWorldSize + GRID_SIZE * 2);
    makeWall("WallWest", -half, 0, GRID_SIZE * 0.4, arenaWorldSize + GRID_SIZE * 2);

    // --- Cycles: player spawns bottom-left heading East, rival spawns top-right heading
    // West -- a straight head-on approach if neither turns, exactly the classic Tron setup.
    const spawnA = new Vector3D(-arenaWorldSize / 2 + GRID_SIZE * 3, 0, -GRID_SIZE * 4);
    const spawnB = new Vector3D(arenaWorldSize / 2 - GRID_SIZE * 3, 0, GRID_SIZE * 4);

    this._player = new Cycle({
      scene,
      id: 0,
      name: "PlayerCycle",
      color: PLAYER_COLOR,
      position: spawnA,
      direction: new Vector3D(1, 0, 0),
      speed: CYCLE_SPEED,
      gridSize: GRID_SIZE,
      maxTrailSegments: MAX_TRAIL_SEGMENTS,
      trailHeight: TRAIL_HEIGHT,
    });
    this._ai = new Cycle({
      scene,
      id: 1,
      name: "RivalCycle",
      color: AI_COLOR,
      position: spawnB,
      direction: new Vector3D(-1, 0, 0),
      speed: CYCLE_SPEED,
      gridSize: GRID_SIZE,
      maxTrailSegments: MAX_TRAIL_SEGMENTS,
      trailHeight: TRAIL_HEIGHT,
    });

    for (const cycle of [this._player, this._ai]) {
      const startCell = this._grid.worldToCell(cycle.object.position.x, cycle.object.position.z);
      this._grid.occupy(startCell.cx, startCell.cz, cycle.id);
    }

    this._player.movement.onGridIntersection = (position, direction): Vector3D | null =>
      this._onGridIntersection(this._player, position, direction);
    this._ai.movement.onGridIntersection = (position, direction): Vector3D | null =>
      this._onGridIntersection(this._ai, position, direction);

    this.camera.target.copyFrom(this._player.object.position);

    this._hud = new Hud(this.events);

    document.addEventListener("keydown", (e: KeyboardEvent): void => this._handleArenaKeyDown(e));

    // --- Bloom: the neon-on-void look leans entirely on emissive materials + bloom here,
    // there's no per-corridor lighting concern like Neon Labyrinth's maze.
    if (this.renderer) {
      this.renderer.postProcessing.enabled = true;
      const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
      if (bloom) {
        bloom.enabled = true;
        bloom.intensity = 0.9;
        bloom.threshold = 0.55;
      }
    }
  }

  private _handleArenaKeyDown(e: KeyboardEvent): void {
    if (this._roundOver) {
      if (e.code === Keys.ENTER) window.location.reload();
      return;
    }
    switch (e.code) {
      case Keys.UP:
      case Keys.W:
        this._playerDesiredDir.set(0, 0, -1);
        break;
      case Keys.DOWN:
      case Keys.S:
        this._playerDesiredDir.set(0, 0, 1);
        break;
      case Keys.LEFT:
      case Keys.A:
        this._playerDesiredDir.set(-1, 0, 0);
        break;
      case Keys.RIGHT:
      case Keys.D:
        this._playerDesiredDir.set(1, 0, 0);
        break;
      default:
        break;
    }
  }

  /** Shared by both cycles: claims the cell just entered or reports a crash, then hands back
   *  the direction to take from here (buffered player input, or the AI's own decision). */
  private _onGridIntersection(
    cycle: Cycle,
    position: Vector3D,
    direction: Vector3D,
  ): Vector3D | null {
    if (this._roundOver || !cycle.alive) return null;

    const cell = this._grid.worldToCell(position.x, position.z);
    if (!this._grid.isFree(cell.cx, cell.cz)) {
      this._destroyCycle(cycle);
      return null;
    }
    this._grid.occupy(cell.cx, cell.cz, cycle.id);
    cycle.layTrailSegment(position);

    if (cycle === this._player) {
      const reversing =
        direction.x === -this._playerDesiredDir.x && direction.z === -this._playerDesiredDir.z;
      return reversing ? null : this._playerDesiredDir.clone();
    }
    return CycleAI.decide(position, direction, this._player.object.position, this._grid);
  }

  private _destroyCycle(cycle: Cycle): void {
    cycle.destroy();
    this.camera.applyEffect(CameraEffectType.SHAKE, 0.5, 0.35);
    this.camera.applyEffect(CameraEffectType.FLASH, 0.5, 0.2);
    const isPlayer = cycle === this._player;
    this.audio.playTone(isPlayer ? 90 : 520, 0.3, 0.6, isPlayer ? "square" : "sawtooth");
    this._roundOver = true;
    this.events.dispatchEvent(Events.ROUND_OVER, { won: !isPlayer });
  }

  private _isHoldingMove(): boolean {
    return (
      this.input.isPressed(Keys.UP) ||
      this.input.isPressed(Keys.DOWN) ||
      this.input.isPressed(Keys.LEFT) ||
      this.input.isPressed(Keys.RIGHT) ||
      this.input.isPressed(Keys.W) ||
      this.input.isPressed(Keys.A) ||
      this.input.isPressed(Keys.S) ||
      this.input.isPressed(Keys.D)
    );
  }

  protected override update(deltaTime: number): void {
    // Time-warp: both cycles' own movement deltaTime is scaled by this, not just the
    // player's -- letting go doesn't make the player relatively faster, it makes the whole
    // arena slow down together, which is what turns the chase into a puzzle.
    const target = this._roundOver ? 0 : this._isHoldingMove() ? 1.0 : IDLE_TIME_SCALE;
    this._timeScale += (target - this._timeScale) * Math.min(1, deltaTime * TIME_SCALE_LERP_SPEED);
    const scaledDeltaTime = deltaTime * this._timeScale;

    if (!this._roundOver) {
      this._player.movement.update(scaledDeltaTime);
      this._ai.movement.update(scaledDeltaTime);
    }

    this.camera.target.copyFrom(this._player.object.position);
    this._hud.update(this._timeScale);
    this.audio.updateListener(this.camera);
  }
}

if (typeof window !== "undefined") {
  const app = new App();
  app.start().catch((err: unknown) => console.error("[LightCycleArena] Failed to start:", err));
}
