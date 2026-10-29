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
  RendererType,
  ShadowMode,
  Sphere,
  StandardMaterial,
  Vector3D,
} from "@small-world-machine/engine";
import { ShadowLabHud, type ProbeMode, type ShadowLabSlider, type ViewPreset } from "./Hud.js";

interface QaSwm42Sample {
  rendererType: string;
  softness: number;
  maxRadius: number;
  shadowMode: ShadowMode;
  probe: ProbeMode;
  /** The [penumbraScale, pcfMaxRadius] values actually written into the WebGPU global buffer. */
  uniform: [number, number] | null;
  /** The [modeFlag, varianceFloor, lightBleed] lanes (216..218) actually written on WebGPU. */
  evsmParams: [number, number, number] | null;
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
 * Showcase 42 — Soft Shadow Lab (PCSS softness gate + interactive tuning HUD).
 *
 * Deterministic micro-stage used by the headless live-gates (`scripts/check-swm42-pole.mjs`,
 * `scripts/check-swm42-evsm.mjs`, `.agents/scratches/check-swm42.mjs`) to *prove* that the
 * `quality.shadowSoftness` / `quality.shadowMaxPcfRadius` knobs actually widen the PCSS penumbra
 * on screen, on WebGPU and WebGL2 alike (`?softness=0` = hard 3x3 PCF, the negative control).
 *
 * For interactive sessions, a collapsible Tuning HUD (`Hud.ts`, `#showcase-hud`, toggle via key `I` or the
 * bottom-right button) lets users switch probes (`1` Box, `2` Pole, `3` Step Rig), lift the caster
 * off the floor to watch PCSS contact-hardening soften in real time, toggle `PCSS` vs. `EVSM`,
 * adjust penumbra softness / max PCF radius, steer the sun, and orbit the camera.
 */
export class Showcase42 extends AbstractShowcase {
  private _softness: number;
  private _maxRadius: number;
  /** "pcss" (default) keeps the legacy path byte-identical; "evsm" renders EVSM moments (ADR 0043). */
  private _shadowMode: ShadowMode;
  /** "box" = (b)/(c) regression stage; "pole" = thin caster for contact-hardening; "steps" = multi-height rig. */
  private _probe: ProbeMode;
  private _liftY: number = 0;
  private _camPos: { x: number; y: number; z: number };
  private _camLook: { x: number; y: number; z: number };
  private _lightDir: { x: number; y: number; z: number };
  private _sunElevationDeg: number = 45;
  private _sunAzimuthDeg: number = 25;
  private _sunIntensity: number;
  private _ambientIntensity: number;
  private _shadowBias: number = 0.0006;
  private _shadowNormalBias: number = 0.02;

  private _sun?: DirectionalLight;
  private _ambient?: AmbientLight;
  private _casterObjects: Object3D[] = [];
  private _hud?: ShadowLabHud;
  private _isOrbitDragging: boolean = false;
  private _lastPointer: { x: number; y: number } = { x: 0, y: 0 };

  constructor() {
    const p = new URLSearchParams(window.location.search);
    const rawProbe = p.get("probe");
    const probe: ProbeMode = rawProbe === "pole" ? "pole" : rawProbe === "steps" ? "steps" : "box";
    const rawSoftParam = p.get("softness");
    const rawSoft = rawSoftParam !== null ? Number(rawSoftParam) : NaN;
    const softness = Number.isFinite(rawSoft) ? Math.max(0, rawSoft) : probe === "steps" ? 2.5 : 1;
    const maxRadius = Math.max(1, Number(p.get("maxRadius")) || (probe === "steps" ? 10 : 4));
    const shadowMode: ShadowMode =
      p.get("shadowMode") === ShadowMode.EVSM ? ShadowMode.EVSM : ShadowMode.PCSS;
    super({
      quality: {
        shadowMode,
        shadowSoftness: softness,
        shadowMaxPcfRadius: maxRadius,
      },
      postProcessing: { enabled: false },
    });
    this._softness = softness;
    this._maxRadius = maxRadius;
    this._shadowMode = shadowMode;
    this._probe = probe;
    // Probe mode defaults reproduce the calibrated high-contrast rig (hardened PCSS demo); the
    // box mode keeps its own deterministic rig. Every value below can be overridden via URL.
    const usePoleRig = this._probe !== "box";
    const dCam: [number, number, number] = usePoleRig ? [0, 6.5, 12] : [0, 5.4, 9.2];
    const dLook: [number, number, number] = usePoleRig ? [0, 1, -1] : [0, 1.4, -3.0];
    const dLight: [number, number, number] = usePoleRig ? [0.08, -0.5, 0.85] : [0.45, -0.88, 0.3];
    const dSunI = usePoleRig ? 5 : 2.6;
    const dAmb = usePoleRig ? 0.08 : 0.12;
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
    this._syncSunAnglesFromVector(this._lightDir.x, this._lightDir.y, this._lightDir.z);
    this._sunIntensity = parseNum(p, "sunI", dSunI);
    this._ambientIntensity = parseNum(p, "amb", dAmb);
    this.defaultCameraController = "none";
    this.defaultFov = MathUtils.degToRad(52);
  }

