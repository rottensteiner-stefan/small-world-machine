import { Behavior } from "./Behavior.js";
import { InspectorField } from "../Inspectable.js";
import { Object3D } from "../Object3D.js";
import { InputInterface } from "../input/Input.js";
import { StageZone } from "../stage/StageZone.js";
import { Keys, StageFacing } from "../../enums/index.js";

/** A world-space position for a given (u, v) stage coordinate -- see `StageProjection`. */
export interface StageWorldPlacement {
  x: number;
  y: number;
  z: number;
}

/**
 * Declarative description of how a zone's normalized (u, v) stage-space maps to a 3D world
 * position -- see ADR 0016. `"flat-plane"` is a fixed linear formula (the only shape every scene
 * shipped so far actually needs) and, unlike an arbitrary function, is real data: it round-trips
 * through `SWM_stage_zone`'s sibling data on `StageMovementBehavior` via glTF/Maker. `"custom"` is
 * the deliberate escape hatch for a projection that can't be described this way -- see
 * `StageMovementBehaviorOptions.customUvToWorld`; a `"custom"` scene stays loadable but can't be
 * saved back out with its original projection intact (ADR 0016 Konsequenzen).
 */
export type StageProjection =
  | { mode: "flat-plane"; width: number; height: number; z: number; centerY: number }
  | { mode: "custom" };

/**
 * Configuration options for StageMovementBehavior.
 */
export interface StageMovementBehaviorOptions {
  /** Input interface to query keys. */
  input: InputInterface;
  /** Movement speed in normalized stage-space (u, v) units per second (default: 0.15). */
  speed?: number;
  /** Speed multiplier when holding Shift to run (default: 2.0). */
  runMultiplier?: number;
  /** Rotation smoothing speed in radians per second (default: 10.0). */
  rotationSpeed?: number;
  /** Walkable stage zones defining the navigation mesh, in normalized (u, v) space. */
  zones?: StageZone[];
  /**
   * Declarative stage-space-to-world mapping -- see `StageProjection`. Deliberately NOT a camera
   * unprojection -- a simple, fixed, artist-tunable formula (e.g. linear), so dragging zone
   * points on screen never risks the numerical blowup a real perspective inverse has near the
   * camera's horizon.
   */
  projection: StageProjection;
  /**
   * Only consulted when `projection.mode === "custom"` -- required in that case (the constructor
   * throws otherwise), ignored for `"flat-plane"`. Not serialized by `WorldWriter`: a closure
   * can't round-trip through glTF, so a `"custom"` scene is loadable but not re-saveable with its
   * original projection intact (see `StageProjection`'s own doc comment).
   */
  customUvToWorld?: (u: number, v: number) => StageWorldPlacement;
  /** Starting stage-space position (default: `{ u: 0.5, v: 0.5 }`). */
  startUV?: { u: number; v: number };
  /** Callback fired when character transitions between locomotion states. */
  onStateChange?: (state: "IDLE" | "WALK" | "RUN") => void;
  /** Callback fired when character moves into a different stage zone. */
  onZoneChange?: (zone: StageZone) => void;
  /**
   * Constant radians added to every computed facing angle, to re-center this behavior's
   * "0 = facing -Z (the engine's forward convention, and directly toward the camera when the
   * scene's camera looks down -Z)" assumption onto whichever direction a specific character
   * asset's neutral pose (`rotation.y = 0`) actually faces. Mixamo/FBX-derived rigs frequently
   * don't face -Z at rest -- e.g. the flakturm-tunnel scene's rig faces along local X instead,
   * needing `Math.PI / 2` here, confirmed by directly forcing `rotation.y` through 0/±90/180 and
   * observing which one actually shows the character's front. Defaults to 0 (no correction
   * needed) for a rig that IS authored facing -Z. */
  facingOffset?: number;
  startFacing?: StageFacing;
  /**
   * Extra radians added only to the INITIAL facing angle (on top of `startFacing`/`facingOffset`),
   * never to angles computed from movement. Purely cosmetic: a `startFacing` that lands the
   * character's stance exactly in line with a fixed, non-orbitable camera (e.g. dead-on from
   * behind) can make one leg fully self-occlude the other in the idle pose -- correct geometry,
   * but a jarring first impression since a fixed camera never lets the player see past it. A few
   * degrees of nudge breaks that exact alignment without otherwise changing the intended starting
   * orientation. Defaults to 0 (no nudge). */
  startFacingNudge?: number;
}

