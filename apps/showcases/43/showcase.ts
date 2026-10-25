import {
  AbstractShowcase,
  AmbientLight,
  Color,
  DirectionalLight,
  Grid,
  Ground,
  MathUtils,
  Object3D,
  Plane,
  Sphere,
  StandardMaterial,
  Vector3D,
  WireframeMaterial,
} from "@small-world-machine/engine";
import { GoldenCapture, parseGoldenSpec, type GoldenSpec } from "./GoldenCapture.js";

interface MaterialSpec {
  name: string;
  color: Color;
  metallic: number;
  roughness: number;
}

/** Travel direction of the reference key light: from upper-left-front down onto the floor. */
const KEY_DIRECTION_REFERENCE = new Vector3D(2.5, -4, -1.5);
const KEY_INTENSITY_REFERENCE = 1.6;
const AMBIENT_INTENSITY_REFERENCE = 0.22;
/** The repo has no neutral studio HDRI; the nebula set gives chrome something to mirror. */
const IBL_PATH = "../13/assets/ibl";
const IBL_INTENSITY = 1.0;
const MATERIAL_STEP = 0.05;
const ANGLE_STEP_DEG = 5;
const ANGLE_STEP_FINE_DEG = 1;
const ELEVATION_MIN_DEG = 5;
const ELEVATION_MAX_DEG = 89;
const RAD_TO_DEG = 180 / Math.PI;
const CUSTOM_PRESET = -1;

/**
 * Showcase 43 — Kanon 1m Studio (E11B reference cell, P3).
 *
 * Minimal studio reference for PBR/shadow scale and drift protection: a 1m material ball on a
 * neutral ground plane under a hard studio key light. The golden mode (`st43-*` pools) is fully
 * STATIC: only the ball's material changes, studio, light and camera stay as authored, so every
 * frame is byte-identical.
 *
 * Interactive mode (no golden query) adds a material/light lab on top of the same cell: orbit
 * camera, material presets and roughness/metallic/color, key-light angles, optional IBL and a 1m
 * grid. Key `0` restores the exact golden reference state.
 */
class Showcase43 extends AbstractShowcase {
  private readonly _golden: GoldenSpec | undefined;
  private _ballMaterial: StandardMaterial | undefined;
  private _key: DirectionalLight | undefined;
  private _ambient: AmbientLight | undefined;
  private _grid: Object3D | undefined;
  private _goldenCapture: GoldenCapture | undefined;
  private _presetIndex: number = 0;
  private _azimuthDeg: number = 0;
  private _elevationDeg: number = 0;
  private _gridVisible: boolean = false;
  private _iblEnabled: boolean = false;
  private _iblLoad: Promise<void> | undefined;
  private _hud: HTMLElement | undefined;
  private _hudStyle: HTMLStyleElement | undefined;
  private _hudToggleBtn: HTMLButtonElement | undefined;

  /** The ball's material variants exposed as golden pools (`st43-*`, see GoldenCapture.ts). */
  private readonly _materials: readonly MaterialSpec[] = [
    { name: "Matte", color: new Color(0.85, 0.82, 0.78), metallic: 0.0, roughness: 0.95 },
    { name: "Satin", color: new Color(0.7, 0.62, 0.5), metallic: 0.0, roughness: 0.45 },
    { name: "Polished Metal", color: new Color(0.9, 0.9, 0.92), metallic: 0.95, roughness: 0.35 },
    { name: "Chrome", color: new Color(0.95, 0.97, 1.0), metallic: 1.0, roughness: 0.06 },
  ];

  constructor() {
    super();
    this._golden = parseGoldenSpec();
    // Golden captures need the authored framing; interactive sessions orbit the ball (R resets).
    this.defaultCameraController = this._golden ? "none" : "orbit";
  }

  /**
   * Runs the regular showcase boot, then either the deterministic per-material golden capture
   * (see GoldenCapture.ts) or, in interactive mode, the material/light lab HUD.
   */
  public override async start(): Promise<void> {
    await super.start();
    if (!this._golden) {
      this._createHud();
      return;
    }
    this._goldenCapture = new GoldenCapture(this, {
      applyMaterial: (index: number): void => this._applyPreset(index),
    });
    await this._goldenCapture.run(this._golden);
  }