  protected override onCanvasRecreated(): void {
    // Do not request pointer lock on canvas click so the interactive HUD and orbit drag remain frictionless.
  }

  protected override async setupScene(): Promise<void> {
    // Fixed, slightly elevated view of the caster + its shadow region (fully deterministic).
    this.configureCamera();
    this.setInitialCamera(
      new Vector3D(this._camPos.x, this._camPos.y, this._camPos.z),
      new Vector3D(this._camLook.x, this._camLook.y, this._camLook.z),
    );

    // Very weak ambient keeps the cast shadow deep (high contrast) for the pixel gate.
    const ambient = new AmbientLight({ color: Color.WHITE, intensity: this._ambientIntensity });
    this._ambient = ambient;
    this.scene.add(ambient);

    const sun = new DirectionalLight({
      color: Color.WHITE,
      intensity: this._sunIntensity,
      castShadow: true,
      shadowResolution: 2048,
      shadowBias: this._shadowBias,
      shadowNormalBias: this._shadowNormalBias,
    });
    sun.direction.set(this._lightDir.x, this._lightDir.y, this._lightDir.z).normalize();
    this._sun = sun;
    this.scene.add(sun);

    // Floor: bright, uniform receiver. Engine `Plane`s start vertical (XY, normal +Z) -- must be
    // rotated flat onto the XZ plane (same convention as other showcases' floors).
    const floor = new Object3D("StageFloor");
    floor.geometry = new Plane({ width: 30, height: 30 }).getGeometryData();
    floor.material = new StandardMaterial({ color: new Color(0.85, 0.84, 0.82), roughness: 0.9 });
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this._rebuildCasterGeometry();
    this._installQAHook();
    this._createControlHud();
    this._setupCanvasOrbitInteraction();
  }

  protected override update(_deltaTime: number): void {
    this._refreshReadoutUI();
  }

