import {
  AmbientLight,
  DirectionalLight,
  Color,
  Plane,
  Object3D,
  PointLight,
  BasicMaterial,
  StandardMaterial,
  Texture,
  RendererType,
  Vector3D,
  StageMovementBehavior,
  StageZone,
} from "@small-world-machine/engine";
import { AbstractShowcase } from "@small-world-machine/engine/core/index.js";
import { attachDevTools } from "@small-world-machine/tools";
import { ViennaMapModal } from "../../ui/ViennaMapModal.js";
import { PlayerRig } from "../shared/PlayerRig.js";
import type { PlayerRigType } from "../shared/PlayerRig.js";

/** The background plane's world extent -- the only place a (u, v) stage coordinate is ever
 * turned into a 3D position. Fed directly into `StageMovementBehavior`'s `"flat-plane"`
 * `projection` (see `StageProjection`). */
const BACKGROUND_WIDTH = 16;
const BACKGROUND_HEIGHT = 9;
const BACKGROUND_CENTER_Y = 4.5;
const BACKGROUND_Z = 0;

/** Scroll-wheel zoom range for the otherwise-fixed camera -- a straight dolly along its own Z
 * axis (see `setupScene()`'s camera comment), clamped so it can never cross the background plane
 * (`BACKGROUND_Z = 0`) or pull back further than the original framing the art was composed for. */
const CAMERA_DEFAULT_Z = 10.864;
const CAMERA_MIN_Z = 3.5;
const CAMERA_MAX_Z = CAMERA_DEFAULT_Z;

/** Single source of truth for each zone's default 4 corner points, in image-space (u, v) --
 * traced directly on the background art via the editor (key `E`). Used both to build the zones
 * in `setupScene()` and to restore them in `_resetToDefaultZones()`, so a coordinate only ever
 * needs to be edited in one place. */
type ZonePoint = { u: number; v: number; scale: number };
const DEFAULT_ZONE_POINTS: Record<
  "zone_a" | "zone_b" | "zone_c",
  [ZonePoint, ZonePoint, ZonePoint, ZonePoint]
> = {
  zone_a: [
    { u: 0.459, v: 0.895, scale: 1.0 },
    { u: 0.825, v: 0.893, scale: 1.0 },
    { u: 0.774, v: 0.82, scale: 1.0 },
    { u: 0.509, v: 0.823, scale: 1.0 },
  ],
  zone_b: [
    { u: 0.556, v: 0.822, scale: 1.0 },
    { u: 0.747, v: 0.819, scale: 1.0 },
    { u: 0.706, v: 0.725, scale: 0.3 },
    { u: 0.641, v: 0.725, scale: 0.3 },
  ],
  zone_c: [
    { u: 0.463, v: 0.894, scale: 1.0 },
    { u: 0.51, v: 0.823, scale: 1.0 },
    { u: 0.357, v: 0.594, scale: 0.5 },
    // P3 (far-left corner) was traced past the painted stairs' actual left edge, into the
    // shadow beside them -- measured directly against the art on 2026-09-11 (see
    // .agents/notes/backlog.md), the real left edge sits at u≈0.305 at this depth, not 0.278.
    { u: 0.305, v: 0.613, scale: 0.5 },
  ],
};

/** [SHIFT]+[Left]/[Right] manually spins the character in place (radians/second), same idea as
 * character-diorama's arrow-key rotation -- lets the player (or a dev checking the self-occlusion
 * angle documented in `.agents/notes/backlog.md`) look at the figure from any angle. Plain
 * (un-shifted) arrows already strafe-move the character via `StageMovementBehavior`, so this only
 * ever engages while Shift is held, and disables that behavior for the duration to avoid the two
 * controls fighting over `rotation.y`. */
const MANUAL_ROTATE_SPEED = 1.5;

/** Character-tag texts per skin (the rig itself is clip/character-agnostic -- see
 * `scenes/shared/PlayerRig.ts`). Sent to `rightDesc`-style HUD on each switch. */
const CHARACTER_DESC: Record<PlayerRigType, string> = {
  male: "Spieler (Männlich) auf der 2.5D-Bühne",
  female: "Spielerin (Weiblich) auf der 2.5D-Bühne",
  yoshi: "🦖 Yoshi (Secret Easter Egg) auf der 2.5D-Bühne",
};

