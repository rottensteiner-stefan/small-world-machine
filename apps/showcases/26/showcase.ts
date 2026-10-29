import {
  AbstractShowcase,
  CameraStrategyType,
  Color,
  Object3D,
  OrbitController,
  Plane,
  RetroScreenMaterial,
  TextTexture,
} from "@small-world-machine/engine";

export class Showcase extends AbstractShowcase {
  private _textTexture: TextTexture | undefined;
  private _time: number = 0;
  private _lastUpdate: number = 0;

  protected async setupScene(): Promise<void> {
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    this.camera.position.set(0, 1.5, 6);
    this.renderer.setClearColor(new Color(0.1, 0.1, 0.15));
    this.camera.target.set(0, 1.5, 0);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    this._textTexture = new TextTexture({
      text: "Starting System...\nVGA Compatible ROM BIOS\nCopyright (C) 2026",
      fontFamily: "monospace",
      fontSize: 64,
      fontWeight: 700,
      color: "#00ff66",
      background: "#001a08",
      align: "left",
      padding: 40,
      outline: { color: "#003311", width: 2 },
      shadow: { color: "#00ff66", blur: 14 },
    });

    const screenHeight = 3;
    const screen = new Object3D("MonitorScreen");
    screen.geometry = new Plane({
      width: screenHeight * this._textTexture.aspectRatio,
      height: screenHeight,
    }).getGeometryData();
    screen.material = new RetroScreenMaterial({
      diffuseMap: this._textTexture.texture,
      mode: "tv50s",
    });
    screen.position.set(0, 1.5, 0);
    this.scene.add(screen);
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);
    if (undefined === this._textTexture) return;

    this._time += deltaTime;
    if (this._time - this._lastUpdate < 1.0) return;
    this._lastUpdate = this._time;

    const mem = 1024 + Math.floor(Math.random() * 1024);
    this._textTexture.setText(
      `SYSTEM BOOT...\nINITIALIZING...\nMEM OK: ${mem} KB\nUPTIME: ${this._time.toFixed(1)}s`,
    );
  }
}

const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase26] Failed to start:", err));
