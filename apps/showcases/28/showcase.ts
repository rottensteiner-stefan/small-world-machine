import type {
  EngineOptions,
  GeometryDataInterface,
  Object3D,
  SpotLight,
  StandardMaterial,
} from "@small-world-machine/engine";
import {
  AbstractShowcase,
  CameraStrategyType,
  Keys,
  OrbitController,
  RendererType,
  Vector2D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";
import { configurePostProcessing } from "./postProcessing.js";
import { buildEnvironment } from "./buildEnvironment.js";
import { buildBench, buildLaserEmitter } from "./buildBench.js";
import { buildBeamSplitter, buildBeams } from "./buildBeamSplitter.js";
import { buildDetector } from "./buildDetector.js";
import { buildSpectrum } from "./buildSpectrum.js";
import type { LabInspectorHost, LabKnobs } from "./Hud.js";
import { LabInspector } from "./Hud.js";
import type { SpectralRay } from "./optics.js";
import { SPECTRAL_RAY_LENGTH, computeSpectralRays } from "./optics.js";

/**
 * Showcase 28: "The Quantum Refraction Lab / Optical Prism"
 *
 * Benchmark testing transmission, optical dispersion, spectral split,
 * and high-refractive glass polyhedra under coherent laser illumination.
 */
export class Showcase extends AbstractShowcase implements LabInspectorHost {
  private _turntable!: Object3D;
  private _prismMesh!: Object3D;
  private _laserLight!: SpotLight;
  private _spectralRays: Object3D[] = [];
  /** P0-5: ONE faint white internal segment linking the average entry point to the average exit
   * point inside the glass, so the beam visibly *passes through* the prism (a single segment per
   * band would stack 7x over the nearly-identical path and blow the glass interior). */
  private _internalPath!: Object3D;
  /** P0-3: the continuous red->violet spectrum band laid on the detector panel -- a single smear
   * mesh whose ENTIRE emissive comes from a runtime-generated canvas gradient texture (the same
   * `Texture.fromCanvas` + `emissiveMap` path the engine itself uses for RampLUTs, so it is
   * WebGL1/WebGL2/WebGPU-safe). One smooth multi-color ramp, no hue stepping, and the texture's
   * 8-bit per-channel ceiling structurally forbids the white-hot core the discrete HDR materials
   * produced. Pinned at the real red and violet impact points every frame. */
  private _bandMesh: Object3D | undefined;
  /** P2-1: live-derived chromatic caustic dispersion fan on the anodized bench surface. */
  private _floorCausticMesh: Object3D | undefined;
  private _causticGeometryData: GeometryDataInterface | undefined;
  private _causticPositions = new Float32Array(16 * 3);
  /** P2-2: soft chromatic bounce SpotLight grounding the dispersed fan on the bench and bezel. */
  private _chromaticBounceLight: SpotLight | undefined;

  private _splitterCarriage: Object3D | undefined;
  private _incidentBeamBefore: Object3D | undefined;
  private _incidentBeamAfter: Object3D | undefined;
  private _reflectedBeam: Object3D | undefined;
  private _refSensorSpot: Object3D | undefined;

  private _orbitController: OrbitController | undefined = undefined;

  private _time = 0;
  /** Lab parameters shared with the inspector. */
  private readonly _knobs: LabKnobs = {
    // Secret manual-control mode: Ctrl+T pauses the automatic wobble and lets LEFT/RIGHT spin
    // the turntable by hand instead.
    manualTurntableControl: false,
    manualTurntableAngle: 0,
    splitterX: -2.3,
    splitterActive: true,
    causticIntensity: 0.65,
    chromaticBounceIntensity: 1.2,
  };
  private readonly _inspector = new LabInspector(this);

  // LabInspectorHost: scene objects are created in setupScene(), hence getters.
  public get knobs(): LabKnobs {
    return this._knobs;
  }
  public get orbitController(): OrbitController | undefined {
    return this._orbitController;
  }
  public get turntable(): Object3D | undefined {
    return this._turntable;
  }
  public get prismMesh(): Object3D | undefined {
    return this._prismMesh;
  }
  public get laserLight(): SpotLight | undefined {
    return this._laserLight;
  }
  public get floorCausticMesh(): Object3D | undefined {
    return this._floorCausticMesh;
  }
  public get chromaticBounceLight(): SpotLight | undefined {
    return this._chromaticBounceLight;
  }
  // Secret manual-control mode: Ctrl+T pauses the automatic wobble and lets LEFT/RIGHT spin
  // the turntable by hand instead.
  /** One-shot guard: the P0-4 hero pose is applied once on the first frame (see update()). */
  private _heroPoseApplied = false;
  // Detector panel plane (world XZ), derived in setupScene() from the resting exit fan: center,
  // unit travel direction (normal) and the tangent used to lay out the spectrum band.
  private _screenFaceX = 0;
  private _screenFaceZ = 0;
  private _screenDirX = 1;
  private _screenDirZ = 0;

  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      ...options,
    });
  }

  protected override async setupScene(): Promise<void> {
    configurePostProcessing(this.renderer);
    this._setupCamera();

    const textures = await buildEnvironment(this.scene);
    const bench = buildBench(this.scene, textures);
    this._turntable = bench.turntable;
    this._prismMesh = bench.prismMesh;
    buildLaserEmitter(this.scene, bench.tableMaterial);

    const splitter = buildBeamSplitter(this.scene, this._knobs.splitterX);
    this._splitterCarriage = splitter.carriage;
    this._refSensorSpot = splitter.refSensorSpot;

    const beams = buildBeams(this.scene, this._knobs.splitterX);
    this._incidentBeamBefore = beams.incidentBeamBefore;
    this._incidentBeamAfter = beams.incidentBeamAfter;
    this._reflectedBeam = beams.reflectedBeam;
    this._laserLight = beams.laserLight;

    // Spectral rays at the turntable's resting rotation, so the detector can be placed in the fan's
    // actual path; `update()` recomputes them every frame as the turntable wobbles.
    const detector = buildDetector(this.scene, this._prismMesh.rotation.y);
    this._screenFaceX = detector.screenFaceX;
    this._screenFaceZ = detector.screenFaceZ;
    this._screenDirX = detector.screenDirX;
    this._screenDirZ = detector.screenDirZ;

    const spectrum = buildSpectrum(
      this.scene,
      this._knobs.causticIntensity,
      this._knobs.chromaticBounceIntensity,
    );
    this._spectralRays = spectrum.spectralRays;
    this._internalPath = spectrum.internalPath;
    this._bandMesh = spectrum.bandMesh;
    this._causticGeometryData = spectrum.causticGeometryData;
    this._causticPositions.set(spectrum.causticGeometryData.vertices);
    this._floorCausticMesh = spectrum.floorCausticMesh;
    this._chromaticBounceLight = spectrum.chromaticBounceLight;

    // Coherent first frame; update() re-derives and repositions everything every frame.
    this._updateSpectralVisuals(detector.initialRays);

    // Wire up in-viewport Inspector and Maker integration
    this._inspector.setup();
  }

  /** Camera: perspective projection, hero pose and the orbit controller. */
  private _setupCamera(): void {
    // Camera setup
    this.defaultFov = (45 * Math.PI) / 180;
    this.defaultFar = 100;
    this.configureCamera();
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    // P0-4 hero reframe: low-three-quarter cinematic pose holding prism + full exit fan +
    // continuous detector band in one composition (beam path as leading line). Re-derived after
    // P0-2 moved the resting pose. User can still orbit via OrbitController.
    this.camera.position.set(5.4, 3.4, -4.6);
    this.camera.target.set(1.4, 1.45, 2.6);
    const orbit = new OrbitController({ input: this.input });
    this._orbitController = orbit;
    this.camera.addBehavior(orbit);
  }

  /** Intersection of an exit ray with the detector's receiving face plane (world XZ), or
   * `undefined` when the ray runs parallel/away and never hits within SPECTRAL_RAY_LENGTH. The
   * returned point is where the band/fan actually terminates on the instrument. */
  private _detectorImpact(ray: SpectralRay): Vector2D | undefined {
    const denom = ray.direction.x * this._screenDirX + ray.direction.y * this._screenDirZ;
    if (Math.abs(denom) < 1e-6) return undefined;
    const t =
      ((this._screenFaceX - ray.origin.x) * this._screenDirX +
        (this._screenFaceZ - ray.origin.y) * this._screenDirZ) /
      denom;
    if (t <= 1e-4) return undefined;
    if (t > SPECTRAL_RAY_LENGTH) return undefined;
    return new Vector2D(ray.origin.x + ray.direction.x * t, ray.origin.y + ray.direction.y * t);
  }

  /** Positions/orients `mesh` centered on MIDPOINT of a segment of `length` running from
   * (originX, originZ) along unit (dirX, dirZ) at beam height, WITHOUT touching scale (callers
   * set scale.y relative to the mesh's own geometry height). `rotation.z` points the
   * cylinder/cube length axis along local +X; a further rotation.y by theta turns that into world
   * direction (cos theta, -sin theta) in (x, z) -- solve for theta given the direction (see the
   * module doc comment: `.y` on a `Vector2D` here stores world Z). */
  private _positionOrientedMesh(
    mesh: Object3D,
    originX: number,
    originZ: number,
    dirX: number,
    dirZ: number,
    length: number,
  ): void {
    mesh.rotation.y = Math.atan2(-dirZ, dirX);
    mesh.position.set(originX + dirX * (length / 2), 1.8, originZ + dirZ * (length / 2));
  }

  /** Per-frame re-derivation of every beam-path visual mesh from the LIVE spectral ray data:
   * exit rays (terminated at the detector face), internal glass segments, and the continuous
   * detector band. Called from `update()` each frame with the freshly re-traced rays. */
  private _updateSpectralVisuals(rays: (SpectralRay | undefined)[]): void {
    const impacts: (Vector2D | undefined)[] = rays.map((r) =>
      r ? this._detectorImpact(r) : undefined,
    );

    for (let i = 0; i < this._spectralRays.length; i++) {
      const ray = rays[i];
      const impact = impacts[i];
      const valid = undefined !== ray;
      const rayMesh = this._spectralRays[i]!;
      rayMesh.isVisible = valid;
      if (!valid) continue;

      // When the exit ray hits the detector face, it terminates cleanly on the panel.
      // If the turntable rotates and the ray misses the panel, it casts into free flight.
      const t = impact
        ? Math.hypot(impact.x - ray!.origin.x, impact.y - ray!.origin.y)
        : SPECTRAL_RAY_LENGTH;
      this._positionOrientedMesh(
        rayMesh,
        ray!.origin.x,
        ray!.origin.y,
        ray!.direction.x,
        ray!.direction.y,
        t,
      );
      rayMesh.scale.set(1, t / SPECTRAL_RAY_LENGTH, 1);
    }

    // P0-5: faint single internal segment following the average entry -> exit path
    let validCount = 0;
    let avgEntryX = 0;
    let avgEntryZ = 0;
    let avgExitX = 0;
    let avgExitZ = 0;
    for (const ray of rays) {
      if (!ray) continue;
      validCount++;
      avgEntryX += ray.entryPoint.x;
      avgEntryZ += ray.entryPoint.y;
      avgExitX += ray.exitPoint.x;
      avgExitZ += ray.exitPoint.y;
    }
    if (validCount > 0 && this._internalPath) {
      avgEntryX /= validCount;
      avgEntryZ /= validCount;
      avgExitX /= validCount;
      avgExitZ /= validCount;
      const dx = avgExitX - avgEntryX;
      const dz = avgExitZ - avgEntryZ;
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) {
        this._positionOrientedMesh(
          this._internalPath,
          avgEntryX,
          avgEntryZ,
          dx / len,
          dz / len,
          len,
        );
        this._internalPath.scale.set(1, len, 1);
        this._internalPath.isVisible = true;
      } else {
        this._internalPath.isVisible = false;
      }
    } else if (this._internalPath) {
      this._internalPath.isVisible = false;
    }

    // Continuous gradient band laid between the lowest and highest valid spectrum impacts.
    // Graceful TIR handling: as wavelengths exceed the critical angle at extreme turntable rotations,
    // the band gracefully contracts rather than abruptly blinking out completely.
    if (this._bandMesh) {
      let firstValidIdx = -1;
      let lastValidIdx = -1;
      for (let i = 0; i < impacts.length; i++) {
        if (impacts[i]) {
          if (firstValidIdx === -1) firstValidIdx = i;
          lastValidIdx = i;
        }
      }

      if (firstValidIdx !== -1 && lastValidIdx !== -1 && firstValidIdx !== lastValidIdx) {
        const first = impacts[firstValidIdx]!;
        const last = impacts[lastValidIdx]!;
        const dx = last.x - first.x;
        const dz = last.y - first.y;
        const bandLen = Math.hypot(dx, dz);
        if (bandLen > 1e-4) {
          this._bandMesh.rotation.y = Math.atan2(-dz, dx);
          this._bandMesh.position.set((first.x + last.x) / 2, 1.8, (first.y + last.y) / 2);
          this._bandMesh.scale.set(bandLen, 0.36, 0.03);
          this._bandMesh.isVisible = true;
        } else {
          this._bandMesh.isVisible = false;
        }
      } else {
        this._bandMesh.isVisible = false;
      }
    }

    // P2-1: Live-derived continuous chromatic caustic dispersion fan on the anodized bench surface
    if (this._floorCausticMesh && this._causticGeometryData) {
      if (validCount > 0) {
        // Collect exit and end coordinates for all 7 spectral bands
        const exitPts: (Vector2D | undefined)[] = [];
        const endPts: (Vector2D | undefined)[] = [];
        let firstValid = -1;
        let lastValid = -1;

        for (let i = 0; i < 7; i++) {
          const ray = rays[i];
          if (ray) {
            if (firstValid === -1) firstValid = i;
            lastValid = i;
            const exitP = ray.exitPoint;
            const imp = impacts[i];
            const endP = imp
              ? imp
              : new Vector2D(
                  exitP.x + ray.direction.x * SPECTRAL_RAY_LENGTH,
                  exitP.y + ray.direction.y * SPECTRAL_RAY_LENGTH,
                );
            exitPts[i] = exitP;
            endPts[i] = endP;
          }
        }

        // Fill invalid bands by clamping to nearest valid ray (graceful TIR contraction)
        for (let i = 0; i < 7; i++) {
          if (!exitPts[i]) {
            const nearest = i < firstValid ? firstValid : lastValid;
            if (nearest !== -1 && exitPts[nearest]) {
              exitPts[i] = exitPts[nearest];
              endPts[i] = endPts[nearest];
            } else {
              exitPts[i] = new Vector2D(0, 0);
              endPts[i] = new Vector2D(0, 0);
            }
          }
        }

        // Compute 8 boundary points from the 7 band centers
        const boundaryExit: Vector2D[] = [];
        const boundaryEnd: Vector2D[] = [];

        // Boundary 0: extrapolated outer flank of Red
        boundaryExit[0] = new Vector2D(
          exitPts[0]!.x - (exitPts[1]!.x - exitPts[0]!.x) * 0.5,
          exitPts[0]!.y - (exitPts[1]!.y - exitPts[0]!.y) * 0.5,
        );
        boundaryEnd[0] = new Vector2D(
          endPts[0]!.x - (endPts[1]!.x - endPts[0]!.x) * 0.5,
          endPts[0]!.y - (endPts[1]!.y - endPts[0]!.y) * 0.5,
        );

        // Boundaries 1..6: midpoints between adjacent rays
        for (let k = 1; k < 7; k++) {
          boundaryExit[k] = new Vector2D(
            (exitPts[k - 1]!.x + exitPts[k]!.x) * 0.5,
            (exitPts[k - 1]!.y + exitPts[k]!.y) * 0.5,
          );
          boundaryEnd[k] = new Vector2D(
            (endPts[k - 1]!.x + endPts[k]!.x) * 0.5,
            (endPts[k - 1]!.y + endPts[k]!.y) * 0.5,
          );
        }

        // Boundary 7: extrapolated outer flank of Violet
        boundaryExit[7] = new Vector2D(
          exitPts[6]!.x + (exitPts[6]!.x - exitPts[5]!.x) * 0.5,
          exitPts[6]!.y + (exitPts[6]!.y - exitPts[5]!.y) * 0.5,
        );
        boundaryEnd[7] = new Vector2D(
          endPts[6]!.x + (endPts[6]!.x - endPts[5]!.x) * 0.5,
          endPts[6]!.y + (endPts[6]!.y - endPts[5]!.y) * 0.5,
        );

        // Write positions into typed buffer (16 vertices = 48 floats)
        const pos = this._causticPositions;
        for (let k = 0; k < 8; k++) {
          const vExit = 2 * k;
          const vEnd = 2 * k + 1;
          const bExit = boundaryExit[k]!;
          const bEnd = boundaryEnd[k]!;

          pos[vExit * 3] = bExit.x;
          pos[vExit * 3 + 1] = 0.005;
          pos[vExit * 3 + 2] = bExit.y;

          pos[vEnd * 3] = bEnd.x;
          pos[vEnd * 3 + 1] = 0.005;
          pos[vEnd * 3 + 2] = bEnd.y;
        }

        this._causticGeometryData.vertices.set(pos);
        this._causticGeometryData.needsUpdate = true;
        this._floorCausticMesh.position.set(0, 0, 0);
        this._floorCausticMesh.rotation.set(0, 0, 0);
        this._floorCausticMesh.scale.set(1, 1, 1);
        this._floorCausticMesh.isVisible = true;

        // P2-2: Chromatic bounce light tracking the active dispersion fan
        if (this._chromaticBounceLight) {
          let avgImpactX = 0;
          let avgImpactZ = 0;
          let impactCount = 0;
          for (const imp of impacts) {
            if (!imp) continue;
            avgImpactX += imp.x;
            avgImpactZ += imp.y;
            impactCount++;
          }
          const endX = impactCount > 0 ? avgImpactX / impactCount : avgExitX + 2.5;
          const endZ = impactCount > 0 ? avgImpactZ / impactCount : avgExitZ + 1.2;

          const midX = (avgExitX + endX) * 0.5;
          const midZ = (avgExitZ + endZ) * 0.5;
          this._chromaticBounceLight.position.set(midX, 0.75, midZ);
          this._chromaticBounceLight.direction.set(0, -1, 0);
          this._chromaticBounceLight.intensity =
            this._knobs.chromaticBounceIntensity * (validCount / 7.0);

          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          for (const ray of rays) {
            if (!ray) continue;
            sumR += ray.color.r;
            sumG += ray.color.g;
            sumB += ray.color.b;
          }
          this._chromaticBounceLight.color.set(
            sumR / validCount,
            sumG / validCount,
            sumB / validCount,
          );
        }
      } else {
        this._floorCausticMesh.isVisible = false;
        if (this._chromaticBounceLight) {
          this._chromaticBounceLight.intensity = 0.0;
        }
      }
    }
  }

  /** Keyboard shortcuts:
   *  - Arrow Left / Arrow Right: immediately engages manual turntable rotation (pauses auto-wobble).
   *  - Arrow Up / Arrow Down: moves 50:50 Beam Splitter along the optical dovetail rail.
   *  - Shift + Arrow: high-speed nudging / fast translation & rotation.
   *  - M: toggles Beam Splitter bypass (active vs full 100% laser pass-through).
   *  - Space: toggles between manual turntable control and automatic oscillation.
   *  - I / H: toggles Lab Inspector.
   */
  protected override onKeyDown(event: KeyboardEvent): void {
    if (
      document.activeElement &&
      ("INPUT" === document.activeElement.tagName || "TEXTAREA" === document.activeElement.tagName)
    ) {
      return;
    }
    if (this._inspector.handleKey(event)) {
      event.preventDefault();
      return;
    }
    if (this._inspector.isActive) {
      return;
    }
    super.onKeyDown(event);
    if (Keys.LEFT === event.code || Keys.RIGHT === event.code) {
      event.preventDefault();
      if (!this._knobs.manualTurntableControl && this._turntable) {
        this._knobs.manualTurntableControl = true;
        this._knobs.manualTurntableAngle = this._turntable.rotation.y;
      }
    } else if (Keys.UP === event.code || Keys.DOWN === event.code) {
      event.preventDefault();
    } else if ("KeyM" === event.code) {
      event.preventDefault();
      this._knobs.splitterActive = !this._knobs.splitterActive;
    } else if (Keys.SPACE === event.code) {
      event.preventDefault();
      this._knobs.manualTurntableControl = !this._knobs.manualTurntableControl;
      if (this._knobs.manualTurntableControl && this._turntable) {
        this._knobs.manualTurntableAngle = this._turntable.rotation.y;
      } else if (!this._knobs.manualTurntableControl && this._turntable) {
        // Re-align auto-wobble phase with current angle to avoid jump
        const clampedRatio = Math.max(-0.999, Math.min(0.999, this._turntable.rotation.y / 0.12));
        this._time = Math.asin(clampedRatio) / 0.6;
      }
    }
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime * 0.5;

    const isInspectorActive = this._inspector.isActive;

    // 50:50 Beam Splitter navigation on optical rail (UP/DOWN arrow keys)
    const isUp = !isInspectorActive && this.input.isPressed(Keys.UP);
    const isDown = !isInspectorActive && this.input.isPressed(Keys.DOWN);
    if (isUp || isDown) {
      const isShift = this.input.isPressed(Keys.SHIFT_L) || this.input.isPressed(Keys.SHIFT_R);
      const railSpeed = isShift ? 2.4 : 1.1; // units/s
      if (isUp) {
        this._knobs.splitterX = Math.min(-1.15, this._knobs.splitterX + railSpeed * deltaTime);
      }
      if (isDown) {
        this._knobs.splitterX = Math.max(-3.35, this._knobs.splitterX - railSpeed * deltaTime);
      }
    }

    if (this._splitterCarriage) {
      this._splitterCarriage.position.x = this._knobs.splitterX;
    }

    // P0-4 hero framing, re-asserted exactly once on the first frame: the HybridSync camera
    // strategy derives its orbit state from the camera pose it sees at its first update (and can
    // be nudged by spurious input deltas), so a one-shot deterministic re-frame keeps the agreed
    // low-three-quarter composition stable for pinned captures instead of drifting.
    if (!this._heroPoseApplied) {
      this._heroPoseApplied = true;
      this.camera.position.set(6.8, 4.6, -1.8);
      this.camera.target.set(2.0, 1.5, 2.9);
    }

    if (this._turntable) {
      const isLeft = !isInspectorActive && this.input.isPressed(Keys.LEFT);
      const isRight = !isInspectorActive && this.input.isPressed(Keys.RIGHT);

      if (isLeft || isRight) {
        if (!this._knobs.manualTurntableControl) {
          this._knobs.manualTurntableControl = true;
          this._knobs.manualTurntableAngle = this._turntable.rotation.y;
        }
      }

      if (this._knobs.manualTurntableControl) {
        // Manual mode: auto-wobble is paused, LEFT/RIGHT spin the turntable by hand.
        const isShift = this.input.isPressed(Keys.SHIFT_L) || this.input.isPressed(Keys.SHIFT_R);
        const manualSpeed = isShift ? 1.5 : 0.6; // rad/s (halved for fine precision control)
        if (isLeft) {
          this._knobs.manualTurntableAngle -= manualSpeed * deltaTime;
        }
        if (isRight) {
          this._knobs.manualTurntableAngle += manualSpeed * deltaTime;
        }
        this._turntable.rotation.y = this._knobs.manualTurntableAngle;
      } else {
        // Gentle slow turntable rotation showcasing prism facets and refraction shifts.
        this._turntable.rotation.y = Math.sin(this._time * 0.6) * 0.12;
      }
    }

    // Trace real spectral rays dynamically across all 3 prism faces based on live rotation
    const liveRays =
      this._turntable && this._prismMesh
        ? computeSpectralRays(this._prismMesh.rotation.y + this._turntable.rotation.y)
        : [];
    const firstValidRay = liveRays.find((r) => undefined !== r);
    const prismEntryX = firstValidRay ? firstValidRay.entryPoint.x : -0.62;

    // Dynamic beam segments around the beam splitter
    const emitterX = -4.08;
    const splitX = this._knobs.splitterX;

    if (this._incidentBeamBefore) {
      const lenBefore = splitX - emitterX;
      this._incidentBeamBefore.position.set((emitterX + splitX) / 2, 1.8, 0);
      this._incidentBeamBefore.scale.set(1, lenBefore, 1);
    }

    if (this._incidentBeamAfter) {
      const lenAfter = Math.max(0.01, prismEntryX - splitX);
      this._incidentBeamAfter.position.set((splitX + prismEntryX) / 2, 1.8, 0);
      this._incidentBeamAfter.scale.set(1, lenAfter, 1);
      (this._incidentBeamAfter.material as StandardMaterial).emissiveIntensity = this._knobs
        .splitterActive
        ? 0.65
        : 1.1;
    }

    if (this._reflectedBeam) {
      this._reflectedBeam.position.set(splitX, 1.8, -1.1);
      this._reflectedBeam.isVisible = this._knobs.splitterActive;
    }

    if (this._refSensorSpot) {
      this._refSensorSpot.position.set(splitX, 1.8, -2.18);
      this._refSensorSpot.isVisible = this._knobs.splitterActive;
    }

    if (this._turntable && this._prismMesh) {
      this._updateSpectralVisuals(liveRays);
    }

    // Dynamic spectral pulse oscillation (thickness only -- scale.y carries the live ray length)
    for (let i = 0; i < this._spectralRays.length; i++) {
      const ray = this._spectralRays[i];
      if (ray && ray.isVisible) {
        const pulse = 0.95 + Math.sin(this._time * 4.0 + i * 0.5) * 0.08;
        ray.scale.set(pulse, ray.scale.y, pulse);
      }
    }

    this._inspector.syncSelection();
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase();
attachDevTools(app);
// QA instrumentation hook for the browser capture scripts. Set unconditionally -- the example is
// browser-only, the property is inert, and the repo typechecks without "vite/client" in the
// tsconfig "types", so an import.meta.env guard would only trip the compiler for no gain here.
if (typeof window !== "undefined") {
  const w = window as Window & { __showcase28?: Showcase };
  w.__showcase28 = app;
}
app.start().catch((err: unknown) => console.error("[Showcase28] Failed to start:", err));