class AndNowScene2 extends AbstractShowcase {
  /** Shared player rig owning every character/clip/lantern/crossfade concern -- see
   * `scenes/shared/PlayerRig.ts`. Reads through `root`/`movementBehavior`/`currentType` etc. */
  private _playerRig: PlayerRig | undefined;
  private _pointLight!: PointLight;
  private _idleTimer: number = 0;
  private _idleVariation: "idle_1" | "idle_2" = "idle_1";
  private _idleSwitchDuration: number = 8.0;
  private _zoneBadgeEl: HTMLElement | null = null;
  private _charDescEl: HTMLElement | null = null;
  private _lastCState: boolean = false;
  private _lastEState: boolean = false;
  private _lastLState: boolean = false;
  private _lastNState: boolean = false;

  // Editor State
  private _editorActive: boolean = false;
  private _activeZoneIndex: number | null = 1; // Default to Zone B (Tunnel)
  private _visibleZones: Set<number> = new Set([0, 1, 2]); // All zones visible by default
  private _stageZones: StageZone[] = [];
  private _draggingHandleIdx: number | null = null;

  // DOM Elements
  private _editorSvg!: SVGElement | null;
  private _editorPanel!: HTMLElement | null;
  private _editorPolygonsGroup!: SVGGElement | null;
  private _editorHandlesGroup!: SVGGElement | null;
  private _pointsListEl!: HTMLElement | null;
  private _charTagEl!: HTMLElement | null;
  private _tagTitleEl!: HTMLElement | null;
  private _tagDetailsEl!: HTMLElement | null;
  private _mapModal!: ViennaMapModal;

  public get mapModal(): ViennaMapModal {
    return this._mapModal;
  }

  protected override async setupScene(): Promise<void> {
    this._mapModal = new ViennaMapModal("flakturm_arenberg");
    this._zoneBadgeEl = document.getElementById("zoneBadge");
    this._charDescEl = document.getElementById("charDesc");
    this._editorSvg = document.getElementById("editorSvgOverlay") as unknown as SVGElement;
    this._editorPanel = document.getElementById("editorPanel");
    this._editorPolygonsGroup = document.getElementById(
      "editorPolygonsGroup",
    ) as unknown as SVGGElement;
    this._editorHandlesGroup = document.getElementById("editorHandles") as unknown as SVGGElement;
    this._pointsListEl = document.getElementById("pointsList");

    // A level, centered camera: it never rotates or pans, and is never involved in zone
    // authoring or movement logic (see StageZone / StageMovementBehavior's "flat-plane"
    // projection below) --
    // scroll-wheel zoom (dolly straight along this same Z axis, see the "wheel" listener below)
    // is the only camera movement allowed, so the background plane and the 3D character always
    // stay in the same relative framing the art was painted for, just closer or farther.
    this.camera.position.set(0, BACKGROUND_CENTER_Y, CAMERA_DEFAULT_Z);
    this.camera.target.set(0, BACKGROUND_CENTER_Y, 0);
    this.camera.updateViewMatrix();

    const ambient = new AmbientLight({ color: new Color(1, 1, 1), intensity: 1.0 });
    this.scene.add(ambient);

    const dirLight = new DirectionalLight({
      direction: new Vector3D(0.2, -0.8, -1.0),
      color: new Color(1, 0.95, 0.9),
      intensity: 2.0,
    });
    this.scene.add(dirLight);

    this._pointLight = new PointLight({
      color: new Color(1, 0.7, 0.5),
      intensity: 10,
      distance: 30,
    });
    this._pointLight.position.set(0, BACKGROUND_CENTER_Y, 4);
    this.scene.add(this._pointLight);
    // Reparented onto Novotny's hand bone once the mannequin has loaded below -- this fallback
    // position only lights the scene if that load fails.

    let bgTex: Texture | undefined;
    try {
      bgTex = await Texture.fromUrl("/assets/the-whisper/flakturm_bg.webp", { flipY: true });
    } catch (e) {
      console.warn("[AndNowScene2] Konnte Hintergrund nicht laden:", e);
    }

    const bgGeo = new Plane({
      width: BACKGROUND_WIDTH,
      height: BACKGROUND_HEIGHT,
    }).getGeometryData();
    const bgMat = new BasicMaterial({ color: new Color(1, 1, 1) });
    bgMat.depthWrite = false;
    if (bgTex) {
      bgMat.diffuseMap = bgTex;
    }

    const background = new Object3D("Background");
    background.geometry = bgGeo;
    background.material = bgMat;
    background.position.set(0, BACKGROUND_CENTER_Y, BACKGROUND_Z);
    this.scene.add(background);

    // --- 2.5D Bühnen-Zonen (in Bild-Koordinaten, u/v 0..1) ---
    // Direkt im Editor (Taste E) auf dem Bild nachgezogen.
    const zoneA = new StageZone({
      id: "zone_a",
      name: "ZONE A: HAUPTBÜHNE (VORPLATZ)",
      points: DEFAULT_ZONE_POINTS.zone_a,
    });

    const zoneB = new StageZone({
      id: "zone_b",
      name: "ZONE B: TUNNELGANG (TIEFE)",
      points: DEFAULT_ZONE_POINTS.zone_b,
    });

    const zoneC = new StageZone({
      id: "zone_c",
      name: "ZONE C: TREPPENAUFGANG (SCHLEUSE)",
      points: DEFAULT_ZONE_POINTS.zone_c,
    });

    this._stageZones = [zoneA, zoneB, zoneC];

    const charParam =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("char")
        : null;
    const initialChar: PlayerRigType =
      charParam === "female" ? "female" : charParam === "yoshi" ? "yoshi" : "male";

    this._buildPlayerRig();
    await this._playerRig!.switchCharacter(initialChar);

    this._setupEditorEvents();
  }

