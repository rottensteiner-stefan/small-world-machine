import {
  Behavior,
  CameraInterfaceData,
  InputInterface,
  Keys,
  Object3D,
  Vector3D,
} from "@small-world-machine/engine";

/**
 * Controller to move a physics-based marble using WASD.
 */
export class MarbleController extends Behavior {
  private _forceVector: Vector3D = new Vector3D();
  private _torqueVector: Vector3D = new Vector3D();
  private _moveSpeed: number;
  private _camera: CameraInterfaceData;
  private _input: InputInterface;

  constructor(camera: CameraInterfaceData, input: InputInterface, moveSpeed: number = 25.0) {
    super();
    this._camera = camera;
    this._input = input;
    this._moveSpeed = moveSpeed;
  }

  public override update(): void {
    if (!this.target || !(this.target instanceof Object3D) || !this.target.rigidBody) return;

    const moveX = this._input.getAxis(Keys.A, Keys.D);
    const moveZ = this._input.getAxis(Keys.W, Keys.S);

    if (moveX !== 0 || moveZ !== 0) {
      // Look-relative movement (Right-handed: -Z is Forward)
      // We use camera.theta (orbital yaw) instead of rotation.y
      const camRotY = this._camera.theta;
      const sin = Math.sin(camRotY);
      const cos = Math.cos(camRotY);

      // dirX/dirZ based on camera Y rotation
      const dirX = moveX * cos + moveZ * sin;
      const dirZ = moveZ * cos - moveX * sin;

      // Apply linear force
      this._forceVector.set(dirX * this._moveSpeed, 0, dirZ * this._moveSpeed);
      this.target.rigidBody.applyForce(this._forceVector);

      // Fake Torque for rolling (rotate around perpendicular axis)
      // If moving +X (Right), rotate around -Z (Forward) so top rolls right
      // If moving +Z (Back), rotate around +X (Right) so top rolls back
      this._torqueVector.set(dirZ * this._moveSpeed, 0, -dirX * this._moveSpeed).scale(0.5);
      this.target.rigidBody.applyTorque(this._torqueVector);
    }
  }
}