/**
 * Behavior providing 2.5D stage character locomotion entirely in normalized (u, v) stage-space:
 * zone containment, forced-perspective scale, and local movement axes are all plain 2D polygon
 * math traced directly on the background art. `uvToWorld` is the only place a 3D world position
 * is ever produced, and it's a fixed, simple formula -- there is no camera-based reconstruction
 * anywhere in this class.
 */
export class StageMovementBehavior extends Behavior {
  /** Inspector schema (ADR 0016 Phase 0 -- the first `Behavior` subclass to populate this). The
   * four `projection.*` fields are always rendered, even in `"custom"` mode (where they're
   * harmlessly unused) -- the same already-established pattern as `OscillatorBehavior`'s
   * `amplitude`/`frequency` staying visible regardless of its chosen `type`. Conditional
   * visibility based on `projection.mode` is a Maker `PropertyPanel` concern (ADR 0016 Phase 2),
   * not something this schema itself needs to express. */
  public static override readonly inspector: Record<string, InspectorField> = {
    speed: { type: "number", label: "Speed", min: 0, max: 2, step: 0.01 },
    runMultiplier: { type: "number", label: "Run Multiplier", min: 1, max: 5, step: 0.1 },
    rotationSpeed: { type: "number", label: "Rotation Speed", min: 0, max: 30, step: 0.1 },
    facingOffset: { type: "number", label: "Facing Offset", min: -3.2, max: 3.2, step: 0.01 },
    "projection.mode": {
      type: "choice",
      label: "Projection",
      options: { "Flat Plane": "flat-plane", Custom: "custom" },
      path: "projection.mode",
    },
    "projection.width": {
      type: "number",
      label: "Width",
      min: 0,
      max: 100,
      step: 0.1,
      path: "projection.width",
      row: "planeSize",
    },
    "projection.height": {
      type: "number",
      label: "Height",
      min: 0,
      max: 100,
      step: 0.1,
      path: "projection.height",
      row: "planeSize",
    },
    "projection.z": {
      type: "number",
      label: "Z",
      min: -50,
      max: 50,
      step: 0.1,
      path: "projection.z",
    },
    "projection.centerY": {
      type: "number",
      label: "Center Y",
      min: -50,
      max: 50,
      step: 0.1,
      path: "projection.centerY",
    },
  };

  public enabled: boolean = true;
  public speed: number;
  public runMultiplier: number;
  public rotationSpeed: number;
  public zones: StageZone[];
  public activeZone: StageZone | undefined;
  public onStateChange: ((state: "IDLE" | "WALK" | "RUN") => void) | undefined;
  public onZoneChange: ((zone: StageZone) => void) | undefined;
  public moveForward: number = 0;
  public facingOffset: number;
  public projection: StageProjection;
  public customUvToWorld: ((u: number, v: number) => StageWorldPlacement) | undefined;

  private _input: InputInterface;
  private _u: number;
  private _v: number;
  private _startFacing: StageFacing;
  private _startFacingNudge: number;
  private _state: "IDLE" | "WALK" | "RUN" = "IDLE";
  private _targetAngle: number = 0;
  private _initialized: boolean = false;

  constructor(options: StageMovementBehaviorOptions) {
    super();
    this._input = options.input;
    this.speed = options.speed ?? 0.15;
    this.runMultiplier = options.runMultiplier ?? 2.0;
    this.rotationSpeed = options.rotationSpeed ?? 10.0;
    this.zones = options.zones ?? [];
    this.facingOffset = options.facingOffset ?? 0;
    if ("custom" === options.projection.mode && !options.customUvToWorld) {
      throw new Error(
        'StageMovementBehavior: projection.mode is "custom" but no customUvToWorld was provided.',
      );
    }
    this.projection = options.projection;
    this.customUvToWorld = options.customUvToWorld;
    this._u = options.startUV?.u ?? 0.5;
    this._v = options.startUV?.v ?? 0.5;
    this._startFacing = options.startFacing ?? StageFacing.DEFAULT;
    this._startFacingNudge = options.startFacingNudge ?? 0;
    this.onStateChange = options.onStateChange;
    this.onZoneChange = options.onZoneChange;
  }

  public get state(): "IDLE" | "WALK" | "RUN" {
    return this._state;
  }

  /** Current stage-space position. */
  public get uv(): { u: number; v: number } {
    return { u: this._u, v: this._v };
  }

