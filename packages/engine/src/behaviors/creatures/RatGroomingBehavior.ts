import type { InspectorField } from "../../core/behaviors/Behavior.js";
import { Behavior } from "../../core/behaviors/Behavior.js";
import type { Object3D } from "../../core/Object3D.js";

export enum RatGroomingState {
  FACE_WASHING = "face_washing",
  ALERT_SNIFFING = "alert_sniffing",
  EAR_CLEANING = "ear_cleaning",
}

export interface RatGroomingBehaviorOptions {
  speed?: number;
  cycleDuration?: number;
  enableTailMotion?: number | boolean;
}

/**
 * Procedural animation behavior for rodents / rats.
 * Implements an articulated 3-phase grooming state machine:
 * 1. Face & whiskers scrubbing (Lissajous circular paw motion at 18 Hz)
 * 2. Alert sniffing & inquisitive head scanning (26 Hz nose twitches)
 * 3. Ear scratching & head tilting
 * Along with phase-shifted spline wave propagation for the tail.
 */
export class RatGroomingBehavior extends Behavior {
  public static override readonly inspector: Record<string, InspectorField> = {
    speed: { type: "number", min: 0.1, max: 5.0, step: 0.1 },
    cycleDuration: { type: "number", min: 2.0, max: 20.0, step: 0.5 },
  };

  public speed: number = 1.0;
  public cycleDuration: number = 8.5;
  public enableTailMotion: boolean = true;

  public currentState: RatGroomingState = RatGroomingState.FACE_WASHING;
  public elapsedTime: number = 0;

  private _head: Object3D | undefined;
  private _leftPaw: Object3D | undefined;
  private _rightPaw: Object3D | undefined;
  private _tailSegments: Object3D[] = [];

  constructor(options?: RatGroomingBehaviorOptions) {
    super();
    if (options?.speed !== undefined) this.speed = options.speed;
    if (options?.cycleDuration !== undefined) this.cycleDuration = options.cycleDuration;
    if (options?.enableTailMotion !== undefined) {
      this.enableTailMotion = Boolean(options.enableTailMotion);
    }
  }

  public override onAttach(target: Object3D): void {
    super.onAttach(target);
    this._bindNodes(target);
  }

  private _bindNodes(target: Object3D): void {
    this._tailSegments = [];

    this._head = this._findNodeByName(target, "Head");
    this._leftPaw = this._findNodeByName(target, "LeftPaw");
    this._rightPaw = this._findNodeByName(target, "RightPaw");

    for (let s = 0; s < 12; s++) {
      const seg = this._findNodeByName(target, `Tail_${s}`);
      if (seg) {
        this._tailSegments.push(seg);
      }
    }
  }

  /** Resolves a canonical node name against a rig that may prefix every node with a
   * character/instance identifier (e.g. "Rat1Head", "RatHead" for canonical "Head"). Tries an
   * exact match first, then falls back to a generic tree-walk suffix match instead of guessing a
   * fixed list of prefix candidates -- see `AnimationMixer`'s `_findByNormalizedMixamoName` for the
   * same anti-pattern fixed the same way for Mixamo rig prefixes. */
  private _findNodeByName(target: Object3D, canonicalName: string): Object3D | undefined {
    const exact = target.getObjectByName(canonicalName);
    if (exact) return exact;
    return this._findBySuffix(target, canonicalName);
  }

  private _findBySuffix(node: Object3D, suffix: string): Object3D | undefined {
    if (node.name !== suffix && node.name.endsWith(suffix)) return node;
    for (const child of node.children) {
      const found = this._findBySuffix(child, suffix);
      if (found) return found;
    }
    return undefined;
  }

  public override update(deltaTime: number): void {
    if (!this.isActive || !this.target) return;

    this.elapsedTime += deltaTime * this.speed;
    const time = this.elapsedTime;
    const cycle = (time * 1.1) % this.cycleDuration;

    if (this._head && this._leftPaw && this._rightPaw) {
      if (cycle < 4.2) {
        this.currentState = RatGroomingState.FACE_WASHING;
        // Phase 1: Schnelles Putzen von Gesicht & Schnurrhaaren (Zirkuläres Schrubben mit Vorderpfoten)
        const scrubSin = Math.sin(time * 18.0);
        const scrubCos = Math.cos(time * 18.0);
        this._leftPaw.position.set(
          -0.015 + scrubSin * 0.008,
          0.125 + scrubCos * 0.014,
          0.068 + scrubSin * 0.008,
        );
        this._rightPaw.position.set(
          0.015 - scrubSin * 0.008,
          0.125 + scrubCos * 0.014,
          0.068 - scrubSin * 0.008,
        );
        this._head.rotation.x = 0.12 + Math.sin(time * 18.0) * 0.06;
        this._head.rotation.y = Math.sin(time * 3.0) * 0.08;
        this._head.rotation.z = Math.sin(time * 9.0) * 0.04;
      } else if (cycle < 6.4) {
        this.currentState = RatGroomingState.ALERT_SNIFFING;
        // Phase 2: Innehalten, Sichern & Neugieriges Schnüffeln (Pfoten an Brust, Nase zuckt)
        this._leftPaw.position.set(-0.018, 0.09, 0.055);
        this._rightPaw.position.set(0.018, 0.09, 0.055);
        const sniff = Math.sin(time * 26.0) * 0.025;
        this._head.rotation.x = -0.15 + sniff;
        this._head.rotation.y = Math.sin(time * 2.2) * 0.32;
        this._head.rotation.z = 0;
      } else {
        this.currentState = RatGroomingState.EAR_CLEANING;
        // Phase 3: Ohr-Putzen (Linke Pfote schrubbt hinter dem Ohr, Kopf neigt sich)
        const earScrub = Math.sin(time * 16.0);
        this._leftPaw.position.set(-0.038, 0.16 + earScrub * 0.012, 0.035);
        this._rightPaw.position.set(0.016, 0.085, 0.055);
        this._head.rotation.z = -0.22 + earScrub * 0.06;
        this._head.rotation.x = 0.08;
        this._head.rotation.y = -0.12;
      }
    }

    if (this.enableTailMotion && this._tailSegments.length > 0) {
      for (let s = 0; s < this._tailSegments.length; s++) {
        const seg = this._tailSegments[s]!;
        seg.rotation.y = Math.sin(time * 2.8 + s * 0.75) * (0.16 + s * 0.09);
        seg.rotation.x = Math.PI / 2 + Math.cos(time * 1.6 + s * 0.5) * 0.04;
      }
    }
  }
}
