import type { Vector3D } from "@small-world-machine/engine";
import { Color, Cylinder, Object3D, StandardMaterial } from "@small-world-machine/engine";
import { FireFlickerProfile } from "./FireFlickerProfile.js";

/**
 * Configuration options for {@link EmberBed}.
 */
export interface EmberBedOptions {
  /** Optional label for the underlying mesh. Defaults to "EmberBed". */
  name?: string;
  /** World position of the fuel bed centre. */
  position: Vector3D;
  /** Bed radius in meters. Defaults to 0.28 (under a small campfire). */
  radius?: number | undefined;
  /** Bed thickness in meters. Defaults to 0.05. */
  height?: number | undefined;
  /** sRGB emissive colour of the coals. Defaults to a deep ember orange. */
  emissiveColor?: Color | undefined;
  /** Base emissive intensity at the breath rest. Defaults to 2.0. */
  emissiveIntensity?: number | undefined;
  /** Breath depth 0..1; 0 = steady glow. Defaults to 0.2. */
  breathStrength?: number | undefined;
  /** Breath speed in Hz. Defaults to 0.35 — slow, never a heartbeat. */
  breathSpeed?: number | undefined;
  /** Deterministic breath seed; give every fire its own. Defaults to 0. */
  seed?: number | undefined;
}

/**
 * The glowing fuel bed under a fire: a flat emissive cylinder that breathes with a slow, seeded
 * value-noise envelope (≈0.35 Hz, deliberately not regular — a steady glow that swells and eases).
 * Purely visual grounding layer (opaque emissive, no custom shader): the logs and the fire's real
 * point light sit on top and separate it from a flat "glow sticker".
 *
 * Like every fire layer it stays deterministic and is driven externally: call {@link update} from
 * the frame loop so pause and slow-motion freeze the breath.
 */
export class EmberBed {
  /** The emissive fuel bed mesh; add it to the scene. */
  public readonly mesh: Object3D;
  /** Master switch; while false the glow holds still at its current intensity. */
  public enabled: boolean = true;

  private readonly _material: StandardMaterial;
  private readonly _profile: FireFlickerProfile;
  private readonly _baseIntensity: number;
  private readonly _breathStrength: number;
  private readonly _breathSpeed: number;
  private _time: number = 0;

  constructor(options: EmberBedOptions) {
    const {
      name = "EmberBed",
      radius = 0.28,
      height = 0.05,
      emissiveColor = new Color(0.95, 0.32, 0.08),
      emissiveIntensity = 2.0,
      breathStrength = 0.2,
      breathSpeed = 0.35,
      seed = 0,
    } = options;

    this._baseIntensity = Math.max(0, emissiveIntensity);
    this._breathStrength = Math.max(0, Math.min(1, breathStrength));
    this._breathSpeed = Math.max(0, breathSpeed);
    this._profile = new FireFlickerProfile(seed);

    this._material = new StandardMaterial({
      color: new Color(0.12, 0.08, 0.06),
      emissiveColor,
      emissiveIntensity: this._baseIntensity,
      roughness: 1,
      metallic: 0,
    });
    this.mesh = new Object3D(name);
    this.mesh.geometry = new Cylinder({
      radiusTop: Math.max(0, radius),
      radiusBottom: Math.max(0, radius),
      height: Math.max(0.01, height),
    }).getGeometryData();
    this.mesh.material = this._material;
    this.mesh.position.copyFrom(options.position);
  }

  /**
   * Advances the slow breath by one frame.
   * @param deltaTime Seconds; 0 freezes the glow (capture/pause support).
   */
  public update(deltaTime: number): void {
    if (!this.enabled || deltaTime <= 0) {
      return;
    }
    this._time += deltaTime;
    // Value noise, not a sine: the glow eases and swells without a detectable regular pulse.
    const n = this._profile.noise(this._time * this._breathSpeed, 6);
    this._material.emissiveIntensity =
      this._baseIntensity * (1 - this._breathStrength + this._breathStrength * n);
  }

  /** Removes the mesh from its parent. Safe to call twice. */
  public dispose(): void {
    this.mesh.parent?.remove(this.mesh);
  }
}
