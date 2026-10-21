import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cube,
  Cylinder,
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
  probe: "box" | "pole";
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

/** Query-float with fallback; a MISSING or non-finite value resolves to the sane default. */
function parseNum(p: URLSearchParams, key: string, fallback: number): number {
  const v = p.get(key);
  if (v === null) return fallback;
  const raw = Number(v);
  return Number.isFinite(raw) ? raw : fallback;
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
  /** "box" = the (b)/(c) regression stage; "pole" = thin caster for the contact-hardening probe. */
  private readonly _probe: "box" | "pole";
  private readonly _camPos: { x: number; y: number; z: number };
  private readonly _camLook: { x: number; y: number; z: number };
  private readonly _lightDir: { x: number; y: number; z: number };
  private readonly _sunIntensity: number;
  private readonly _ambientIntensity: number;

  constructor() {
    const p = new URLSearchParams(window.location.search);
    const rawSoft = Number(p.get("softness"));
    const softness = Number.isFinite(rawSoft) ? Math.max(0, rawSoft) : 1;
    const maxRadius = Math.max(1, Number(p.get("maxRadius")) || 4);
    super({
      quality: { shadowSoftness: softness, shadowMaxPcfRadius: maxRadius },
      postProcessing: { enabled: false },
    });
    this._softness = softness;
    this._maxRadius = maxRadius;
    this._probe = p.get("probe") === "pole" ? "pole" : "box";
    // Probe mode defaults reproduce the calibrated high-contrast rig (hardened PCSS demo); the
    // box mode keeps its own deterministic rig. Every value below can be overridden via URL.
    const dCam: [number, number, number] = this._probe === "pole" ? [0, 6.5, 12] : [0, 5.4, 9.2];
    const dLook: [number, number, number] = this._probe === "pole" ? [0, 1, -1] : [0, 1.4, -3.0];
    const dLight: [number, number, number] =
      this._probe === "pole" ? [0.08, -0.5, 0.85] : [0.45, -0.88, 0.3];
    const dSunI = this._probe === "pole" ? 5 : 2.6;
    const dAmb = this._probe === "pole" ? 0.08 : 0.12;
    this._camPos = {
      x: parseNum(p, "camX", dCam[0]),
      y: parseNum(p, "camY", dCam[1]),
      z: parseNum(p, "camZ", dCam[2]),
    };
    this._camLook = {
      x: parseNum(p, "lookX", dLook[0]),
      y: parseNum(p, "lookY", dLook[1]),
      z: parseNum(p, "lookZ", dLook[2]),
    };
    this._lightDir = {
      x: parseNum(p, "lightX", dLight[0]),
      y: parseNum(p, "lightY", dLight[1]),
      z: parseNum(p, "lightZ", dLight[2]),
    };
    this._sunIntensity = parseNum(p, "sunI", dSunI);
    this._ambientIntensity = parseNum(p, "amb", dAmb);
    this.defaultCameraController = "none";
    this.defaultFov = MathUtils.degToRad(52);
  }

  protected override async setupScene(): Promise<void> {
    // Fixed, slightly elevated view of the caster + its shadow region (fully deterministic).
    this.configureCamera();
    this.setInitialCamera(
      new Vector3D(this._camPos.x, this._camPos.y, this._camPos.z),
      new Vector3D(this._camLook.x, this._camLook.y, this._camLook.z),
    );

    // Very weak ambient keeps the cast shadow deep (high contrast) for the pixel gate.
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: this._ambientIntensity }));

    const sun = new DirectionalLight({
      color: Color.WHITE,
      intensity: this._sunIntensity,
      castShadow: true,
      shadowResolution: 2048,
      shadowBias: 0.0006,
      shadowNormalBias: 0.02,
    });
    sun.direction.set(this._lightDir.x, this._lightDir.y, this._lightDir.z).normalize();
    this.scene.add(sun);

    // Floor: bright, uniform receiver. Engine `Plane`s start vertical (XY, normal +Z) -- must be
    // rotated flat onto the XZ plane (same convention as other showcases' floors).
    const floor = new Object3D("StageFloor");
    floor.geometry = new Plane({ width: 30, height: 30 }).getGeometryData();
    floor.material = new StandardMaterial({ color: new Color(0.85, 0.84, 0.82), roughness: 0.9 });
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    if (this._probe === "pole") {
      // Thin occluder: a tall, slim pole whose cast shadow has a well-defined contact line at the
      // base and a long, visible penumbra that grows with distance -- the geometry that lets the
      // hardened PCSS actually demonstrate contact-hardening (the box averages its whole depth
      // span and stays uniformly soft).
      const pole = new Object3D("HardeningPole");
      pole.geometry = new Cylinder({
        radiusTop: 0.12,
        radiusBottom: 0.12,
        height: 5,
        radialSegments: 12,
      }).getGeometryData();
      pole.material = new StandardMaterial({ color: new Color(0.1, 0.1, 0.11), roughness: 0.8 });
      pole.position.set(0, 2.5, 0);
      pole.castShadow = true;
      this.scene.add(pole);
    } else {
      // Caster: single dark box -> clean, straight penumbra edges for the pixel gate.
      const box = new Object3D("SoftShadowCaster");
      box.geometry = new Cube({ size: 2.2 }).getGeometryData();
      box.material = new StandardMaterial({ color: new Color(0.1, 0.1, 0.11), roughness: 0.75 });
      box.position.set(0, 1.1, 0);
      box.castShadow = true;
      this.scene.add(box);
    }

    this._installQAHook();
  }

  private _installQAHook(): void {
    window.__qaSwm42 = {
      sample: (): QaSwm42Sample => {
        // The WebGPU renderer exposes the pending global-buffer content directly; WebGL2 does not.
        const scratch = (this.renderer as unknown as { scratchGlobalBufferData?: Float32Array })
          .scratchGlobalBufferData;
        const penumbraScale = scratch?.[212];
        const pcfMaxRadius = scratch?.[213];
        const uniform: [number, number] | null =
          typeof penumbraScale === "number" && typeof pcfMaxRadius === "number"
            ? [penumbraScale, pcfMaxRadius]
            : null;
        const dirShadowInfo: [number, number, number, number] | null =
          scratch && typeof scratch[196] === "number"
            ? [scratch[196]!, scratch[197]!, scratch[198]!, scratch[199]!]
            : null;
        const numLights: [number, number, number] | null =
          scratch && typeof scratch[32] === "number"
            ? [scratch[32]!, scratch[33]!, scratch[34]!]
            : null;
        const dirLightColor: [number, number, number] | null =
          scratch && typeof scratch[24] === "number"
            ? [scratch[24]!, scratch[25]!, scratch[26]!]
            : null;
        const dirLightDir: [number, number, number] | null =
          scratch && typeof scratch[28] === "number"
            ? [scratch[28]!, scratch[29]!, scratch[30]!]
            : null;
        return {
          rendererType: this.renderer.type,
          softness: this._softness,
          maxRadius: this._maxRadius,
          probe: this._probe,
          uniform,
          glob: scratch
            ? {
                ambient: scratch[20] ?? null,
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
