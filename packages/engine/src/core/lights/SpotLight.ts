import type { LightOptions } from "./AbstractLight.js";
import { AbstractLight, MAX_CLUSTERED_LIGHTS_PER_TYPE } from "./AbstractLight.js";
import { LightType } from "../../enums/index.js";
import type { LightDataInterface } from "../../interfaces/index.js";
import { Vector3D } from "../../math/index.js";
import { PerspectiveProjection } from "../../math/projections/index.js";
import { Camera } from "../cameras/Camera.js";
import type { InspectorField } from "../Inspectable.js";

/**
 * Configuration options for spotlight.
 */
export interface SpotLightOptions extends LightOptions {
  /** The direction of the light. Defaults to (0, -1, 0). */
  direction?: Vector3D;
  /** The maximum distance of the light. Defaults to 50.0. */
  distance?: number;
  /** The angle of the light cone in radians. Defaults to PI / 6. */
  angle?: number;
  /** The penumbra factor (0-1). Defaults to 0.5. */
  penumbra?: number;
  /** The decay factor of the light. Defaults to 2.0. */
  decay?: number;
}

/**
 * Spotlight that emits light in a cone shape.
 */
export class SpotLight extends AbstractLight {
  /** Own fields on top of `AbstractLight.inspector` -- see `collectInspectorSchema()`. */
  public static override readonly inspector: Record<string, InspectorField> = {
    distance: {
      type: "number",
      label: "Distance",
      min: 0,
      max: 100,
      step: 0.1,
      row: "attenuation",
    },
    decay: { type: "number", label: "Decay", min: 0, max: 5, step: 0.01, row: "attenuation" },
    angle: { type: "number", label: "Angle", min: 0, max: 1.57, step: 0.01, row: "cone" },
    penumbra: { type: "number", label: "Penumbra", min: 0, max: 1, step: 0.01, row: "cone" },
  };

  /** @inheritdoc */
  public override readonly type: LightType = LightType.SPOT;

  /** The direction of the light. */
  public direction: Vector3D;

  /** The maximum distance of the light. */
  public distance: number;

  /** The angle of the light cone in radians. */
  public angle: number;

  /** The penumbra factor (0-1). */
  public penumbra: number;

  /** The decay factor of the light. */
  public decay: number;

  /**
   * Creates a new SpotLight.
   * @param options The configuration options for the light.
   */
  constructor(options: SpotLightOptions = {}) {
    const {
      direction = new Vector3D(0, -1, 0).normalize(),
      distance = 50.0,
      angle = Math.PI / 6,
      penumbra = 0.5,
      decay = 2.0,
      name = "SpotLight",
    } = options;
    super({ ...options, name });
    this.direction = direction;
    this.distance = distance;
    this.angle = angle;
    this.penumbra = penumbra;
    this.decay = decay;

    if (this.castShadow) {
      this.updateShadowCamera();
    }
  }

  /**
   * Updates the shadow camera's matrices based on the spotlight's properties.
   */
  public updateShadowCamera(): void {
    if (!this.shadowCamera) {
      this.shadowCamera = new Camera(
        new PerspectiveProjection({
          fov: this.angle * 2.0, // FOV is full angle
          aspect: 1.0, // Shadow map is 1:1 square
          near: 0.1,
          far: this.distance > 0 ? this.distance : 1000.0,
        }),
      );
    } else {
      const proj = this.shadowCamera.projection as PerspectiveProjection;
      proj.fov = this.angle * 2.0;
      proj.far = this.distance > 0 ? this.distance : 1000.0;
      this.shadowCamera.updateProjectionMatrix();
    }

    // Position camera at light position
    this.shadowCamera.position.set(
      this.worldMatrix.data[12] ?? this.position.x,
      this.worldMatrix.data[13] ?? this.position.y,
      this.worldMatrix.data[14] ?? this.position.z,
    );

    // Target is position + direction
    const target = this.shadowCamera.position.clone().add(this.direction);
    this.shadowCamera.target.copyFrom(target);

    // Default up vector for lights looking straight down
    if (Math.abs(this.direction.y) > 0.99) {
      this.shadowCamera.up.set(0, 0, -1);
    } else {
      this.shadowCamera.up.set(0, 1, 0);
    }

    this.shadowCamera.updateViewMatrix();
  }

  /** @inheritdoc */
  public override applyTo(data: LightDataInterface): void {
    // Global cap, not per-object nearest-N selection -- see docs/adr/0004-point-spot-light-global-cap.md.
    if (MAX_CLUSTERED_LIGHTS_PER_TYPE > data.sLights.length) {
      data.sLights.push(this);
    }
  }
}
