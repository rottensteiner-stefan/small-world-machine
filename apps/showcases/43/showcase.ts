import {
  AbstractShowcase,
  AmbientLight,
  Color,
  DirectionalLight,
  Ground,
  MathUtils,
  Object3D,
  Plane,
  Sphere,
  StandardMaterial,
  Vector3D,
} from "@small-world-machine/engine";
import { GoldenCapture, parseGoldenSpec } from "./GoldenCapture.js";

interface MaterialSpec {
  name: string;
  color: Color;
  metallic: number;
  roughness: number;
}

/**
 * Showcase 43 — Kanon 1m Studio (E11B reference cell, P3).
 *
 * Minimal studio reference for PBR/shadow scale and drift protection: a 1m material ball on a
 * neutral ground plane under a hard studio key light. Fully procedural and STATIC (no animation,
 * no clock-driven effect) — every frame is byte-identical, so golden captures need no animation
 * clock to reset. The `st43-*` golden pools only swap the ball's material; the studio, light and
 * camera never move. Interactive mode shows the same static cell (deliberately no extra UI).
 */
class Showcase43 extends AbstractShowcase {
  private _ball: Object3D | undefined;
  private _goldenCapture: GoldenCapture | undefined;

  /** The ball's material variants exposed as golden pools (`st43-*`, see GoldenCapture.ts). */
  private readonly _materials: readonly MaterialSpec[] = [
    { name: "Matte", color: new Color(0.85, 0.82, 0.78), metallic: 0.0, roughness: 0.95 },
    { name: "Satin", color: new Color(0.7, 0.62, 0.5), metallic: 0.0, roughness: 0.45 },
    { name: "Polished Metal", color: new Color(0.9, 0.9, 0.92), metallic: 0.95, roughness: 0.35 },
    { name: "Chrome", color: new Color(0.95, 0.97, 1.0), metallic: 1.0, roughness: 0.06 },
  ];

  constructor() {
    super();
    // No fly/orbit controller: the reference framing must stay exactly as authored, interactive
    // and golden alike.
    this.defaultCameraController = "none";
  }

  /**
   * Runs the regular showcase boot, then -- only when the golden query parameters are present --
   * the deterministic per-material capture on top of the fully-ready scene (see GoldenCapture.ts).
   */
  public override async start(): Promise<void> {
    const golden = parseGoldenSpec();
    await super.start();
    if (golden) {
      this._goldenCapture = new GoldenCapture(this, {
        applyMaterial: (index: number): void => {
          const spec = this._materials[index];
          if (!spec || !this._ball) return;
          this._ball.material = this._buildMaterial(spec);
        },
      });
      await this._goldenCapture.run(golden);
    }
  }

  protected override async setupScene(): Promise<void> {
    this.defaultFov = MathUtils.degToRad(52);
    this.configureCamera();

    // 5x5 m studio floor -- neutral, high-roughness gray.
    const floor = new Object3D("StudioFloor");
    floor.geometry = new Ground({ width: 5, depth: 5 }).getGeometryData();
    floor.material = new StandardMaterial({
      color: new Color(0.28, 0.28, 0.3),
      metallic: 0.0,
      roughness: 0.9,
    });
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Neutral backdrop wall so the frame is not empty behind the ball.
    const backdrop = new Object3D("StudioBackdrop");
    backdrop.geometry = new Plane({ width: 6, height: 3.2 }).getGeometryData();
    backdrop.material = new StandardMaterial({
      color: new Color(0.16, 0.16, 0.18),
      metallic: 0.0,
      roughness: 1.0,
    });
    backdrop.setPosition(0, 1.6, -1.9);
    this.scene.add(backdrop);

    // The 1m material ball (radius 0.5), resting on the floor at the origin.
    const ball = new Object3D("MaterialBall");
    ball.geometry = new Sphere({ radius: 0.5, widthSegments: 64, heightSegments: 48 }).getGeometryData();
    ball.material = this._buildMaterial(this._materials[0]!);
    ball.setPosition(0, 0.5, 0);
    ball.castShadow = true;
    ball.receiveShadow = true;
    this._ball = ball;
    this.scene.add(ball);

    // Hard studio key light: casts the reference shadow on the floor (shadow/PBR drift protection).
    const key = new DirectionalLight({ color: Color.WHITE, intensity: 1.6 });
    key.direction.set(-2.5, 4, 1.5);
    key.castShadow = true;
    key.shadowResolution = 2048;
    key.shadowBias = 0.0008;
    this.scene.add(key);

    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.22 }));

    // Fixed inspection framing (about 1.9 m from the ball centre).
    const camPos = new Vector3D(1.6, 1.4, 2.6);
    const camTarget = new Vector3D(0, 0.5, 0);
    this.camera.position.copyFrom(camPos);
    this.camera.target.copyFrom(camTarget);
    this.setInitialCamera(camPos, camTarget);
    this.camera.updateViewMatrix();
  }

  protected override update(_deltaTime: number): void {
    // Fully static reference cell: nothing moves, so the frame is byte-identical every time.
  }

  public override destroy(): void {
    this._goldenCapture?.dispose();
    super.destroy();
  }

  private _buildMaterial(spec: MaterialSpec): StandardMaterial {
    return new StandardMaterial({
      color: spec.color,
      metallic: spec.metallic,
      roughness: spec.roughness,
    });
  }
}

// === START THE ENGINE ===
const app = new Showcase43();
app.start().catch((err: unknown) => console.error("[Showcase43] Failed to start:", err));
