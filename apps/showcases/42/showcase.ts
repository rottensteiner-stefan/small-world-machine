import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cube,
  DirectionalLight,
  MathUtils,
  Object3D,
  Plane,
  StandardMaterial,
  Vector3D,
} from "@small-world-machine/engine";

interface QaSwm42Sample {
  rendererType: string;
  softness: number;
  maxRadius: number;
  /** The [penumbraScale, pcfMaxRadius] values actually written into the WebGPU global buffer. */
  uniform: [number, number] | null;
  /** Key global-buffer lanes (WebGPU only): ambient/dir-light data + dirShadowInfo for diagnosis. */
  glob: {
    ambient: number | null;
    dirLightColor: [number, number, number] | null;
    dirLightDir: [number, number, number] | null;
    numLights: [number, number, number] | null;
    dirShadowInfo: [number, number, number, number] | null;
  } | null;
}

interface QaSwm42Hook {
  sample(): QaSwm42Sample;
}

declare global {
  interface Window {
    __qaSwm42?: QaSwm42Hook;
  }
}

/**
 * Showcase 42 — Soft Shadow Lab (WebGPU PCSS softness gate).
 *
 * Deterministic micro-stage used by the headless live-gate `.agents/scratches/check-swm42.mjs`
 * to *prove* that the WebGPU-only `quality.shadowSoftness` / `quality.shadowMaxPcfRadius` knobs
 * actually widen the PCSS penumbra on screen, and that they are a documented no-op on WebGL2
 * (negative control — WebGL2 only has fixed 3x3 PCF).
 *
 * Query knobs:
 *   ?rendererType=WEB_GPU   backend override (handled by AbstractShowcase)
 *   ?softness=<float>       -> quality.shadowSoftness      (default 1)
 *   ?maxRadius=<int>        -> quality.shadowMaxPcfRadius  (default 4)
 *
 * The scene is deliberately stripped: one box caster on a bright, uniform floor, weak ambient,
 * no post-processing, fixed camera. Any measured pixel change in the shadow transition can
 * therefore be attributed exclusively to the penumbra knobs. The `__qaSwm42` hook also exposes
 * the uniform lane actually written into the WebGPU global buffer (`[212, 213]` = penumbraScale,
 * pcfMaxRadius) so the gate can verify CPU -> GPU wiring end to end.
 */
export class Showcase42 extends AbstractShowcase {
  private readonly _softness: number;
  private readonly _maxRadius: number;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    const softness = Math.max(0, Number(params.get("softness")) || 1);
    const maxRadius = Math.max(1, Number(params.get("maxRadius")) || 4);
    super({
      quality: { shadowSoftness: softness, shadowMaxPcfRadius: maxRadius },
      postProcessing: { enabled: false },
    });
    this._softness = softness;
    this._maxRadius = maxRadius;
    this.defaultCameraController = "none";
    this.defaultFov = MathUtils.degToRad(52);
  }

  protected override async setupScene(): Promise<void> {
    // Fixed, slightly elevated view of the caster + its shadow region (fully deterministic).
    this.configureCamera();
    this.setInitialCamera(new Vector3D(0, 5.4, 9.2), new Vector3D(0, 1.4, -3.0));

    // Very weak ambient keeps the cast shadow deep (high contrast) for the pixel gate.
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.12 }));

    const sun = new DirectionalLight({
      color: Color.WHITE,
      intensity: 2.6,
      castShadow: true,
      shadowResolution: 2048,
      shadowBias: 0.0006,
      shadowNormalBias: 0.02,
    });
    // Light travels down-and-toward the camera (+Z), so the penumbra is cast into the near field.
    sun.direction.set(0.45, -0.88, 0.3).normalize();
    this.scene.add(sun);

    // Floor: bright, uniform receiver. Engine `Plane`s start vertical (XY, normal +Z) -- must be
    // rotated flat onto the XZ plane (same convention as other showcases' floors).
    const floor = new Object3D("StageFloor");
    floor.geometry = new Plane({ width: 30, height: 30 }).getGeometryData();
    floor.material = new StandardMaterial({ color: new Color(0.85, 0.84, 0.82), roughness: 0.9 });
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Caster: single dark box -> clean, straight penumbra edges for the pixel gate.
    const box = new Object3D("SoftShadowCaster");
    box.geometry = new Cube({ size: 2.2 }).getGeometryData();
    box.material = new StandardMaterial({ color: new Color(0.1, 0.1, 0.11), roughness: 0.75 });
    box.position.set(0, 1.1, 0);
    box.castShadow = true;
    this.scene.add(box);

    this._installQAHook();
  }

  private _installQAHook(): void {
    window.__qaSwm42 = {
      sample: (): QaSwm42Sample => {
        // The WebGPU renderer exposes the pending global-buffer content directly; WebGL2 does not.
        const scratch = (
          this.renderer as unknown as { scratchGlobalBufferData?: Float32Array }
        ).scratchGlobalBufferData;
        const penumbraScale = scratch?.[212];
        const pcfMaxRadius = scratch?.[213];
        const uniform: [number, number] | null =
          typeof penumbraScale === "number" && typeof pcfMaxRadius === "number"
            ? [penumbraScale, pcfMaxRadius]
            : null;
        const dirShadowInfo: [number, number, number, number] | null =
          scratch && typeof scratch[196] === "number"
            ? [scratch[196], scratch[197], scratch[198], scratch[199]]
            : null;
        const numLights: [number, number, number] | null =
          scratch && typeof scratch[32] === "number"
            ? [scratch[32], scratch[33], scratch[34]]
            : null;
        const dirLightColor: [number, number, number] | null =
          scratch && typeof scratch[24] === "number"
            ? [scratch[24], scratch[25], scratch[26]]
            : null;
        const dirLightDir: [number, number, number] | null =
          scratch && typeof scratch[28] === "number"
            ? [scratch[28], scratch[29], scratch[30]]
            : null;
        return {
          rendererType: this.renderer.type,
          softness: this._softness,
          maxRadius: this._maxRadius,
          uniform,
          glob: scratch
            ? {
                ambient: scratch[20],
                dirLightColor,
                dirLightDir,
                numLights,
                dirShadowInfo,
              }
            : null,
        };
      },
    };
  }
}

const app = new Showcase42();
app.start().catch((err: unknown) => console.error("[Showcase42] Failed to start:", err));