  private _syncSunAnglesFromVector(x: number, y: number, z: number): void {
    const v = new Vector3D(x, y, z).normalize();
    this._sunElevationDeg = Math.round(
      MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, -v.y)))),
    );
    this._sunAzimuthDeg = Math.round(MathUtils.radToDeg(Math.atan2(v.x, v.z)));
  }

  private _applySunAnglesToLight(): void {
    if (!this._sun) return;
    const elevRad = MathUtils.degToRad(this._sunElevationDeg);
    const azimRad = MathUtils.degToRad(this._sunAzimuthDeg);
    const cosE = Math.cos(elevRad);
    const lx = Math.sin(azimRad) * cosE;
    const ly = -Math.sin(elevRad);
    const lz = Math.cos(azimRad) * cosE;
    this._lightDir = { x: lx, y: ly, z: lz };
    this._sun.direction.set(lx, ly, lz).normalize();
  }

  private _rebuildCasterGeometry(): void {
    for (const obj of this._casterObjects) {
      this.scene.remove(obj);
    }
    this._casterObjects = [];

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
      pole.position.set(0, 2.5 + this._liftY, 0);
      pole.castShadow = true;
      this.scene.add(pole);
      this._casterObjects.push(pole);
    } else if (this._probe === "steps") {
      // Multi-height Step Rig: central mast + 3 cantilevered rungs at 0.5m, 1.8m, and 3.4m height
      // + floating sphere so contact shadow, mid penumbra, and wide far penumbra are visible side by side.
      const matDark = new StandardMaterial({ color: new Color(0.1, 0.1, 0.12), roughness: 0.78 });
      const matAccent = new StandardMaterial({
        color: new Color(0.18, 0.16, 0.22),
        roughness: 0.65,
      });

      const mast = new Object3D("StepRigMast");
      mast.geometry = new Cylinder({
        radiusTop: 0.11,
        radiusBottom: 0.11,
        height: 4.6,
        radialSegments: 12,
      }).getGeometryData();
      mast.material = matDark;
      mast.position.set(0, 2.3 + this._liftY, 0);
      mast.castShadow = true;
      this.scene.add(mast);
      this._casterObjects.push(mast);

      const heights = [0.45, 1.65, 3.1];
      for (let i = 0; i < heights.length; i++) {
        const rung = new Object3D(`StepRigRung_${i}`);
        rung.geometry = new Cube({ size: 1 }).getGeometryData();
        rung.setScale(2.4, 0.14, 0.18);
        rung.material = matAccent;
        rung.position.set(0, heights[i]! + this._liftY, 0);
        rung.castShadow = true;
        this.scene.add(rung);
        this._casterObjects.push(rung);
      }

      const orb = new Object3D("StepRigSphere");
      orb.geometry = new Sphere({
        radius: 0.42,
        widthSegments: 24,
        heightSegments: 16,
      }).getGeometryData();
      orb.material = matAccent;
      orb.position.set(-1.65, 0.42 + this._liftY, 0.4);
      orb.castShadow = true;
      this.scene.add(orb);
      this._casterObjects.push(orb);
    } else {
      // Caster: single dark box -> clean, straight penumbra edges for the pixel gate.
      const box = new Object3D("SoftShadowCaster");
      box.geometry = new Cube({ size: 2.2 }).getGeometryData();
      box.material = new StandardMaterial({ color: new Color(0.1, 0.1, 0.11), roughness: 0.75 });
      box.position.set(0, 1.1 + this._liftY, 0);
      box.castShadow = true;
      this.scene.add(box);
      this._casterObjects.push(box);
    }
  }

  private _setProbeMode(probe: ProbeMode, resetRigToPreset: boolean = true): void {
    this._probe = probe;
    if (resetRigToPreset) {
      this._liftY = 0;
      const usePoleRig = probe !== "box";
      const dCam: [number, number, number] = usePoleRig ? [0, 6.5, 12] : [0, 5.4, 9.2];
      const dLook: [number, number, number] = usePoleRig ? [0, 1, -1] : [0, 1.4, -3.0];
      const dLight: [number, number, number] = usePoleRig ? [0.08, -0.5, 0.85] : [0.45, -0.88, 0.3];
      this._camPos = { x: dCam[0], y: dCam[1], z: dCam[2] };
      this._camLook = { x: dLook[0], y: dLook[1], z: dLook[2] };
      this._lightDir = { x: dLight[0], y: dLight[1], z: dLight[2] };
      this._sunIntensity = usePoleRig ? 5 : 2.6;
      this._ambientIntensity = usePoleRig ? 0.08 : 0.12;
      this._syncSunAnglesFromVector(this._lightDir.x, this._lightDir.y, this._lightDir.z);

      if (probe === "steps" && this._softness <= 1 && this._maxRadius <= 4) {
        this._softness = 2.5;
        this._maxRadius = 10;
        this.renderer.quality.shadowSoftness = this._softness;
        this.renderer.quality.shadowMaxPcfRadius = this._maxRadius;
      }
      this.setInitialCamera(
        new Vector3D(this._camPos.x, this._camPos.y, this._camPos.z),
        new Vector3D(this._camLook.x, this._camLook.y, this._camLook.z),
      );
      if (this._sun) {
        this._sun.direction.set(this._lightDir.x, this._lightDir.y, this._lightDir.z).normalize();
        this._sun.intensity = this._sunIntensity;
      }
      if (this._ambient) {
        this._ambient.intensity = this._ambientIntensity;
      }
    }
    this._rebuildCasterGeometry();
    this._syncHudControlsFromState();
  }

  private _setShadowMode(mode: ShadowMode): void {
    const prev = this._shadowMode;
    this._shadowMode = mode;
    this.renderer.quality.shadowMode = mode;
    // WebGL2 early-returns when leaving EVSM to avoid dummy texture unit clobbering; reload cleanly
    // with the current state in the URL if switching EVSM -> PCSS on WebGL2.
    if (
      this.renderer.type === RendererType.WEB_GL2 &&
      prev === ShadowMode.EVSM &&
      mode === ShadowMode.PCSS
    ) {
      const url = new URL(window.location.href);
      url.searchParams.set("shadowMode", ShadowMode.PCSS);
      url.searchParams.set("probe", this._probe);
      url.searchParams.set("softness", String(this._softness));
      url.searchParams.set("maxRadius", String(this._maxRadius));
      window.location.href = url.toString();
      return;
    }
    this._syncHudControlsFromState();
  }

  private _applyCameraViewPreset(preset: ViewPreset): void {
    if (preset === "overview") {
      this.setInitialCamera(
        new Vector3D(this._camPos.x, this._camPos.y, this._camPos.z),
        new Vector3D(this._camLook.x, this._camLook.y, this._camLook.z),
      );
    } else if (preset === "contact") {
      // Zoomed in on the base of the caster where contact-hardening is sharpest.
      const isBox = this._probe === "box";
      this.camera.position.set(isBox ? 1.8 : 0.9, isBox ? 2.1 : 1.5, isBox ? 3.2 : 2.4);
      this.camera.target.set(isBox ? 0.4 : 0.05, 0.15 + this._liftY * 0.3, isBox ? -0.9 : -0.6);
      this.camera.updateViewMatrix();
    } else {
      // Elevated view of the mid-to-far penumbra spread across the stage floor.
      this.camera.position.set(0.0, 5.2, 6.8);
      this.camera.target.set(-0.6, 0.0, -4.2);
      this.camera.updateViewMatrix();
    }
    this._hud?.setView(preset);
  }

  private _setupCanvasOrbitInteraction(): void {
    const canvas = this.canvas;
    if (!canvas) return;

    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      if (this._hud?.isHovering || e.button !== 0) return;
      this._isOrbitDragging = true;
      this._lastPointer = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("pointermove", (e: PointerEvent) => {
      if (!this._isOrbitDragging) return;
      const dx = e.clientX - this._lastPointer.x;
      const dy = e.clientY - this._lastPointer.y;
      this._lastPointer = { x: e.clientX, y: e.clientY };

      const offset = this.camera.position.clone().sub(this.camera.target);
      const radius = Math.max(1.5, offset.length());
      let theta = Math.atan2(offset.x, offset.z);
      let phi = Math.acos(Math.max(-1, Math.min(1, offset.y / radius)));

      theta -= dx * 0.0055;
      phi = Math.max(0.08, Math.min(Math.PI * 0.48, phi - dy * 0.0055));

      const sinPhi = Math.sin(phi);
      this.camera.position.set(
        this.camera.target.x + radius * sinPhi * Math.sin(theta),
        this.camera.target.y + radius * Math.cos(phi),
        this.camera.target.z + radius * sinPhi * Math.cos(theta),
      );
      this.camera.updateViewMatrix();
    });

    window.addEventListener("pointerup", () => {
      this._isOrbitDragging = false;
    });

    canvas.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        if (this._hud?.isHovering) return;
        e.preventDefault();
        const offset = this.camera.position.clone().sub(this.camera.target);
        const radius = offset.length();
        if (radius < 0.001) return;
        const nextRadius = Math.max(1.5, Math.min(28, radius * (1 + Math.sign(e.deltaY) * 0.08)));
        offset.scale(nextRadius / radius);
        this.camera.position.copyFrom(this.camera.target).add(offset);
        this.camera.updateViewMatrix();
      },
      { passive: false },
    );
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const activeTag = document.activeElement?.tagName;
    if (activeTag === "INPUT" || activeTag === "SELECT") return;

    if (this._hud?.handleKey(event)) {
      return;
    }
    if (event.code === "Digit1") {
      this._setProbeMode("box", true);
    } else if (event.code === "Digit2") {
      this._setProbeMode("pole", true);
    } else if (event.code === "Digit3") {
      this._setProbeMode("steps", true);
    }
  }

  private _syncHudControlsFromState(): void {
    this._hud?.sync({
      probe: this._probe,
      pcss: this._shadowMode === ShadowMode.PCSS,
      liftY: this._liftY,
      softness: this._softness,
      maxRadius: this._maxRadius,
      sunElevationDeg: this._sunElevationDeg,
      sunAzimuthDeg: this._sunAzimuthDeg,
      sunIntensity: this._sunIntensity,
      ambientIntensity: this._ambientIntensity,
      shadowBias: this._shadowBias,
      shadowNormalBias: this._shadowNormalBias,
    });
  }

  private _refreshReadoutUI(): void {
    if (!this._hud || !window.__qaSwm42) return;
    const s = window.__qaSwm42.sample();
    const uStr = s.uniform
      ? `[${s.uniform[0].toFixed(2)}, ${s.uniform[1].toFixed(0)}px]`
      : "n/a (GL)";
    const eStr = s.evsmParams
      ? `[mode=${s.evsmParams[0]}, flr=${s.evsmParams[1].toFixed(4)}, lbr=${s.evsmParams[2].toFixed(2)}]`
      : this._shadowMode === ShadowMode.EVSM
        ? "active (GL2 atlas)"
        : "off";
    const nextText =
      `Backend:  ${s.rendererType}\n` +
      `Mode:     ${s.shadowMode.toUpperCase()} (${s.probe})\n` +
      `PCSS UBO: ${uStr}\n` +
      `EVSM UBO: ${eStr}`;
    this._hud.setReadout(nextText);
  }

  private _createControlHud(): void {
    this._hud = new ShadowLabHud(String(this.renderer.type), {
      setProbe: (probe: ProbeMode): void => this._setProbeMode(probe, true),
      setPcss: (pcss: boolean): void =>
        this._setShadowMode(pcss ? ShadowMode.PCSS : ShadowMode.EVSM),
      applyView: (preset: ViewPreset): void => this._applyCameraViewPreset(preset),
      setSlider: (name: ShadowLabSlider, value: number): void => this._setSlider(name, value),
    });
    this._syncHudControlsFromState();
    this._refreshReadoutUI();
  }

  private _setSlider(name: ShadowLabSlider, value: number): void {
    switch (name) {
      case "LiftY":
        this._liftY = value;
        this._rebuildCasterGeometry();
        break;
      case "Softness":
        this._softness = value;
        this.renderer.quality.shadowSoftness = value;
        break;
      case "MaxRadius":
        this._maxRadius = Math.round(value);
        this.renderer.quality.shadowMaxPcfRadius = this._maxRadius;
        break;
      case "SunElev":
        this._sunElevationDeg = value;
        this._applySunAnglesToLight();
        break;
      case "SunAzim":
        this._sunAzimuthDeg = value;
        this._applySunAnglesToLight();
        break;
      case "SunInt":
        this._sunIntensity = value;
        if (this._sun) this._sun.intensity = value;
        break;
      case "AmbInt":
        this._ambientIntensity = value;
        if (this._ambient) this._ambient.intensity = value;
        break;
      case "Bias":
        this._shadowBias = value;
        if (this._sun) this._sun.shadowBias = value;
        break;
      case "NormalBias":
        this._shadowNormalBias = value;
        if (this._sun) this._sun.shadowNormalBias = value;
        break;
    }
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
        const evsmMode = scratch?.[216];
        const evsmFloor = scratch?.[217];
        const evsmBleed = scratch?.[218];
        const evsmParams: [number, number, number] | null =
          typeof evsmMode === "number"
            ? [
                evsmMode,
                typeof evsmFloor === "number" ? evsmFloor : 0,
                typeof evsmBleed === "number" ? evsmBleed : 0,
              ]
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
          shadowMode: this._shadowMode,
          probe: this._probe,
          uniform,
          evsmParams,
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
