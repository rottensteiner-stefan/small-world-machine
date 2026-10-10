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
  AnimationMixer,
  AnimationClip,
  AnimationAction,
  Vector3D,
  StageMovementBehavior,
  StageZone,
  MathPool,
} from "@small-world-machine/engine";
import { AbstractShowcase } from "@small-world-machine/engine/core/index.js";
import { attachDevTools } from "@small-world-machine/tools";
import { GltfLoader } from "@small-world-machine/engine/loaders/GltfLoader.js";
import { Bone } from "@small-world-machine/engine/core/animation/index.js";
import { ViennaMapModal } from "../../ui/ViennaMapModal.js";
import { BunkerKit } from "../../builder/BunkerKit.js";

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

/** Named animation clips shared by every Player skin. Add an entry here (and load the matching
 * FBX2glTF-converted `.glb` under `public/assets/the-whisper/mannequin/shared/anim/`) to make a new
 * animation available via `_playAnimation`. */
const ANIMATION_CLIP_URLS: Record<string, string> = {
  // Idle variations
  idle_1: "/assets/the-whisper/mannequin/shared/anim/idle_1.glb",
  idle_2: "/assets/the-whisper/mannequin/shared/anim/idle_2.glb",
  idle_torch: "/assets/the-whisper/mannequin/shared/anim/idle_torch.glb",
  // Walk & Run (neutral)
  walk: "/assets/the-whisper/mannequin/shared/anim/walking.glb",
  run_1: "/assets/the-whisper/mannequin/shared/anim/running_1.glb",
  run_2: "/assets/the-whisper/mannequin/shared/anim/running_2.glb",
  // Walk & Run (with lantern / torch)
  walk_torch: "/assets/the-whisper/mannequin/shared/anim/walking_torch.glb",
  run_torch: "/assets/the-whisper/mannequin/shared/anim/running_torch.glb",
  // Stairs
  stairs_up: "/assets/the-whisper/mannequin/shared/anim/ascending_stairs.glb",
  stairs_down: "/assets/the-whisper/mannequin/shared/anim/descending_stairs.glb",
};

const ANIMATION_FADE_SECONDS = 0.25;

/** [SHIFT]+[Left]/[Right] manually spins the character in place (radians/second), same idea as
 * character-diorama's arrow-key rotation -- lets the player (or a dev checking the self-occlusion
 * angle documented in `.agents/notes/backlog.md`) look at the figure from any angle. Plain
 * (un-shifted) arrows already strafe-move the character via `StageMovementBehavior`, so this only
 * ever engages while Shift is held, and disables that behavior for the duration to avoid the two
 * controls fighting over `rotation.y`. */
const MANUAL_ROTATE_SPEED = 1.5;

/** Prioritized candidate bones for left-hand lantern attachment across different rigs */
const LANTERN_HAND_BONE_CANDIDATES = [
  // 1. Finger bones (grip center in palm / fingers)
  "mixamorig:LeftHandMiddle1",
  "mixamorig1:LeftHandMiddle1",
  "mixamorig:LeftHandIndex1",
  "mixamorig1:LeftHandIndex1",
  // 2. Wrist bones (Mixamo fallback)
  "mixamorig:LeftHand",
  "mixamorig1:LeftHand",
  "L_Hand",
  // 3. Tripo / Yoshi bones
  "tripo::0_Left_Limb_2",
  "tripo::0_Left_Limb_3",
];

type CharacterType = "male" | "female" | "yoshi";

interface AnimationFade {
  from: AnimationAction | undefined;
  to: AnimationAction;
  elapsed: number;
  duration: number;
}

class AndNowScene2 extends AbstractShowcase {
  private _player!: Object3D;
  /** Stage anchor that `StageMovementBehavior` positions/scales (forced-perspective per zone).
   * `_player` sits inside it at a fixed 1.8m-real-world-height local scale, so the per-zone
   * scale factor multiplies on top of that instead of replacing it outright. */
  private _playerRig!: Object3D;
  private _movementBehavior!: StageMovementBehavior;
  private _pointLight!: PointLight;
  private _lanternGroup: Object3D | undefined = undefined;
  /** The current character's left-hand bone, tracked (position only, see `_syncLanternTransform()`)
   * rather than used as `_lanternGroup`'s scene-graph parent. */
  private _lanternHandBone: Bone | undefined = undefined;
  private _lanternOn: boolean = true;
  private _mixer?: AnimationMixer;
  private _clips: Map<string, AnimationClip> = new Map();
  private _activeAnimation: string | undefined;
  private _fade: AnimationFade | undefined = undefined;
  private _idleTimer: number = 0;
  private _idleVariation: "idle_1" | "idle_2" = "idle_1";
  private _idleSwitchDuration: number = 8.0;
  private _zoneBadgeEl: HTMLElement | null = null;
  private _charDescEl: HTMLElement | null = null;
  private _characterType: CharacterType = "male";
  private _isSwitchingChar: boolean = false;
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
    const initialChar: CharacterType =
      charParam === "female" ? "female" : charParam === "yoshi" ? "yoshi" : "male";