  /** Builds the shared player rig with this scene's per-scene settings (scales, the movement
   *  factory bound to the tunnel zones, the material pass, the lantern light). Everything else --
   *  clip pool, crossfade, lantern hand-bone sync, character switching -- lives in `PlayerRig`
   *  and is identical across the dusk scenes. */
  private _buildPlayerRig(): void {
    this._playerRig = new PlayerRig({
      parent: this.scene.root,
      lanternParent: this.scene.root,
      input: this.input,
      defaultStartUV: { u: 0.65, v: 0.85 },
      characters: {
        male: {
          url: "/assets/the-whisper/mannequin/player-male/character.glb",
          scale: 1.8,
        },
        female: {
          url: "/assets/the-whisper/mannequin/player-female/character.glb",
          scale: 1.8,
        },
        yoshi: {
          url: "/assets/the-whisper/mannequin/yoshi/character.glb",
          scale: 1.35,
        },
      },
      lanternLight: this._pointLight,
      adjustMaterials: (player: Object3D): void => {
        // The tunnel renders the mannequin against a painted backdrop, so the flat unlit
        // BasicMaterial was switched to StandardMaterial (matching the diorama's look) so the
        // figure responds to scene light; roughness/metallic tuned the same way as the diorama's
        // matte cloth-and-skin pass -- but implemented as a full material replacement, preserving
        // any diffuse texture, which is this scene's own flavor.
        const applyMaterialToHierarchy = (obj: Object3D): void => {
          if (obj.material) {
            const sMat = new StandardMaterial({ color: new Color(1, 1, 1) });
            if ("diffuseMap" in obj.material && obj.material.diffuseMap instanceof Texture) {
              sMat.diffuseMap = obj.material.diffuseMap;
            }
            sMat.roughness = 0.92;
            sMat.metallic = 0.02;
            obj.material = sMat;
          }
          for (const child of obj.children) {
            applyMaterialToHierarchy(child);
          }
        };
        applyMaterialToHierarchy(player);
      },
      createMovementBehavior: (startUv): StageMovementBehavior =>
        new StageMovementBehavior({
          input: this.input,
          speed: 0.09,
          runMultiplier: 2.2,
          rotationSpeed: 12.0,
          // convention -- confirmed live: rotation.y = 270° faces screen-left, 90° faces
          // screen-right, 180° faces into the tunnel (depth), and 0° faces the camera.
          facingOffset: Math.PI,
          startFacing: "back",
          // The camera here is fixed and never orbits (unlike character-diorama's free
          // OrbitController), so "facing back" landing the stance dead-on in line with the camera
          // would self-occlude one leg behind the other on every single session start -- see
          // .agents/notes/backlog.md's 2026-09-10 entry. A small nudge off that exact axis avoids
          // it without changing the intended starting orientation.
          startFacingNudge: 0.14, // ~8 degrees
          zones: this._stageZones,
          projection: {
            mode: "flat-plane",
            width: BACKGROUND_WIDTH,
            height: BACKGROUND_HEIGHT,
            z: BACKGROUND_Z,
            centerY: BACKGROUND_CENTER_Y,
          },
          startUV: startUv,
          onZoneChange: (zone: StageZone): void => {
            this._updateHUD(zone);
            this._syncActiveAnimation();
          },
          onStateChange: (_state: "IDLE" | "WALK" | "RUN"): void => {
            this._syncActiveAnimation();
          },
        }),
      onCharacterReady: (type: PlayerRigType): void => {
        if (this._charDescEl) {
          this._charDescEl.textContent = CHARACTER_DESC[type];
        }
        this._syncActiveAnimation(0);
      },
    });
  }