  public override update(deltaTime: number): void {
    if (!this.enabled || !this.target || !(this.target instanceof Object3D)) {
      return;
    }

    const obj = this.target;

    if (!this._initialized) {
      this._initialized = true;
      this.activeZone = this._findZone(this._u, this._v) ?? this.zones[0];
      this._applyPlacement(obj);
      if (this._startFacing === StageFacing.LEFT) {
        this._targetAngle = this.facingOffset + Math.PI / 2;
      } else if (this._startFacing === StageFacing.RIGHT) {
        this._targetAngle = this.facingOffset - Math.PI / 2;
      } else if (this._startFacing === StageFacing.BACK) {
        this._targetAngle = this.facingOffset;
      } else {
        this._targetAngle = Math.PI + this.facingOffset;
      }
      this._targetAngle += this._startFacingNudge;
      obj.rotation.y = this._targetAngle;
      if (this.activeZone) this.onZoneChange?.(this.activeZone);
    }

    // 1. Gather directional input (WASD + Arrow Keys) in zone-local stage space
    let moveRight = this._input.getAxis(Keys.A, Keys.D);
    if (this._input.isPressed(Keys.LEFT)) moveRight -= 1;
    if (this._input.isPressed(Keys.RIGHT)) moveRight += 1;

    // W / UP moves along the active zone's own "forward" axis (deeper into the painted
    // corridor), S / DOWN moves back along it -- resolved per zone (see
    // StageZone.getLocalAxes), not a fixed stage direction, since a zone traced onto a
    // perspective background is rarely axis-aligned.
    let moveForward = 0;
    if (this._input.isPressed(Keys.W) || this._input.isPressed(Keys.UP)) moveForward += 1;
    if (this._input.isPressed(Keys.S) || this._input.isPressed(Keys.DOWN)) moveForward -= 1;
    this.moveForward = moveForward;

    const lenSq = moveRight * moveRight + moveForward * moveForward;
    const isMoving = lenSq > 0.01;
    const isRunning =
      isMoving && (this._input.isPressed(Keys.SHIFT_L) || this._input.isPressed(Keys.SHIFT_R));

    // 2. Handle Locomotion State
    const nextState = isRunning ? "RUN" : isMoving ? "WALK" : "IDLE";
    if (nextState !== this._state) {
      this._state = nextState;
      this.onStateChange?.(this._state);
    }

    if (isMoving) {
      const invLen = 1.0 / Math.sqrt(lenSq);
      const localRight = moveRight * invLen;
      const localForward = moveForward * invLen;

      const axes = (this.activeZone ?? this.zones[0])?.getLocalAxes(this._u, this._v) ?? {
        forward: { u: 0, v: -1 },
        right: { u: 1, v: 0 },
      };
      const dirU = axes.right.u * localRight + axes.forward.u * localForward;
      const dirV = axes.right.v * localRight + axes.forward.v * localForward;

      const currentSpeed = this.speed * (isRunning ? this.runMultiplier : 1.0);

      // 3. Calculate desired next stage-space position
      const desiredU = this._u + dirU * currentSpeed * deltaTime;
      const desiredV = this._v + dirV * currentSpeed * deltaTime;

      // 4. Zone containment and slide collision check. A move that lands just outside every
      // zone (but within the edge tolerance) is clamped onto the nearest zone's own boundary
      // instead of being accepted as-is -- otherwise holding a direction key lets the position
      // creep past a zone's drawn edge (e.g. the tunnel's far end, which has no neighboring zone
      // to catch it) into unwalkable art, and the scale falls back to a flat 4-corner average
      // the instant it leaves the interpolation triangles, producing a visible jump.
      let move = this._resolveMove(desiredU, desiredV);
      if (!move) move = this._resolveMove(desiredU, this._v); // slide along U
      if (!move) move = this._resolveMove(this._u, desiredV); // slide along V

      const nextU = move?.u ?? this._u;
      const nextV = move?.v ?? this._v;
      const targetZone = move?.zone;

      // 5. Smooth rotation towards the resulting movement direction. Left/right turning comes
      // from the real world-space X delta (via uvToWorld); "facing into" vs. "facing out of" the
      // scene comes from the change in forced-perspective scale instead of world-space Z --
      // uvToWorld intentionally keeps a constant Z (see its own docs), so a pure "walk deeper"
      // move has no world Z delta to turn on, but it always shrinks the scale, which is already
      // the same depth cue faked for size. Growing scale (walking back out) turns the character
      // back towards the camera.
      const beforeWorld = this._uvToWorld(this._u, this._v);
      const afterWorld = this._uvToWorld(nextU, nextV);
      const worldDx = afterWorld.x - beforeWorld.x;

      const beforeScale = this.activeZone?.getScaleAt(this._u, this._v) ?? 1.0;
      const afterScale = (targetZone ?? this.activeZone)?.getScaleAt(nextU, nextV) ?? beforeScale;
      const depthDelta = afterScale - beforeScale;

      // With this engine's -Z-forward convention (confirmed live: `rotation.y=0` faces exactly
      // -Z), an object's forward direction as a function of `rotation.y=θ` is
      // `(-sin θ, -cos θ)` -- so facing a desired (worldDx, depthDelta) requires
      // `θ = atan2(-worldDx, -depthDelta)`, not `atan2(worldDx, depthDelta)` (the un-negated form
      // faces exactly the OPPOSITE of the intended direction -- e.g. walking deeper/away from the
      // camera would turn the character to face the camera instead of away from it). Verified by
      // directly computing `Matrix4.compose()`'s output for known angles, not just derived on
      // paper. `facingOffset` then re-centers this onto whichever direction the target's own mesh
      // was authored to face at `rotation.y=0` -- see that option's doc comment.
      if (worldDx * worldDx + depthDelta * depthDelta > 0.000001) {
        this._targetAngle = this.facingOffset + Math.atan2(-worldDx, -depthDelta);
      }
      let angleDiff = this._targetAngle - obj.rotation.y;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      const step =
        Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), this.rotationSpeed * deltaTime);
      obj.rotation.y += step;

