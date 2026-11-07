import { Behavior } from "../behaviors/index.js";
import type { Object3D } from "../index.js";
import type { CameraInterfaceData } from "../../interfaces/index.js";
import { isCameraTarget } from "../../interfaces/index.js";

interface DeviceOrientationEventIOS {
  requestPermission?: () => Promise<"granted" | "denied">;
}

/**
 * A controller that rotates its target based on the device's physical orientation sensors.
 */
export class DeviceOrientationController extends Behavior {
  public enabled: boolean = true;
  private _alpha: number = 0;
  private _beta: number = 0;
  private _gamma: number = 0;
  private _isInitialized: boolean = false;

  private _onDeviceOrientation = (event: DeviceOrientationEvent): void => {
    this._alpha = event.alpha ? (event.alpha * Math.PI) / 180.0 : 0;
    this._beta = event.beta ? (event.beta * Math.PI) / 180.0 : 0;
    this._gamma = event.gamma ? (event.gamma * Math.PI) / 180.0 : 0;
    this._isInitialized = true;
  };

  public override onAttach(target: Object3D | CameraInterfaceData): void {
    super.onAttach(target);
    this._initSensors();
  }

  private async _initSensors(): Promise<void> {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
      console.warn(
        "[DeviceOrientationController] DeviceOrientationEvent is not supported on this device.",
      );
      return;
    }

    const eventIOS = DeviceOrientationEvent as unknown as DeviceOrientationEventIOS;
    if (typeof eventIOS.requestPermission === "function") {
      try {
        const permission = await eventIOS.requestPermission();
        if (permission === "granted") {
          this._startListening();
        } else {
          console.warn(
            "[DeviceOrientationController] Permission to access device orientation was denied.",
          );
        }
      } catch (err: unknown) {
        console.error("[DeviceOrientationController] Error requesting sensor permission:", err);
      }
    } else {
      this._startListening();
    }
  }

  private _startListening(): void {
    window.addEventListener("deviceorientation", this._onDeviceOrientation);
  }

  public override update(_deltaTime: number): void {
    if (!this.enabled || !this.target || !this._isInitialized) {
      return;
    }

    const target = this.target;
    const isCamera = isCameraTarget(target);

    // Depending on the screen orientation, we might need to swap axes.
    // For now, we assume standard portrait mode where:
    // alpha = rotation around Z (maps to world Y / yaw)
    // beta = rotation around X (maps to world X / pitch)
    // gamma = rotation around Y (maps to world Z / roll)

    if (isCamera) {
      target.theta = this._alpha;
      // beta is usually 90 degrees (PI/2) when holding the phone upright.
      // Small World Machine's phi expects 0 when looking straight forward.
      target.phi = this._beta - Math.PI / 2.0;
    } else {
      const obj = target as Object3D;
      obj.rotation.set(this._beta - Math.PI / 2.0, this._alpha, -this._gamma);
    }
  }

  public override onDetach(): void {
    window.removeEventListener("deviceorientation", this._onDeviceOrientation);
    super.onDetach();
  }
}
