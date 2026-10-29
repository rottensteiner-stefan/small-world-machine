import {
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  Color,
  Cube,
  DirectionalLight,
  Grid,
  Keys,
  Object3D,
  OrthographicProjection,
  PhongMaterial,
  Sphere,
  Vector3D,
  WireframeMaterial,
} from "@small-world-machine/engine";

/**
 * Showcase 5: Grid-based Movement with Enemies.
 */
export class Showcase extends AbstractShowcase {
  protected override defaultCameraController = "none" as const;

  private _player!: Object3D;
  private _clickMarker!: Object3D;
  private _enemies: Object3D[] = [];
  private _targetPos: Vector3D = new Vector3D();

  // Input State
  private _mouseWasDown: boolean = false;

  // Movement State
  private _isMoving: boolean = false;
  private _moveProgress: number = 0;
  private _moveStart: Vector3D = new Vector3D();
  private _moveEnd: Vector3D = new Vector3D();
  private _moveDuration: number = 0.2;

  protected override async setupScene(): Promise<void> {
    // 1. Setup Orthographic Projection (Perfect for 15x15 grid)
    const frustumSize: number = 15;

    this.camera.projection = new OrthographicProjection({
      left: -frustumSize / 2,
      right: frustumSize / 2,
      top: frustumSize / 2,
      bottom: -frustumSize / 2,
      near: -1000,
      far: 1000,
    });

    this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera.updateProjectionMatrix();

    // 2. Isometric Strategy
    this.camera.setStrategy(CameraStrategyType.ISOMETRIC);

    // 3. Lighting
    const ambient: AmbientLight = new AmbientLight({ color: Color.WHITE, intensity: 0.4 });
    this.scene.add(ambient);

    const sun: DirectionalLight = new DirectionalLight({ color: Color.WHITE, intensity: 0.8 });
    sun.direction.set(-1, -1, -1).normalize();
    this.scene.add(sun);

    // 4. Floor Grid (15x15 units)
    const gridSize = 15;
    const gridObj: Object3D = new Object3D("FloorGrid");
    gridObj.geometry = new Grid({ size: gridSize, divisions: gridSize }).getGeometryData();
    const gridMat: WireframeMaterial = new WireframeMaterial();
    gridMat.color = Color.fromName("darkslategray")!;
    gridObj.material = gridMat;
    this.scene.add(gridObj);

    // 5. Setup Materials
    const playerMat = new PhongMaterial({ color: Color.fromName("dodgerblue")! });
    const enemyMat = new PhongMaterial({ color: Color.RED });

    // 6. Create Player
    this._player = this._createActor("Player", playerMat);
    this._player.position.set(0.5, 0, 0.5);
    this.scene.add(this._player);

    // 6b. Click Marker (Visual Debug)
    this._clickMarker = new Object3D("ClickMarker");
    this._clickMarker.geometry = new Sphere({ radius: 0.2 }).getGeometryData();
    const markerMat = new PhongMaterial({ color: Color.YELLOW });
    this._clickMarker.material = markerMat;
    this._clickMarker.isVisible = false;
    this.scene.add(this._clickMarker);

    // 7. Create 3 Enemies at random positions
    for (let i = 0; i < 3; i++) {
      const enemy = this._createActor(`Enemy_${i}`, enemyMat);

      // Random grid center position within 15x15 (-7.5 to 7.5)
      const rx = Math.floor(Math.random() * 14 - 7) + 0.5;
      const rz = Math.floor(Math.random() * 14 - 7) + 0.5;
      enemy.position.set(rx, 0, rz);

      this._enemies.push(enemy);
      this.scene.add(enemy);
    }

    console.log("Showcase 5: Isometric Scene with Enemies ready.");
  }

  private _createActor(name: string, material: PhongMaterial): Object3D {
    const actor = new Object3D(name);

    const pBase = new Object3D(`${name}_Base`);
    pBase.geometry = new Cube({ size: 1.0 }).getGeometryData();
    pBase.material = material;
    pBase.position.y = 0.5;
    actor.add(pBase);

    const pMid = new Object3D(`${name}_Mid`);
    pMid.geometry = new Cube({ size: 0.5 }).getGeometryData();
    pMid.material = material;
    pMid.position.y = 1.25;
    actor.add(pMid);

    const pTop = new Object3D(`${name}_Top`);
    pTop.geometry = new Cube({ size: 0.25 }).getGeometryData();
    pTop.material = material;
    pTop.position.y = 1.625;
    actor.add(pTop);

    return actor;
  }

  protected override update(deltaTime: number): void {
    // 1. Camera Update
    this._targetPos.copyFrom(this._player.position);
    this.camera.update(this._targetPos, 0, 0);

    // 2. Keyboard Input
    if (false === this._isMoving) {
      let dz: number = 0;
      if (this.input.isPressed(Keys.W)) dz = -1;
      else if (this.input.isPressed(Keys.S)) dz = 1;

      // Rotation (A/D)
      if (this.input.isPressed(Keys.A)) {
        this._player.rotation.y -= 2.0 * deltaTime;
      } else if (this.input.isPressed(Keys.D)) {
        this._player.rotation.y += 2.0 * deltaTime;
      }

      if (0 !== dz) {
        this._startMove(this._player.position.x, this._player.position.z + dz);
      }
    }

    // 3. Mouse Click (Single click check)
    const isMouseDown: boolean = true === this.input.mouse.left;
    if (true === isMouseDown && false === this._mouseWasDown && false === this._isMoving) {
      const rect: DOMRect = this.canvas.getBoundingClientRect();
      const mx: number = ((this.input.mouse.x - rect.left) / rect.width) * 2 - 1;
      const my: number = -((this.input.mouse.y - rect.top) / rect.height) * 2 + 1;

      const worldPos: Vector3D = this.camera.screenToWorld(mx, my);

      // Update visual marker
      this._clickMarker.position.copyFrom(worldPos);
      this._clickMarker.isVisible = true;

      // Original Snapping to grid intersections (0.5 offsets)
      const nextX: number = Math.floor(worldPos.x) + 0.5;
      const nextZ: number = Math.floor(worldPos.z) + 0.5;

      console.log(
        `[v5] NDC: (${mx.toFixed(2)}, ${my.toFixed(2)}) -> World: (${worldPos.x.toFixed(1)}, ${worldPos.z.toFixed(1)}) -> Target: (${nextX}, ${nextZ})`,
      );

      this._startMove(nextX, nextZ);
    }
    this._mouseWasDown = isMouseDown;

    // 4. Movement Interpolation
    if (true === this._isMoving) {
      this._moveProgress += deltaTime / this._moveDuration;
      if (1.0 <= this._moveProgress) {
        this._moveProgress = 1.0;
        this._isMoving = false;
      }
      this._player.position.x =
        this._moveStart.x + (this._moveEnd.x - this._moveStart.x) * this._moveProgress;
      this._player.position.z =
        this._moveStart.z + (this._moveEnd.z - this._moveStart.z) * this._moveProgress;
    }
  }

  private _startMove(tx: number, tz: number): void {
    const halfGrid: number = 15 / 2;
    if (tx > -halfGrid && tx < halfGrid && tz > -halfGrid && tz < halfGrid) {
      this._isMoving = true;
      this._moveProgress = 0;
      this._moveStart.copyFrom(this._player.position);
      this._moveEnd.set(tx, 0, tz);
    }
  }
}

// === START THE ENGINE ===
const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase5] Failed to start:", err));