      this._u = nextU;
      this._v = nextV;
      this._applyPlacement(obj);

      // 6. Notify on zone change
      if (targetZone && targetZone !== this.activeZone) {
        this.activeZone = targetZone;
        this.onZoneChange?.(this.activeZone);
      }
    }
  }

  /** Resolves `this.projection` (see `StageProjection`) into an actual world placement. */
  private _uvToWorld(u: number, v: number): StageWorldPlacement {
    if ("flat-plane" === this.projection.mode) {
      const { width, height, z, centerY } = this.projection;
      return { x: (u - 0.5) * width, y: centerY + (0.5 - v) * height, z };
    }
    return this.customUvToWorld!(u, v);
  }

  /** Writes the current (u, v) position and forced-perspective scale onto the target object. */
  private _applyPlacement(obj: Object3D): void {
    const placement = this._uvToWorld(this._u, this._v);
    obj.position.set(placement.x, placement.y, placement.z);
    const s = this.activeZone?.getScaleAt(this._u, this._v) ?? 1.0;
    obj.scale.set(s, s, s);
  }

  /**
   * Finds the StageZone containing the given (u, v) coordinates, used only to seed the initial
   * active zone. Movement itself goes through `_resolveMove`, which also clamps onto the zone.
   */
  private _findZone(u: number, v: number): StageZone | undefined {
    for (const zone of this.zones) {
      if (zone.containsPoint(u, v)) return zone;
    }
    for (const zone of this.zones) {
      if (zone.containsPoint(u, v, 0.015)) return zone;
    }
    return undefined;
  }

  /**
   * Resolves a candidate move to a zone and a position actually on that zone. A point already
   * inside a zone is returned unchanged; a point just outside every zone (within the edge
   * tolerance -- bridging a small gap between adjoining zones, or the far end of a zone with
   * nothing beyond it) is clamped onto the closest such zone's own boundary via
   * `StageZone.clampToPolygon`, so the character position is always a real point on a drawn
   * zone, never floating in an undefined area just past one.
   */
  private _resolveMove(
    u: number,
    v: number,
  ): { zone: StageZone; u: number; v: number } | undefined {
    for (const zone of this.zones) {
      if (zone.containsPoint(u, v)) return { zone, u, v };
    }

    let best: { zone: StageZone; u: number; v: number; distSq: number } | undefined;
    for (const zone of this.zones) {
      if (!zone.containsPoint(u, v, 0.015)) continue;
      const clamped = zone.clampToPolygon(u, v);
      const distSq = (u - clamped.u) * (u - clamped.u) + (v - clamped.v) * (v - clamped.v);
      if (!best || distSq < best.distSq) {
        best = { zone, u: clamped.u, v: clamped.v, distSq };
      }
    }
    return best;
  }
}