    await this._loadCharacter(initialChar);

    this._setupEditorEvents();
  }

  /**
   * Lädt die ausgewählte Figur (männlich / weiblich / Yoshi), skaliert sie passend,
   * bindet die Laterne an mixamorig:LeftHand und hängt Behavior & AnimationMixer ein.
   */
  private async _loadCharacter(charType: CharacterType): Promise<void> {
    this._characterType = charType;
    let currentUv = { u: 0.65, v: 0.85 };

    if (this._movementBehavior) {
      currentUv = this._movementBehavior.uv;
    }

    if (this._player) {
      this._playerRig.remove(this._player);
    }
    if (!this._playerRig) {
      this._playerRig = new Object3D("PlayerRig");
      this.scene.add(this._playerRig);
    }

    try {
      const gltfLoader = new GltfLoader();
      let charModelUrl = "/assets/the-whisper/mannequin/player-male/character.glb";
      let charScale = 1.8;
      let descText = "Spieler (Männlich) auf der 2.5D-Bühne";

      if (charType === "female") {
        charModelUrl = "/assets/the-whisper/mannequin/player-female/character.glb";
        charScale = 1.8;
        descText = "Spielerin (Weiblich) auf der 2.5D-Bühne";
      } else if (charType === "yoshi") {
        charModelUrl = "/assets/the-whisper/mannequin/yoshi/character.glb";
        charScale = 1.35;
        descText = "🦖 Yoshi (Secret Easter Egg) auf der 2.5D-Bühne";
      }

      this._player = await gltfLoader.load(charModelUrl);
      this._player.scale.set(charScale, charScale, charScale);

      // 1. Alle Animationen aus dem Mocap-Pool laden
      this._clips.clear();
      for (const [name, url] of Object.entries(ANIMATION_CLIP_URLS)) {
        try {
          const animClips = await gltfLoader.loadAnimations(url);
          const clip = animClips[0];
          if (clip) {
            this._clips.set(name, clip);
          }
        } catch (animErr) {
          console.warn(`[AndNowScene2] Konnte Animation "${name}" nicht laden:`, animErr);
        }
      }
      // Was a flat, unlit BasicMaterial until 2026-09-11: it rendered the diffuse texture as-is
      // but ignored every scene light entirely (AmbientLight/DirectionalLight/the lantern's own
      // PointLight all had zero effect on the character), leaving it a dark silhouette against
      // the painted, already-bright background art no matter how the lights were tuned. Switched
      // to StandardMaterial (matching character-diorama's approach for the same shared model) so
      // the character actually responds to the scene's lighting; roughness/metallic tuned the
      // same way diorama does for a matte, non-shiny cloth-and-skin look.
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
      applyMaterialToHierarchy(this._player);

      this._playerRig.add(this._player);

      // Laterne (Platzhalter-Mesh + Punktlicht) an die Hand-Bone hängen
      let handBone: Bone | undefined;
      for (const boneName of LANTERN_HAND_BONE_CANDIDATES) {
        const found = this._player.getObjectByName(boneName);
        if (found instanceof Bone) {
          handBone = found;
          break;
        }
      }

      this._lanternHandBone = handBone;
      if (handBone) {
        if (!this._lanternGroup) {
          this._lanternGroup = this._buildLanternMesh();
          this._pointLight.position.set(0, -0.16, 0);
          this._lanternGroup.add(this._pointLight);
          // Scene-level sibling, deliberately NOT a child of `handBone` -- see
          // `_syncLanternTransform()`'s doc comment for why.
          this.scene.add(this._lanternGroup);
        }
        this._lanternGroup.isVisible = this._lanternOn;
        this._pointLight.isVisible = this._lanternOn;
      } else {
        console.warn(
          `[AndNowScene2] Hand-Bone nicht gefunden -- Laterne bleibt an fixer Position.`,
        );
      }

      // 2.5D Bühnen-Bewegung an Spieler ankoppeln
      this._movementBehavior = new StageMovementBehavior({
        input: this.input,
        speed: 0.09,
        runMultiplier: 2.2,
        rotationSpeed: 12.0,
        // convention -- confirmed live: rotation.y = 270° faces screen-left, 90° faces screen-right,
        // 180° faces into the tunnel (depth), and 0° faces the camera.
        facingOffset: Math.PI,
        startFacing: "back",
        // The camera here is fixed and never orbits (unlike character-diorama's free OrbitController),
        // so "facing back" landing the stance dead-on in line with the camera would self-occlude one
        // leg behind the other on every single session start, not just as a rare edge case -- see
        // .agents/notes/backlog.md's 2026-09-10 entry. A small nudge off that exact axis avoids it
        // without changing the intended starting orientation.
        startFacingNudge: 0.14, // ~8 degrees
        zones: this._stageZones,
        projection: {
          mode: "flat-plane",
          width: BACKGROUND_WIDTH,
          height: BACKGROUND_HEIGHT,
          z: BACKGROUND_Z,
          centerY: BACKGROUND_CENTER_Y,
        },
        startUV: currentUv,
        onZoneChange: (zone: StageZone): void => {
          this._updateHUD(zone);
          this._syncActiveAnimation();
        },
        onStateChange: (_state: "IDLE" | "WALK" | "RUN"): void => {
          this._syncActiveAnimation();
        },
      });
      this._playerRig.addBehavior(this._movementBehavior);

      if (0 < this._clips.size) {
        this._mixer = new AnimationMixer(this._player);
        this._activeAnimation = undefined;
        this._fade = undefined;
        this._syncActiveAnimation(0);
      }

      if (this._charDescEl) {
        this._charDescEl.textContent = descText;
      }
    } catch (e) {
      console.error("[AndNowScene2] Fehler beim Laden des Charakters:", e);
    }
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

  /** Keeps the lantern's world POSITION locked to the hand bone's grip point every frame, while
   * deliberately NOT parenting it under that bone. Two independent reasons:
   * 1. A hand bone swings through a large rotation arc during walk/idle animation -- a lantern
   *    rigidly rotating with it would tumble around instead of hanging straight down from its
   *    handle, the way a real lantern pivots freely in a gripped hand. Never applying the bone's
   *    rotation to `_lanternGroup.rotation` (left at the identity `_buildLanternMesh()` sets it
   *    to) means it always hangs down, by construction.
   * 2. Mixamo rigs commonly bake a large (e.g. ~100x, a leftover cm-to-m unit conversion) uniform
   *    scale into the skeleton's bones -- the GPU-skinned character mesh never shows it because
   *    its skinning matrices are relative to each bone's *bind pose*
   *    (`bone.worldMatrix * inverseBindMatrix`, see `Skeleton.update()`), which cancels a static
   *    scale factor out. A plain `Object3D` parented directly onto a bone has no such
   *    cancellation and would inherit the raw ~100x bone scale. Not parenting under the bone at
   *    all sidesteps this entirely, rather than compensating for it every frame.
   * This mirrors `GadgetInspector`'s `_objectAxes` gizmo: added to `this._scene` (not the selected
   * object), then synced from the tracked object's world transform every frame instead of being a
   * scene-graph child of it -- here we copy only position, never rotation or scale.
   *
   * Yoshi (an Easter-egg asset, not hand-authored -- Mixamo's automatic auto-rigger) uses this
   * exact same path too. An earlier pass here special-cased him with a fixed by-eye offset,
   * reasoning his auto-placed `LeftHandIndex1` sat nowhere near his visible paw -- that reading
   * turned out to be a measurement artifact in the sibling `character-diorama` scene (captured
   * before the torch pose had actually blended in). Re-checked there with a full bone-position
   * dump once posed and a 180-frame simulated `walk_torch` sweep: his whole left-arm chain
   * clusters correctly at his chest, stable to ~1cm. His bone scale is already ~1 (no FBX cm-to-m
   * artifact baked in), so the `/ boneScale` division below is simply a no-op for him. See
   * `character-diorama/showcase.ts`'s `_syncLanternTransform()` for the fuller writeup. */
  private _syncLanternTransform(): void {
    const lantern = this._lanternGroup;
    if (!lantern || !this._player) return;

    const bone = this._lanternHandBone;
    if (!bone) return;

    // Finger bones (Middle1/Index1) have their origin at the finger base inside the palm already;
    // wrist bones (LeftHand) need a forward offset along +Y to reach the palm.
    const isFingerBone =
      bone.name.includes("Middle") || bone.name.includes("Index") || bone.name.includes("Limb_3");
    const boneScale = bone.getAccumulatedWorldScale();
    const localOffset = MathPool.acquireVector().set(
      0,
      (isFingerBone ? 0.01 : 0.08) / boneScale,
      (isFingerBone ? 0.0 : 0.01) / boneScale,
    );

    const worldPos = MathPool.acquireVector();
    bone.worldMatrix.transformVector(localOffset, worldPos);

    lantern.position.copyFrom(worldPos);
    lantern.updateMatrixWorld();

    MathPool.releaseVector(localOffset);
    MathPool.releaseVector(worldPos);
  }

  /** Greybox stand-in for the Sturmlaterne (storm lantern) from the concept art -- delegates to BunkerKit. */
  private _buildLanternMesh(): Object3D {
    return BunkerKit.createHeldLantern({ name: "LanternPlaceholder" });
  }

  /**
   * Ermittelt anhand von Bewegungsstatus (IDLE, WALK, RUN), Laternenzustand
   * und aktiver Zone (z. B. Treppe Auf/Ab) die exakt passende Animation.
   */
  private _resolveDesiredAnimation(): string {
    const state = this._movementBehavior?.state ?? "IDLE";
    const zone = this._movementBehavior?.activeZone;
    const isStairs = zone?.id === "zone_c";
    const isLantern = this._lanternOn;

    if (state === "IDLE") {
      return isLantern ? "idle_torch" : this._idleVariation;
    }

    if (isStairs) {
      const isMovingDown = (this._movementBehavior?.moveForward ?? 0) < 0;
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
    this._playAnimation(anim, fadeSeconds !== undefined ? { fadeSeconds } : undefined);
  }

  /** Crossfades to the named clip from ANIMATION_CLIP_URLS. No-op if the clip hasn't been loaded
   * (e.g. not yet converted/dropped in) or is already the active animation. */
  private _playAnimation(name: string, opts?: { loop?: boolean; fadeSeconds?: number }): void {
    if (!this._mixer || name === this._activeAnimation) return;
    const clip = this._clips.get(name);
    if (!clip) return;

    // A fade already in flight gets cut short here -- its `from` is dropped from tracking below,
    // so it must be stopped now or it would keep blending forever at its last, stale weight.
    if (this._fade?.from) this._fade.from.stop();

    const fromAction =
      undefined !== this._activeAnimation
        ? this._mixer.clipAction(this._clips.get(this._activeAnimation)!)
        : undefined;
    const toAction = this._mixer.clipAction(clip);
    toAction.setLoop(opts?.loop ?? true);
    toAction.weight = 0;
    toAction.reset();
    toAction.play();

    this._fade = {
      from: fromAction,
      to: toAction,
      elapsed: 0,
      duration: Math.max(0, opts?.fadeSeconds ?? ANIMATION_FADE_SECONDS),
    };
    this._activeAnimation = name;
  }

  /** Advances the current crossfade (if any) by shifting weight from the outgoing to the
   * incoming AnimationAction; AnimationMixer.update already blends simultaneously-playing
   * actions by weight, so this only has to move the two weights toward their target. */
  private _updateAnimationFade(deltaTime: number): void {
    const fade = this._fade;
    if (!fade) return;

    if (0 >= fade.duration) {
      fade.to.weight = 1;
      if (fade.from) fade.from.stop();
      this._fade = undefined;
      return;
    }

    fade.elapsed += deltaTime;
    const t = Math.min(1, fade.elapsed / fade.duration);
    fade.to.weight = t;
    if (fade.from) fade.from.weight = 1 - t;

    if (1 <= t) {
      if (fade.from) fade.from.stop();
      this._fade = undefined;
    }
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
      if (this._movementBehavior) this._movementBehavior.enabled = !this._editorActive;
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
    if (this._playerRig && (rotateLeftHeld || rotateRightHeld)) {
      if (this._movementBehavior) this._movementBehavior.enabled = false;
      if (rotateLeftHeld) this._playerRig.rotation.y -= deltaTime * MANUAL_ROTATE_SPEED;
      if (rotateRightHeld) this._playerRig.rotation.y += deltaTime * MANUAL_ROTATE_SPEED;
    } else if (this._movementBehavior && !this._editorActive) {
      this._movementBehavior.enabled = true;
    }

    // Toggle Laterne mit Taste 'L' -- Mesh und Punktlicht hängen beide an der Hand-Bone, also
    // reicht ein gemeinsames isVisible statt separater An/Aus-Logik pro Teil.
    const isLPressed = this.input.isPressed("KeyL");
    if (isLPressed && !this._lastLState) {
      this._lanternOn = !this._lanternOn;
      if (this._lanternGroup) this._lanternGroup.isVisible = this._lanternOn;
      this._pointLight.isVisible = this._lanternOn;
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
    if (this._movementBehavior?.state === "IDLE" && !this._lanternOn) {
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

    // Toggle Charakter mit Taste 'C' (Männlich -> Weiblich -> Yoshi -> Männlich)
    const isCPressed = this.input.isPressed("KeyC");
    if (isCPressed && !this._lastCState && !this._isSwitchingChar) {
      this._isSwitchingChar = true;
      const nextChar: CharacterType =
        this._characterType === "male"
          ? "female"
          : this._characterType === "female"
            ? "yoshi"
            : "male";
      this._loadCharacter(nextChar)
        .catch((err: unknown) => console.error("[AndNowScene2] Fehler beim Charakterwechsel:", err))
        .finally(() => {
          this._isSwitchingChar = false;
        });
    }
    this._lastCState = isCPressed;

    if (this._editorActive) {
      this._updateEditorUI();
    }

    if (this._mixer) {
      this._updateAnimationFade(deltaTime);
      this._mixer.update(deltaTime);
    }

    this.scene.update(deltaTime);
    this._syncLanternTransform();

    // Status-Anzeige der Spielfigur -- fix am oberen Bildschirmrand (CSS in index.html), folgt
    // der Figur bewusst NICHT mehr über die Bühne (verdeckte sie sonst z.B. weit oben auf der
    // Treppe, wo die Figur ohnehin schon klein ist).
    if (this._playerRig && this._charTagEl && this._tagTitleEl && this._tagDetailsEl) {
      this._charTagEl.style.display = "block";

      const clip = this._activeAnimation ? this._clips.get(this._activeAnimation) : undefined;
      const action = clip && this._mixer ? this._mixer.clipAction(clip) : undefined;
      const timeStr = action ? action.time.toFixed(2) : "0.00";

      // Orientierung / Blickrichtung berechnen (0..360 Grad)
      // Visual convention: 270° = Links, 90° = Rechts, 180° = Hinten, 0° = Vorne
      const rawDeg = ((this._playerRig.rotation.y * 180) / Math.PI) % 360;
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
      const uv = this._movementBehavior?.uv;
      const activeZone = this._movementBehavior?.activeZone;
      const scaleAtUv = uv && activeZone ? activeZone.getScaleAt(uv.u, uv.v) : undefined;
      const uvStr = uv ? `u:${uv.u.toFixed(3)} v:${uv.v.toFixed(3)}` : "--";
      const scaleStr = scaleAtUv !== undefined ? scaleAtUv.toFixed(3) : "--";

      this._tagTitleEl.textContent = `[${this._characterType.toUpperCase()}] ▶ ${this._activeAnimation ?? "none"} (t=${timeStr}s)`;
      this._tagDetailsEl.innerHTML = `
        Blickrichtung: <b style="color:#38bdf8;">${dirName} (${deg.toFixed(0)}°)</b><br>
        State: <b style="color:#fff;">${this._movementBehavior?.state ?? "IDLE"}</b> | Zone: <b style="color:#fff;">${activeZone?.id ?? "none"}</b><br>
        Position: <b style="color:#7dd3fc;">${uvStr}</b> | Skalierung: <b style="color:#7dd3fc;">${scaleStr}</b><br>
        Laterne: <b style="color:#ffb84d;">${this._lanternOn ? "AN" : "AUS"}</b> (Anatomisch: Links)<br>
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