  protected override onCanvasRecreated(): void {
    // No pointer lock: orbit drag and HUD sliders need a free cursor.
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
    ball.geometry = new Sphere({
      radius: 0.5,
      widthSegments: 64,
      heightSegments: 48,
    }).getGeometryData();
    const reference = this._materials[0]!;
    // The color is cloned because presets are later copied INTO this material; sharing the
    // reference would let slider edits overwrite the preset table.
    const ballMaterial = new StandardMaterial({
      color: reference.color.clone(),
      metallic: reference.metallic,
      roughness: reference.roughness,
    });
    ball.material = ballMaterial;
    ball.setPosition(0, 0.5, 0);
    ball.castShadow = true;
    ball.receiveShadow = true;
    this._ballMaterial = ballMaterial;
    this.scene.add(ball);

    // Hard studio key light: casts the reference shadow on the floor (shadow/PBR drift protection).
    const key = new DirectionalLight({ color: Color.WHITE, intensity: KEY_INTENSITY_REFERENCE });
    key.direction.copyFrom(KEY_DIRECTION_REFERENCE);
    key.castShadow = true;
    key.shadowResolution = 2048;
    key.shadowBias = 0.0008;
    this._key = key;
    this.scene.add(key);
    this._syncLightAnglesFromDirection();

    const ambient = new AmbientLight({
      color: Color.WHITE,
      intensity: AMBIENT_INTENSITY_REFERENCE,
    });
    this._ambient = ambient;
    this.scene.add(ambient);

    // 1m scale grid, only added to the scene on demand (key G).
    const grid = new Object3D("ScaleGrid");
    grid.geometry = new Grid({ size: 5, divisions: 5 }).getGeometryData();
    const gridMaterial = new WireframeMaterial();
    gridMaterial.color = new Color(0.45, 0.75, 0.9);
    grid.material = gridMaterial;
    grid.setPosition(0, 0.003, 0);
    this._grid = grid;

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
    this._hud?.remove();
    this._hudStyle?.remove();
    this._hudToggleBtn?.remove();
    super.destroy();
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (this._golden || event.altKey || event.metaKey || event.ctrlKey) return;
    if (document.activeElement?.tagName === "INPUT") return;

    const shift = event.shiftKey;
    const angleStep = shift ? ANGLE_STEP_FINE_DEG : ANGLE_STEP_DEG;
    switch (event.code) {
      case "Digit0":
        this._resetToReference();
        break;
      case "Digit1":
      case "Digit2":
      case "Digit3":
      case "Digit4":
        this._applyPreset(Number(event.code.slice(-1)) - 1);
        break;
      case "BracketLeft":
        this._nudgeMaterial(shift ? 0 : -MATERIAL_STEP, shift ? -MATERIAL_STEP : 0);
        break;
      case "BracketRight":
        this._nudgeMaterial(shift ? 0 : MATERIAL_STEP, shift ? MATERIAL_STEP : 0);
        break;
      case "ArrowLeft":
        this._nudgeLight(-angleStep, 0);
        break;
      case "ArrowRight":
        this._nudgeLight(angleStep, 0);
        break;
      case "ArrowUp":
        this._nudgeLight(0, angleStep);
        break;
      case "ArrowDown":
        this._nudgeLight(0, -angleStep);
        break;
      case "KeyE":
        this._setIbl(!this._iblEnabled);
        break;
      case "KeyG":
        this._setGridVisible(!this._gridVisible);
        break;
      case "KeyI":
        this._toggleHud();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  /** Copies a preset into the ball's single material (no per-change allocation / rebuild). */
  private _applyPreset(index: number): void {
    const spec = this._materials[index];
    const material = this._ballMaterial;
    if (!spec || !material) return;
    material.color.copyFrom(spec.color);
    material.metallic = spec.metallic;
    material.roughness = spec.roughness;
    this._presetIndex = index;
    this._syncHud();
  }

  private _nudgeMaterial(deltaRoughness: number, deltaMetallic: number): void {
    const material = this._ballMaterial;
    if (!material) return;
    material.roughness = Math.min(1, Math.max(0, material.roughness + deltaRoughness));
    material.metallic = Math.min(1, Math.max(0, material.metallic + deltaMetallic));
    this._presetIndex = CUSTOM_PRESET;
    this._syncHud();
  }

  /** Azimuth/elevation describe where the light comes FROM, i.e. the inverted travel direction. */
  private _syncLightAnglesFromDirection(): void {
    const direction = this._key?.direction;
    if (!direction) return;
    const length = direction.length();
    if (length < 1e-6) return;
    this._elevationDeg = Math.asin(-direction.y / length) * RAD_TO_DEG;
    this._azimuthDeg = Math.atan2(-direction.x, -direction.z) * RAD_TO_DEG;
  }

  private _applyLightAngles(): void {
    if (!this._key) return;
    const elevation = MathUtils.degToRad(this._elevationDeg);
    const azimuth = MathUtils.degToRad(this._azimuthDeg);
    const horizontal = Math.cos(elevation);
    this._key.direction.set(
      -horizontal * Math.sin(azimuth),
      -Math.sin(elevation),
      -horizontal * Math.cos(azimuth),
    );
  }

  private _nudgeLight(deltaAzimuthDeg: number, deltaElevationDeg: number): void {
    const azimuth = this._azimuthDeg + deltaAzimuthDeg;
    this._azimuthDeg = ((((azimuth + 180) % 360) + 360) % 360) - 180;
    this._elevationDeg = Math.min(
      ELEVATION_MAX_DEG,
      Math.max(ELEVATION_MIN_DEG, this._elevationDeg + deltaElevationDeg),
    );
    this._applyLightAngles();
    this._syncHud();
  }

  private _setGridVisible(visible: boolean): void {
    if (!this._grid || visible === this._gridVisible) return;
    this._gridVisible = visible;
    if (visible) {
      this.scene.add(this._grid);
    } else {
      this.scene.remove(this._grid);
    }
    this._syncHud();
  }

  /** The IBL set is loaded lazily on first use so the reference look never depends on it. */
  private _setIbl(enabled: boolean): void {
    this._iblEnabled = enabled;
    this._syncHud();
    if (!enabled && !this._iblLoad) return;
    if (!this._iblLoad) {
      this._iblLoad = this.loadIbl(IBL_PATH, IBL_INTENSITY);
    }
    this._iblLoad
      .then((): void => {
        this.scene.environmentIntensity = this._iblEnabled ? IBL_INTENSITY : 0;
      })
      .catch((err: unknown): void => {
        console.error("[Showcase43] IBL load failed:", err);
        this._iblLoad = undefined;
        this._iblEnabled = false;
        this._syncHud();
      });
  }

  private _resetToReference(): void {
    this._applyPreset(0);
    if (this._key) {
      this._key.direction.copyFrom(KEY_DIRECTION_REFERENCE);
      this._key.intensity = KEY_INTENSITY_REFERENCE;
    }
    if (this._ambient) {
      this._ambient.intensity = AMBIENT_INTENSITY_REFERENCE;
    }
    this._syncLightAnglesFromDirection();
    this._setGridVisible(false);
    this._setIbl(false);
    this.resetCamera();
    this._syncHud();
  }

  private _toggleHud(force?: boolean): void {
    if (!this._hud) return;
    const open = force ?? !this._hud.classList.contains("open");
    this._hud.classList.toggle("open", open);
    this._hudToggleBtn?.classList.toggle("active", open);
  }

  private _setSliderValue(name: string, value: number, decimals: number, suffix: string): void {
    const slider = document.getElementById(`st43Sl${name}`) as HTMLInputElement | null;
    const label = document.getElementById(`st43Val${name}`);
    if (slider) slider.value = String(value);
    if (label) label.textContent = `${value.toFixed(decimals)}${suffix}`;
  }

  /** Pushes the current state into the HUD controls; event-driven only, never per frame. */
  private _syncHud(): void {
    if (!this._hud) return;
    for (let i = 0; i < this._materials.length; i++) {
      document
        .getElementById(`st43Preset${i}`)
        ?.classList.toggle("active", i === this._presetIndex);
    }
    const material = this._ballMaterial;
    if (material) {
      this._setSliderValue("Roughness", material.roughness, 2, "");
      this._setSliderValue("Metallic", material.metallic, 2, "");
      const colorInput = document.getElementById("st43Color") as HTMLInputElement | null;
      if (colorInput) colorInput.value = material.color.toHex().toLowerCase();
    }
    this._setSliderValue("Azimuth", this._azimuthDeg, 0, "°");
    this._setSliderValue("Elevation", this._elevationDeg, 0, "°");
    this._setSliderValue("KeyIntensity", this._key?.intensity ?? 0, 2, "");
    this._setSliderValue("Ambient", this._ambient?.intensity ?? 0, 2, "");
    document.getElementById("st43BtnIbl")?.classList.toggle("active", this._iblEnabled);
    document.getElementById("st43BtnGrid")?.classList.toggle("active", this._gridVisible);
  }

  private _bindSlider(name: string, onInput: (value: number) => void): void {
    const slider = document.getElementById(`st43Sl${name}`) as HTMLInputElement | null;
    if (!slider) return;
    slider.addEventListener("input", (): void => {
      onInput(parseFloat(slider.value));
      this._syncHud();
    });
    // Hand keyboard focus back to the shortcuts once the drag ends.
    slider.addEventListener("change", (): void => slider.blur());
  }

  private _createHud(): void {
    const style = document.createElement("style");
    style.textContent = `
      #showcase-hud .preset-group.four-col { grid-template-columns: repeat(4, 1fr); }
      #showcase-hud .preset-group.two-col { grid-template-columns: repeat(2, 1fr); }
      #showcase-hud .hud-note { font-size: 10px; line-height: 1.4; color: #94a3b8; margin-top: 6px; }
      #showcase-hud .hud-keys { font-size: 10px; line-height: 1.6; color: #94a3b8; }
      #showcase-hud .hud-keys kbd {
        font-family: var(--font-mono, "JetBrains Mono", monospace);
        border: 1px solid rgba(148, 163, 184, 0.35); border-radius: 3px; padding: 0 4px;
      }
      #showcase-hud input[type="color"] { width: 100%; height: 22px; border: none; background: none; }
    `;
    document.head.appendChild(style);
    this._hudStyle = style;

    const presetButtons = this._materials
      .map(
        (spec, i) =>
          `<button id="st43Preset${i}" class="btn-preset" title="${spec.name} (Key ${i + 1})">${i + 1} · ${spec.name}</button>`,
      )
      .join("");

    const hud = document.createElement("aside");
    hud.id = "showcase-hud";
    hud.className = "swm-inspector-drawer open";
    hud.innerHTML = `
      <div class="bottom-sheet-grabber"></div>
      <div class="hud-header">
        <div class="hud-title"><span>⚪</span> Material Lab</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="hud-badge">${this.renderer.type}</span>
          <button id="st43BtnClose" class="hud-close-btn" title="Close Panel (Key: I)">✕</button>
        </div>
      </div>
      <div class="hud-body">
        <div class="hud-section">
          <div class="section-title"><span>🎨 Material</span><span style="font-size:9px;color:#64748b;">Keys 1–4 · [ ]</span></div>
          <div class="preset-group four-col" style="margin-bottom:8px;">${presetButtons}</div>
          <div class="hud-row">
            <label for="st43SlRoughness" title="Micro-surface roughness ([ / ])">Roughness</label>
            <input id="st43SlRoughness" type="range" min="0" max="1" step="0.01" />
            <span id="st43ValRoughness" class="val-label"></span>
          </div>
          <div class="hud-row">
            <label for="st43SlMetallic" title="Dielectric (0) to metal (1) (Shift + [ / ])">Metallic</label>
            <input id="st43SlMetallic" type="range" min="0" max="1" step="0.01" />
            <span id="st43ValMetallic" class="val-label"></span>
          </div>
          <div class="hud-row">
            <label for="st43Color">Base Color</label>
            <input id="st43Color" type="color" />
            <span class="val-label"></span>
          </div>
        </div>

        <div class="hud-section">
          <div class="section-title"><span>☀️ Key Light</span><span style="font-size:9px;color:#64748b;">Arrows · Shift = fine</span></div>
          <div class="hud-row">
            <label for="st43SlAzimuth">Azimuth</label>
            <input id="st43SlAzimuth" type="range" min="-180" max="180" step="1" />
            <span id="st43ValAzimuth" class="val-label"></span>
          </div>
          <div class="hud-row">
            <label for="st43SlElevation">Elevation</label>
            <input id="st43SlElevation" type="range" min="${ELEVATION_MIN_DEG}" max="${ELEVATION_MAX_DEG}" step="1" />
            <span id="st43ValElevation" class="val-label"></span>
          </div>
          <div class="hud-row">
            <label for="st43SlKeyIntensity">Intensity</label>
            <input id="st43SlKeyIntensity" type="range" min="0" max="5" step="0.05" />
            <span id="st43ValKeyIntensity" class="val-label"></span>
          </div>
          <div class="hud-row">
            <label for="st43SlAmbient" title="Flat fill light; controls how dark the shadow gets">Ambient</label>
            <input id="st43SlAmbient" type="range" min="0" max="1" step="0.01" />
            <span id="st43ValAmbient" class="val-label"></span>
          </div>
        </div>

        <div class="hud-section">
          <div class="section-title"><span>🧭 Studio</span></div>
          <div class="preset-group two-col">
            <button id="st43BtnIbl" class="btn-preset" title="Image-based lighting (Key E)">E · IBL</button>
            <button id="st43BtnGrid" class="btn-preset" title="1 m grid on the floor (Key G)">G · 1 m Grid</button>
          </div>
          <div class="hud-note">💡 <b>Try Chrome without IBL, then press E:</b> a mirror can only show what surrounds it.</div>
          <button id="st43BtnReset" class="btn-preset" style="width:100%;margin-top:8px;" title="Golden reference state (Key 0)">0 · Reset to Reference</button>
        </div>

        <div class="hud-section hud-keys">
          <kbd>Drag</kbd> orbit · <kbd>Wheel</kbd> zoom · <kbd>R</kbd> camera reset · <kbd>I</kbd> panel
        </div>
      </div>
    `;
    document.body.appendChild(hud);
    this._hud = hud;

    // Keep HUD pointer input away from the window-level orbit input (same as Showcases 39/41/42).
    const stopEvents = [
      "mousedown",
      "mouseup",
      "mousemove",
      "pointerdown",
      "pointerup",
      "pointermove",
      "wheel",
      "touchstart",
      "touchmove",
      "touchend",
      "click",
      "dblclick",
      "contextmenu",
    ];
    for (const eventName of stopEvents) {
      hud.addEventListener(eventName, (e: Event): void => e.stopPropagation(), {
        passive: eventName === "wheel" || eventName === "touchstart" || eventName === "touchmove",
      });
    }

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "swm-inspector-btn active";
    toggleBtn.innerHTML = "<span>⚙</span>";
    toggleBtn.title = "Material Lab (Toggle, Key: I)";
    toggleBtn.setAttribute("aria-label", "Toggle Material Lab");
    toggleBtn.onclick = (): void => this._toggleHud();
    (document.querySelector(".app-footer") ?? document.body).appendChild(toggleBtn);
    this._hudToggleBtn = toggleBtn;

    document
      .getElementById("st43BtnClose")
      ?.addEventListener("click", () => this._toggleHud(false));
    for (let i = 0; i < this._materials.length; i++) {
      document
        .getElementById(`st43Preset${i}`)
        ?.addEventListener("click", () => this._applyPreset(i));
    }
    document
      .getElementById("st43BtnIbl")
      ?.addEventListener("click", () => this._setIbl(!this._iblEnabled));
    document
      .getElementById("st43BtnGrid")
      ?.addEventListener("click", () => this._setGridVisible(!this._gridVisible));
    document
      .getElementById("st43BtnReset")
      ?.addEventListener("click", () => this._resetToReference());

    this._bindSlider("Roughness", (value) => {
      if (this._ballMaterial) this._ballMaterial.roughness = value;
      this._presetIndex = CUSTOM_PRESET;
    });
    this._bindSlider("Metallic", (value) => {
      if (this._ballMaterial) this._ballMaterial.metallic = value;
      this._presetIndex = CUSTOM_PRESET;
    });
    this._bindSlider("Azimuth", (value) => {
      this._azimuthDeg = value;
      this._applyLightAngles();
    });
    this._bindSlider("Elevation", (value) => {
      this._elevationDeg = value;
      this._applyLightAngles();
    });
    this._bindSlider("KeyIntensity", (value) => {
      if (this._key) this._key.intensity = value;
    });
    this._bindSlider("Ambient", (value) => {
      if (this._ambient) this._ambient.intensity = value;
    });

    const colorInput = document.getElementById("st43Color") as HTMLInputElement | null;
    colorInput?.addEventListener("input", (): void => {
      this._ballMaterial?.color.copyFrom(Color.fromHex(colorInput.value));
      this._presetIndex = CUSTOM_PRESET;
      this._syncHud();
    });
    colorInput?.addEventListener("change", (): void => colorInput.blur());

    this._syncHud();
  }
}

// === START THE ENGINE ===
const app = new Showcase43();
app.start().catch((err: unknown) => console.error("[Showcase43] Failed to start:", err));