  /** Screen-space rectangle the background image currently occupies, recomputed each time the
   * editor needs it (cheap: 2 projections) so it stays correct across window resizes. */
  private _backgroundScreenRect(): { left: number; top: number; width: number; height: number } {
    const topLeft = this._worldToScreen(
      -BACKGROUND_WIDTH / 2,
      BACKGROUND_CENTER_Y + BACKGROUND_HEIGHT / 2,
      BACKGROUND_Z,
    );
    const bottomRight = this._worldToScreen(
      BACKGROUND_WIDTH / 2,
      BACKGROUND_CENTER_Y - BACKGROUND_HEIGHT / 2,
      BACKGROUND_Z,
    );
    return {
      left: topLeft.x,
      top: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }

  private _worldToScreen(wx: number, wy: number, wz: number): { x: number; y: number } {
    const vp = this.camera.viewProjectionMatrix;
    const cx = (vp[0] ?? 0) * wx + (vp[4] ?? 0) * wy + (vp[8] ?? 0) * wz + (vp[12] ?? 0);
    const cy = (vp[1] ?? 0) * wx + (vp[5] ?? 0) * wy + (vp[9] ?? 0) * wz + (vp[13] ?? 0);
    const cw = (vp[3] ?? 0) * wx + (vp[7] ?? 0) * wy + (vp[11] ?? 0) * wz + (vp[15] ?? 0);
    const w = cw !== 0 ? cw : 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    return {
      x: ((cx / w) * 0.5 + 0.5) * width,
      y: (-(cy / w) * 0.5 + 0.5) * height,
    };
  }

  private _uvToScreen(
    u: number,
    v: number,
    rect: { left: number; top: number; width: number; height: number },
  ): { x: number; y: number } {
    return { x: rect.left + u * rect.width, y: rect.top + v * rect.height };
  }

  private _screenToUv(
    sx: number,
    sy: number,
    rect: { left: number; top: number; width: number; height: number },
  ): { u: number; v: number } {
    return { u: (sx - rect.left) / rect.width, v: (sy - rect.top) / rect.height };
  }

  private _resetToDefaultZones(): void {
    if (this._stageZones.length < 3) return;

    const ids = ["zone_a", "zone_b", "zone_c"] as const;
    for (let i = 0; i < ids.length; i++) {
      const defaults = DEFAULT_ZONE_POINTS[ids[i]!];
      const zone = this._stageZones[i]!;
      for (let p = 0; p < 4; p++) {
        // Clone rather than share the reference -- the editor mutates a point's `u`/`v`/`scale`
        // in place (drag handles, the scale input), which would otherwise corrupt
        // `DEFAULT_ZONE_POINTS` itself for every future reset.
        zone.points[p] = { ...defaults[p]! };
      }
    }
  }

  private _setupEditorEvents(): void {
    this._charTagEl = document.getElementById("characterTag");
    this._tagTitleEl = document.getElementById("tagTitle");
    this._tagDetailsEl = document.getElementById("tagDetails");

    const btnA = document.getElementById("btnZoneA");
    const btnB = document.getElementById("btnZoneB");
    const btnC = document.getElementById("btnZoneC");
    const resetBtn = document.getElementById("resetConfigBtn");
    const copyBtn = document.getElementById("copyConfigBtn");

    const toggleZone = (idx: number): void => {
      if (this._visibleZones.has(idx) && this._activeZoneIndex === idx) {
        this._visibleZones.delete(idx);
        this._activeZoneIndex = null;
      } else {
        this._visibleZones.add(idx);
        this._activeZoneIndex = idx;
      }
      this._updateEditorUI();
    };

    btnA?.addEventListener("click", () => toggleZone(0));
    btnB?.addEventListener("click", () => toggleZone(1));
    btnC?.addEventListener("click", () => toggleZone(2));

    resetBtn?.addEventListener("click", () => {
      this._resetToDefaultZones();
      this._updateEditorUI();
    });

    copyBtn?.addEventListener("click", () => {
      const exportText = this._generateExportConfig();
      navigator.clipboard.writeText(exportText).then(() => {
        if (copyBtn) {
          const orig = copyBtn.textContent;
          copyBtn.textContent = "✅ Kopiert!";
          setTimeout(() => (copyBtn.textContent = orig), 2000);
        }
      });
    });

    // Handle Dragging -- direct pixel <-> (u, v) conversion, no camera involved.
    window.addEventListener("pointerdown", (e) => {
      if (!this._editorActive) return;
      const target = e.target as SVGElement;
      if (target && target.classList.contains("handle-circle")) {
        const idx = parseInt(target.getAttribute("data-idx") || "-1", 10);
        if (idx >= 0) {
          this._draggingHandleIdx = idx;
          target.classList.add("active");
        }
      }
    });

    window.addEventListener("pointermove", (e) => {
      if (!this._editorActive || this._draggingHandleIdx === null || this._activeZoneIndex === null)
        return;
      const activeZone = this._stageZones[this._activeZoneIndex];
      if (!activeZone) return;

      const pt = activeZone.points[this._draggingHandleIdx];
      if (!pt) return;

      const rect = this._backgroundScreenRect();
      const { u, v } = this._screenToUv(e.clientX, e.clientY, rect);
      pt.u = u;
      pt.v = v;

      this._updateEditorUI();
    });

    window.addEventListener("pointerup", () => {
      this._draggingHandleIdx = null;
      document.querySelectorAll(".handle-circle").forEach((c) => c.classList.remove("active"));
    });

    // Mouse-wheel zoom: a straight dolly along the camera's own (never-rotated) Z axis -- see
    // `CAMERA_MIN_Z`/`CAMERA_MAX_Z` and the camera setup comment in `setupScene()`. Deliberately
    // NOT routed through the editor's drag handling above; zoom works whether the stage editor is
    // open or not.
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const z = this.camera.position.z + e.deltaY * 0.01;
        this.camera.position.z = Math.min(CAMERA_MAX_Z, Math.max(CAMERA_MIN_Z, z));
        this.camera.updateViewMatrix();
      },
      { passive: false },
    );
  }

  private _updateEditorUI(): void {
    if (!this._editorActive || !this._editorPolygonsGroup || !this._editorHandlesGroup) return;

    const btnA = document.getElementById("btnZoneA");
    const btnB = document.getElementById("btnZoneB");
    const btnC = document.getElementById("btnZoneC");
    [btnA, btnB, btnC].forEach((b, i) => {
      b?.classList.toggle("active", this._visibleZones.has(i));
    });

    const zoneColors = [
      {
        stroke: "#38bdf8",
        fill: "rgba(56, 189, 248, 0.20)",
        activeFill: "rgba(56, 189, 248, 0.40)",
      }, // A: Vorplatz (Cyan)
      {
        stroke: "#4ade80",
        fill: "rgba(74, 222, 128, 0.20)",
        activeFill: "rgba(74, 222, 128, 0.40)",
      }, // B: Tunnel (Green)
      {
        stroke: "#fbbf24",
        fill: "rgba(251, 191, 36, 0.20)",
        activeFill: "rgba(251, 191, 36, 0.40)",
      }, // C: Treppe (Gold)
    ];

    const rect = this._backgroundScreenRect();

    let polygonsHtml = "";
    this._stageZones.forEach((z, zIdx) => {
      if (!this._visibleZones.has(zIdx)) return;

      const screenPoints = z.points.map((p) => this._uvToScreen(p.u, p.v, rect));
      const ptsStr = screenPoints.map((sp) => `${sp.x},${sp.y}`).join(" ");
      const color = zoneColors[zIdx] ?? {
        stroke: "#fff",
        fill: "rgba(255,255,255,0.2)",
        activeFill: "rgba(255,255,255,0.4)",
      };
      const isActive = zIdx === this._activeZoneIndex;

      polygonsHtml += `
        <polygon points="${ptsStr}"
          style="fill: ${isActive ? color.activeFill : color.fill}; stroke: ${color.stroke}; stroke-width: ${isActive ? "2.5px" : "1.5px"}; stroke-dasharray: ${isActive ? "none" : "4"}; cursor: pointer; pointer-events: all;"
          data-zidx="${zIdx}"
        />
      `;
    });
    this._editorPolygonsGroup.innerHTML = polygonsHtml;

    this._editorPolygonsGroup.querySelectorAll("polygon").forEach((poly) => {
      poly.addEventListener("click", (e) => {
        const zidx = parseInt(
          (e.target as SVGPolygonElement).getAttribute("data-zidx") || "-1",
          10,
        );
        if (zidx >= 0) {
          this._activeZoneIndex = zidx;
          this._visibleZones.add(zidx);
          this._updateEditorUI();
        }
      });
    });

    const activeZone =
      this._activeZoneIndex !== null && this._visibleZones.has(this._activeZoneIndex)
        ? this._stageZones[this._activeZoneIndex]
        : null;

    if (!activeZone || this._activeZoneIndex === null) {
      this._editorHandlesGroup.innerHTML = "";
      if (this._pointsListEl) {
        this._pointsListEl.innerHTML = `
          <div style="color: #888; font-size: 11px; text-align: center; padding: 16px 8px; border: 1px dashed rgba(255,255,255,0.15); border-radius: 4px;">
            Keine Zone aktiv.<br>Klicke oben auf <strong>A</strong>, <strong>B</strong> oder <strong>C</strong>, um eine Zone einzuschalten.
          </div>
        `;
      }
      return;
    }

    const activeColor = zoneColors[this._activeZoneIndex] ?? { stroke: "#ffb84d" };
    const screenPoints = activeZone.points.map((p) => this._uvToScreen(p.u, p.v, rect));

    let handlesHtml = "";
    const labels = ["P0", "P1", "P2", "P3"];
    screenPoints.forEach((sp, i) => {
      handlesHtml += `
        <circle cx="${sp.x}" cy="${sp.y}" r="8" class="handle-circle" data-idx="${i}" style="fill: ${activeColor.stroke}; stroke: #fff;"></circle>
        <text x="${sp.x + 12}" y="${sp.y + 4}" class="handle-label">${labels[i]}</text>
      `;
    });
    this._editorHandlesGroup.innerHTML = handlesHtml;

    if (this._pointsListEl) {
      let listHtml = "";
      activeZone.points.forEach((p, i) => {
        listHtml += `
          <div class="point-row" style="margin-bottom: 6px; font-size: 11px;">
            <span><strong>${labels[i]}</strong></span>
            <div class="point-coords" style="display: flex; gap: 4px; align-items: center; margin-top: 2px;">
              <span>U:${p.u.toFixed(3)} V:${p.v.toFixed(3)}</span>
              <span>S:<input type="number" step="0.05" min="0.1" max="2.0" value="${p.scale.toFixed(2)}" data-sidx="${i}" class="point-scale-input" style="width: 44px; background: #1a232f; color: #88c0d0; border: 1px solid rgba(136,192,208,0.4); border-radius: 3px; padding: 1px 2px; font-family: monospace; font-size: 10px;"></span>
            </div>
          </div>
        `;
      });
      this._pointsListEl.innerHTML = listHtml;

      this._pointsListEl.querySelectorAll<HTMLInputElement>(".point-scale-input").forEach((inp) => {
        inp.addEventListener("change", (e) => {
          const target = e.target as HTMLInputElement;
          const sidx = parseInt(target.getAttribute("data-sidx") || "-1", 10);
          if (sidx >= 0 && activeZone.points[sidx]) {
            activeZone.points[sidx]!.scale = parseFloat(target.value) || 1.0;
            this._updateEditorUI();
          }
        });
      });
    }
  }

  private _generateExportConfig(): string {
    return this._stageZones
      .map(
        (z) =>
          `new StageZone({\n  id: "${z.id}",\n  name: "${z.name}",\n  points: [\n` +
          z.points
            .map(
              (p) =>
                `    { u: ${p.u.toFixed(3)}, v: ${p.v.toFixed(3)}, scale: ${p.scale.toFixed(2)} },`,
            )
            .join("\n") +
          `\n  ],\n})`,
      )
      .join(",\n\n");
  }

  private _updateHUD(zone: StageZone): void {
    if (!this._zoneBadgeEl) return;
    this._zoneBadgeEl.textContent = zone.name;
  }

  /** Ermittelt anhand von Bewegungsstatus (IDLE, WALK, RUN), Laternenzustand
   * und aktiver Zone (z. B. Treppe Auf/Ab) die exakt passende Animation. */
  private _resolveDesiredAnimation(): string {
    const movement = this._playerRig?.movementBehavior;
    const state = movement?.state ?? "IDLE";
    const zone = movement?.activeZone;
    const isStairs = zone?.id === "zone_c";
    const isLantern = this._playerRig?.lanternEnabled ?? true;

    if (state === "IDLE") {
      return isLantern ? "idle_torch" : this._idleVariation;
    }

    if (isStairs) {
      const isMovingDown = (movement?.moveForward ?? 0) < 0;
      return isMovingDown ? "stairs_down" : "stairs_up";
    }

    if (state === "RUN") {
      return isLantern ? "run_torch" : "run_1";
    }

    // state === "WALK"
    return isLantern ? "walk_torch" : "walk";
  }

  private _syncActiveAnimation(fadeSeconds?: number): void {
    const anim = this._resolveDesiredAnimation();
    this._playerRig?.play(anim, fadeSeconds !== undefined ? { fadeSeconds } : undefined);
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);
    this.camera.updateViewMatrix();

    // Toggle Editor mit Taste 'E'
    const isEPressed = this.input.isPressed("KeyE");
    if (isEPressed && !this._lastEState) {
      this._editorActive = !this._editorActive;
      if (this._editorSvg) this._editorSvg.style.display = this._editorActive ? "block" : "none";
      if (this._editorPanel)
        this._editorPanel.style.display = this._editorActive ? "block" : "none";
      const movement = this._playerRig?.movementBehavior;
      if (movement) movement.enabled = !this._editorActive;
      if (this._editorActive) this._updateEditorUI();
    }
    this._lastEState = isEPressed;

    // [SHIFT]+[Left]/[Right]: manual in-place rotation (see MANUAL_ROTATE_SPEED doc comment).
    // Takes priority over normal movement while held -- StageMovementBehavior gets disabled for
    // the duration and re-enabled the moment neither is held anymore, unless the stage editor
    // already has it disabled for its own reasons.
    const isShiftHeld = this.input.isPressed("ShiftLeft") || this.input.isPressed("ShiftRight");
    const rotateLeftHeld = isShiftHeld && this.input.isPressed("ArrowLeft");
    const rotateRightHeld = isShiftHeld && this.input.isPressed("ArrowRight");
    const rigRoot = this._playerRig?.root;
    const movement = this._playerRig?.movementBehavior;
    if (rigRoot && (rotateLeftHeld || rotateRightHeld)) {
      if (movement) movement.enabled = false;
      if (rotateLeftHeld) rigRoot.rotation.y -= deltaTime * MANUAL_ROTATE_SPEED;
      if (rotateRightHeld) rigRoot.rotation.y += deltaTime * MANUAL_ROTATE_SPEED;
    } else if (movement && !this._editorActive) {
      movement.enabled = true;
    }

    // Toggle Laterne mit Taste 'L' -- Mesh und Punktlicht hängen beide im Shared Rig an der
    // Hand-Bone, also reicht ein gemeinsames isVisible statt separater An/Aus-Logik pro Teil.
    const isLPressed = this.input.isPressed("KeyL");
    if (isLPressed && !this._lastLState) {
      if (this._playerRig) this._playerRig.setLanternEnabled(!this._playerRig.lanternEnabled);
      this._syncActiveAnimation();
    }
    this._lastLState = isLPressed;

    // Toggle Graphic Noir / Sin-City Chiaroscuro Modus mit Taste 'N'
    const isNPressed = this.input.isPressed("KeyN");
    if (isNPressed && !this._lastNState) {
      if (this.renderer.postProcessing.enabled && this.renderer.postProcessing.filterMode === 2) {
        this.renderer.postProcessing.enabled = false;
        this.renderer.postProcessing.filterMode = 0;
      } else {
        this.renderer.postProcessing.enabled = true;
        this.renderer.postProcessing.filterMode = 2;
      }
    }
    this._lastNState = isNPressed;

    // Idle-Variations-Timer (Wechsel zwischen idle_1 und idle_2 bei inaktiver Laterne)
    const movementState = this._playerRig?.movementBehavior?.state;
    if (movementState === "IDLE" && !this._playerRig?.lanternEnabled) {
      this._idleTimer += deltaTime;
      if (this._idleTimer >= this._idleSwitchDuration) {
        this._idleTimer = 0;
        this._idleVariation = this._idleVariation === "idle_1" ? "idle_2" : "idle_1";
        this._idleSwitchDuration =
          this._idleVariation === "idle_2" ? 3.5 : 7.0 + Math.random() * 5.0;
        this._syncActiveAnimation(0.4);
      }
    } else {
      this._idleTimer = 0;
      this._idleVariation = "idle_1";
    }

    // Toggle Charakter mit Taste 'C' (Männlich -> Weiblich -> Yoshi -> Männlich). Der Shared Rig
    // selbst ist re-entrancy-geguaranteed (ein schnelles Doppel-C erzeugt nie zwei Spieler) und
    // propagiert Ladefehler -- fail fast, genau einmal hier gefangen.
    const isCPressed = this.input.isPressed("KeyC");
    if (isCPressed && !this._lastCState) {
      const current = this._playerRig?.currentType ?? "male";
      const nextChar: PlayerRigType =
        current === "male" ? "female" : current === "female" ? "yoshi" : "male";
      this._playerRig
        ?.switchCharacter(nextChar)
        .catch((err: unknown) =>
          console.error("[AndNowScene2] Fehler beim Charakterwechsel:", err),
        );
    }
    this._lastCState = isCPressed;

    if (this._editorActive) {
      this._updateEditorUI();
    }

    // Clip crossfade, Animation-Playback und Laternen-Sync leben im Shared Rig.
    this._playerRig?.update(deltaTime);

    // Status-Anzeige der Spielfigur -- fix am oberen Bildschirmrand (CSS in index.html), folgt
    // der Figur bewusst NICHT mehr über die Bühne (verdeckte sie sonst z.B. weit oben auf der
    // Treppe, wo die Figur ohnehin schon klein ist).
    if (this._playerRig && this._charTagEl && this._tagTitleEl && this._tagDetailsEl) {
      this._charTagEl.style.display = "block";

      const rig = this._playerRig;
      const activeAnimation = rig.activeAnimation;
      const activeClip = activeAnimation ? rig.clips.get(activeAnimation) : undefined;
      const mixer = rig.mixer;
      const action = activeClip && mixer ? mixer.clipAction(activeClip) : undefined;
      const timeStr = action ? action.time.toFixed(2) : "0.00";

      // Orientierung / Blickrichtung berechnen (0..360 Grad)
      // Visual convention: 270° = Links, 90° = Rechts, 180° = Hinten, 0° = Vorne
      const rawDeg = ((rig.root.rotation.y * 180) / Math.PI) % 360;
      const deg = (rawDeg + 360) % 360;
      let dirName: string;
      if (deg >= 157.5 && deg < 202.5) dirName = "⬆️ HINTEN";
      else if (deg >= 112.5 && deg < 157.5) dirName = "↗️ HINTEN-RECHTS";
      else if (deg >= 67.5 && deg < 112.5) dirName = "➡️ RECHTS";
      else if (deg >= 22.5 && deg < 67.5) dirName = "↘️ VORNE-RECHTS";
      else if (deg >= 337.5 || deg < 22.5) dirName = "⬇️ VORNE (zur Kamera)";
      else if (deg >= 292.5 && deg < 337.5) dirName = "↙️ VORNE-LINKS";
      else if (deg >= 247.5 && deg < 292.5) dirName = "⬅️ LINKS";
      else dirName = "↖️ HINTEN-LINKS";

      // (u,v) und Skalierung: dieselben Werte, die bisher nur per Konsole (StageMovementBehavior.uv /
      // StageZone.getScaleAt) auslesbar waren -- live sichtbar spart genau die manuelle
      // Nachmess-Arbeit aus der Zonen-Verifikation (siehe .agents/notes/backlog.md, Treppen-Fix).
      const movement = rig.movementBehavior;
      const uv = movement?.uv;
      const activeZone = movement?.activeZone;
      const scaleAtUv = uv && activeZone ? activeZone.getScaleAt(uv.u, uv.v) : undefined;
      const uvStr = uv ? `u:${uv.u.toFixed(3)} v:${uv.v.toFixed(3)}` : "--";
      const scaleStr = scaleAtUv !== undefined ? scaleAtUv.toFixed(3) : "--";

      this._tagTitleEl.textContent = `[${rig.currentType.toUpperCase()}] ▶ ${activeAnimation ?? "none"} (t=${timeStr}s)`;
      this._tagDetailsEl.innerHTML = `
        Blickrichtung: <b style="color:#38bdf8;">${dirName} (${deg.toFixed(0)}°)</b><br>
        State: <b style="color:#fff;">${movement?.state ?? "IDLE"}</b> | Zone: <b style="color:#fff;">${activeZone?.id ?? "none"}</b><br>
        Position: <b style="color:#7dd3fc;">${uvStr}</b> | Skalierung: <b style="color:#7dd3fc;">${scaleStr}</b><br>
        Laterne: <b style="color:#ffb84d;">${rig.lanternEnabled ? "AN" : "AUS"}</b> (Anatomisch: Links)<br>
        Renderer: <b style="color: #38bdf8;">${this.renderer.type}</b>
      `;
    }
  }
}

const app = new AndNowScene2({
  rendererType: RendererType.BEST,
});
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[AndNowScene2] Failed to start:", err));
