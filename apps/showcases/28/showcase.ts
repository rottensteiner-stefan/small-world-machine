import {
  AbstractShowcase,
  AmbientLight,
  BloomElement,
  BoundingBox,
  BoundingSphere,
  BoundingType,
  CameraStrategyType,
  CauchyMaterials,
  Color,
  Cube,
  CubeLayout,
  CubeTexture,
  Cylinder,
  DirectionalLight,
  EngineOptions,
  GlassMaterial,
  GrainElement,
  HbaoElement,
  Keys,
  MathUtils,
  Object3D,
  Optics,
  OrbitController,
  PerspectiveProjection,
  PostProcessingEffectType,
  ProjectionType,
  Ray2D,
  Raycaster,
  RendererType,
  SkyboxMaterial,
  SpotLight,
  StandardMaterial,
  Texture,
  TextureFilter,
  TextureWrap,
  ToneMappingElement,
  Torus,
  Vector2D,
  Vector3D,
  VignetteElement,
  WireframeMaterial,
} from "@small-world-machine/engine";
import {
  attachDevTools,
  HierarchyPanel,
  PropertyPanel,
  UndoStack,
} from "@small-world-machine/tools";
import { Pane } from "tweakpane";

// ----------------------------------------------------------------------------
// Real prism optics: Snell's law at both surfaces of the equilateral-triangle prism, with a
// Cauchy-dispersion refractive index per wavelength, instead of hand-placed decorative angles.
// All 2D math below works in the world XZ plane (a `Vector2D`'s `.y` field stores world Z here,
// since the prism's triangular cross-section and the incident beam both lie in a horizontal
// plane -- see PRISM_RADIUS/PRISM_APEX_ANGLE usage in `computeSpectralRays()`).
// ----------------------------------------------------------------------------

const PRISM_RADIUS = 1.2; // matches the CentralPrism Cylinder's radiusTop/radiusBottom
// The equilateral-triangle cross-section (Cylinder radialSegments: 3) has a 60-degree interior
// angle at each vertex -- the classic prism "apex angle" A in the θ2 + θ3 = A refraction
// relation, which drives the incidence-angle choice below (not used as a separate runtime value:
// the actual vertex geometry in computeSpectralRays() already encodes it).
// Chosen so every spectral color refracts back out through the far face without hitting total
// internal reflection there (critical angle ~36-38 degrees for the dispersion range below), while
// still landing safely inside the entry face's 120-degree angular span, clear of its edges, across
// the turntable's +-0.12 rad wobble (see update()). Re-tuned from the old 44deg/+-0.25 rad per plan
// P0-2: a numeric range scan over the FULL new wobble window proves all 7 bands stay valid at EVERY
// angle in [-0.12, +0.12] only for NOMINAL in the upper part of the plan's 48-50deg band -- 50deg
// keeps a ~+-0.13 rad symmetric 7/7 margin, so NOMINAL=50deg was chosen (see apps/showcases/28/docs/log.md).
const NOMINAL_INCIDENCE_ANGLE = MathUtils.degToRad(50);
const SPECTRAL_RAY_LENGTH = 4.8;

interface SpectrumBand {
  name: string;
  color: Color;
  wavelengthNm: number;
  /** Per-band emissive gain (CIE-luminosity compensation): the loud yellow/green middle is pulled
   * down and the dim red/blue/violet extremes pushed up so every spectral band reads at comparable
   * brightness on the dark detector (plan P0-3: "even red->violet read"). */
  luminosity: number;
}

const SPECTRUM: SpectrumBand[] = [
  { name: "Red", color: new Color(1.0, 0.05, 0.05), wavelengthNm: 700, luminosity: 1.15 },
  { name: "Orange", color: new Color(1.0, 0.45, 0.0), wavelengthNm: 620, luminosity: 0.95 },
  { name: "Yellow", color: new Color(1.0, 0.9, 0.05), wavelengthNm: 580, luminosity: 0.7 },
  { name: "Green", color: new Color(0.1, 1.0, 0.2), wavelengthNm: 530, luminosity: 0.6 },
  { name: "Cyan", color: new Color(0.05, 0.9, 1.0), wavelengthNm: 490, luminosity: 0.75 },
  { name: "Blue", color: new Color(0.1, 0.3, 1.0), wavelengthNm: 460, luminosity: 0.95 },
  { name: "Violet", color: new Color(0.7, 0.1, 1.0), wavelengthNm: 400, luminosity: 1.1 },
];

/** Outward normal of edge `a`-`b`, for a convex polygon centred on the origin (true here: the
 * prism's triangular cross-section is centred at world (0, 0) in XZ). */
function outwardFaceNormal(a: Vector2D, b: Vector2D): Vector2D {
  return new Vector2D((a.x + b.x) / 2, (a.y + b.y) / 2).normalize();
}

interface SpectralRay {
  name: string;
  color: Color;
  /** Real intersection of the beam with the prism's entry face (world XZ). */
  entryPoint: Vector2D;
  /** Real exit point on the prism's far face (world XZ) -- the start of the free-flight segment. */
  exitPoint: Vector2D;
  /** Start of the free-flight segment. */
  origin: Vector2D;
  direction: Vector2D;
}

/**
 * Traces each spectral band through the triangular prism using real Snell's-law refraction at
 * both surfaces, instead of hand-placed decorative fan angles. `prismRotation` must be the
 * prism's actual, *current* `rotation.y` (base rotation plus the turntable's live wobble --
 * see `update()`, which calls this every frame). Assumes the prism is centred at world XZ
 * (0, 0) and the incident beam travels along +X at z = 0 (matching the SpotLight/incident-beam
 * objects in `setupScene()`).
 *
 * Returns one entry per `SPECTRUM` band, in the same order -- `undefined` where that color
 * undergoes total internal reflection at the far face for the given `prismRotation` (a real,
 * unavoidable outcome here: the turntable's +-0.25 rad wobble swings the entry incidence angle
 * across a wider range than this prism's flint-glass dispersion can refract out cleanly the
 * whole time -- see docs/adr note in update()). Callers must handle holes, not assume 7 rays.
 */
function computeSpectralRays(prismRotation: number): (SpectralRay | undefined)[] {
  // Local vertex k sits at world angle (k * 120deg) before the prism's own rotation is applied
  // (matches Cylinder's own (radius*sin(theta), radius*cos(theta)) vertex generation).
  const vertices = [0, 1, 2].map((k) => {
    const theta = (k * 2 * Math.PI) / 3 + prismRotation;
    return new Vector2D(PRISM_RADIUS * Math.sin(theta), PRISM_RADIUS * Math.cos(theta));
  });

  const faces: [Vector2D, Vector2D][] = [
    [vertices[0]!, vertices[1]!],
    [vertices[1]!, vertices[2]!],
    [vertices[2]!, vertices[0]!],
  ];

  // The incident laser beam travels from the optical rail (-10, 0) along +X at z = 0.
  // Test all 3 polygon edges to find which face faces the incoming beam and gets struck.
  const incidentOrigin = new Vector2D(-10, 0);
  const incidentDir = new Vector2D(1, 0);
  const incidentRay = new Ray2D(incidentOrigin, incidentDir);

  let bestEntryHit: Vector2D | undefined;
  let bestEntryFaceIdx = -1;
  let bestEntryNormal: Vector2D | undefined;
  let minT = Infinity;

  for (let i = 0; i < 3; i++) {
    const face = faces[i]!;
    const hit = incidentRay.intersectSegment(face[0], face[1]);
    if (!hit) continue;
    const normal = outwardFaceNormal(face[0], face[1]);
    // Beam strikes the exterior face only when outward normal opposes beam direction
    if (normal.x * incidentDir.x + normal.y * incidentDir.y >= 0) continue;
    const t = hit.x - incidentOrigin.x;
    if (t < minT) {
      minT = t;
      bestEntryHit = hit;
      bestEntryFaceIdx = i;
      bestEntryNormal = normal;
    }
  }

  if (!bestEntryHit || bestEntryFaceIdx === -1) {
    return SPECTRUM.map(() => undefined);
  }

  const otherFaceIndices = [0, 1, 2].filter((i) => i !== bestEntryFaceIdx);
  const otherFaces = otherFaceIndices.map((i) => faces[i]!);

  const rays: (SpectralRay | undefined)[] = [];
  for (const band of SPECTRUM) {
    // Real, dense-flint-glass Cauchy dispersion -- consistent with this showcase's own
    // "n = 1.65 flint glass" comment on the prism material (real n ranges ~1.629 red to ~1.688
    // violet with this preset).
    const n = Optics.cauchyIndex(band.wavelengthNm, CauchyMaterials.FLINT_GLASS);
    const internalDir = Optics.refract(incidentDir, bestEntryNormal!, 1.0, n);
    if (!internalDir) {
      rays.push(undefined);
      continue;
    }

    let exitPoint: Vector2D | undefined;
    let exitFace: [Vector2D, Vector2D] | undefined;
    const internalRay = new Ray2D(bestEntryHit, internalDir);
    for (const face of otherFaces) {
      const hit = internalRay.intersectSegment(face[0], face[1]);
      if (hit) {
        exitPoint = hit;
        exitFace = face;
        break;
      }
    }
    if (!exitPoint || !exitFace) {
      rays.push(undefined);
      continue;
    }

    const exitNormalOutward = outwardFaceNormal(exitFace[0], exitFace[1]);
    const exitNormalAgainstIncident = new Vector2D(-exitNormalOutward.x, -exitNormalOutward.y);
    const exitDir = Optics.refract(internalDir, exitNormalAgainstIncident, n, 1.0);
    if (!exitDir) {
      // Total internal reflection at the far face -- this color has no exit ray right now.
      rays.push(undefined);
      continue;
    }

    rays.push({
      name: band.name,
      color: band.color,
      entryPoint: bestEntryHit,
      exitPoint,
      origin: exitPoint,
      direction: exitDir,
    });
  }
  return rays;
}

/**
 * Showcase 28: "The Quantum Refraction Lab / Optical Prism"
 *
 * Benchmark testing transmission, optical dispersion, spectral split,
 * and high-refractive glass polyhedra under coherent laser illumination.
 */
class Showcase28 extends AbstractShowcase {
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
  /** Soft chromatic caustic reflection wash on the anodized bench top under the spectral rays. */
  private _floorCausticMesh: Object3D | undefined;

  /** Bakes a soft chromatic caustic reflection texture for the bench surface under the rays. */
  private _createCausticGradientTexture(): Texture {
    const width = 256;
    const height = 128;
    const cv = document.createElement("canvas");
    cv.width = width;
    cv.height = height;
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("[Showcase28] 2D canvas context unavailable for caustic.");

    // Base horizontal spectrum gradient
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    for (let i = 0; i < SPECTRUM.length; i++) {
      const c = SPECTRUM[i]!.color;
      grad.addColorStop(
        i / (SPECTRUM.length - 1),
        `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`,
      );
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Apply soft gaussian-like vertical falloff and longitudinal attenuation
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const halfH = height / 2;
    for (let y = 0; y < height; y++) {
      const dy = (y - halfH) / halfH;
      const vertFalloff = Math.max(0, 1 - dy * dy);
      for (let x = 0; x < width; x++) {
        const u = x / width;
        const horizFalloff = Math.sin(u * Math.PI);
        const alpha = vertFalloff * vertFalloff * horizFalloff * 0.45;
        const idx = (y * width + x) * 4;
        data[idx + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(imgData, 0, 0);

    return Texture.fromCanvas(cv, {
      generateMipmaps: false,
      magFilter: TextureFilter.LINEAR,
      minFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });
  }

  /** Bakes the calibrated red->violet spectral ramp into a 1D emissive map. */
  private _createBandGradientTexture(): Texture {
    const width = 256;
    const height = 8;
    const cv = document.createElement("canvas");
    cv.width = width;
    cv.height = height;
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("[Showcase28] 2D canvas context unavailable for the band gradient.");
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    for (let i = 0; i < SPECTRUM.length; i++) {
      const c = SPECTRUM[i]!.color;
      // Saturation boost: the raw piecewise rgb() stops wash out through white-ish mixes in the
      // mid-spectrum once drawn as a canvas gradient, so exaggerate each stop around its luma to
      // keep every channel under 1 and the band's chromatic identity intact (no white/pink core).
      const gray = (c.r + c.g + c.b) / 3;
      const sat = 1.7;
      const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
      const sr = clamp01(gray + (c.r - gray) * sat);
      const sg = clamp01(gray + (c.g - gray) * sat);
      const sb = clamp01(gray + (c.b - gray) * sat);
      grad.addColorStop(
        i / (SPECTRUM.length - 1),
        `rgb(${Math.round(sr * 255)}, ${Math.round(sg * 255)}, ${Math.round(sb * 255)})`,
      );
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    return Texture.fromCanvas(cv, {
      generateMipmaps: false,
      magFilter: TextureFilter.LINEAR,
      minFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });
  }

  private _splitterCarriage: Object3D | undefined;
  private _splitterX = -2.3;
  private _splitterActive = true;
  private _incidentBeamBefore: Object3D | undefined;
  private _incidentBeamAfter: Object3D | undefined;
  private _reflectedBeam: Object3D | undefined;
  private _refSensorSpot: Object3D | undefined;

  // Lab Inspector integration
  private _inspectorDrawer: HTMLElement | undefined;
  private _inspectorToggleBtn: HTMLButtonElement | undefined = undefined;
  private _inspectorOpen = false;
  private _isHoveringInspector = false;
  private _isDraggingInspector = false;
  private _orbitController: OrbitController | undefined = undefined;
  private _undo = new UndoStack();
  private _hierarchyPanel: HierarchyPanel | undefined = undefined;
  private _propertyPanel: PropertyPanel | undefined = undefined;
  private _selectedObject: Object3D | undefined = undefined;
  private _selection = new Set<Object3D>();
  private _highlightMesh: Object3D | undefined = undefined;
  private readonly _raycaster = new Raycaster();
  private _pointerDownPos: { x: number; y: number } | null = null;

  /** Bakes the calibrated auxiliary reference detector readout scale texture. */
  private _createRefSensorTexture(): Texture {
    const width = 512;
    const height = 128;
    const cv = document.createElement("canvas");
    cv.width = width;
    cv.height = height;
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("[Showcase28] 2D canvas context unavailable for ref sensor.");

    // Dark instrument display background
    ctx.fillStyle = "#0a0e14";
    ctx.fillRect(0, 0, width, height);

    // Subtle measurement border & center rail
    ctx.strokeStyle = "rgba(0, 210, 255, 0.45)";
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, width - 16, height - 16);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, 64);
    ctx.lineTo(width - 16, 64);
    ctx.stroke();

    // Scale ticks and labels along X
    ctx.fillStyle = "rgba(0, 220, 255, 0.85)";
    ctx.font = "bold 13px monospace";
    ctx.textAlign = "center";
    ctx.fillText("AUX REF PHOTODETECTOR  |  50.0% BEAM SPLIT", 256, 28);

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "11px monospace";
    for (let x = 32; x <= width - 32; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 56);
      ctx.lineTo(x, 72);
      ctx.stroke();
      const val = Math.round((x - 256) / 3.2);
      ctx.fillText(`${val > 0 ? "+" : ""}${val}mm`, x, 92);
    }

    // Invert vertically so that texture mapping on the 3D detector face renders right-side up
    const flippedCanvas = document.createElement("canvas");
    flippedCanvas.width = width;
    flippedCanvas.height = height;
    const fCtx = flippedCanvas.getContext("2d");
    if (fCtx) {
      fCtx.translate(0, height);
      fCtx.scale(1, -1);
      fCtx.drawImage(cv, 0, 0);
    }

    return Texture.fromCanvas(flippedCanvas, {
      generateMipmaps: false,
      magFilter: TextureFilter.LINEAR,
      minFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });
  }

  private _time = 0;
  // Secret manual-control mode: Ctrl+T pauses the automatic wobble and lets LEFT/RIGHT spin
  // the turntable by hand instead.
  private _manualTurntableControl = false;
  private _manualTurntableAngle = 0;
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
    // Post-Processing: Vivid HDR Bloom for laser and dispersed spectral rays. Plan P0-1 exposure
    // rebalance: dark cleanroom first, spectrum reads as light; bloom threshold raised well above
    // the lit geometry so only the laser/fan/band glow blooms.
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 0.35;
      bloom.threshold = 1.05;
      bloom.softThreshold = 0.05;
      bloom.radius = 0.6;
    }

    const hbao = this.renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao) {
      // Disabled: on the WebGPU path the HBAO pass read as blotchy denoiser smudges over the dark
      // anodized bench. Vignette + the dark grade carry the contact mood instead (graceful no-op
      // on WebGL1 either way).
      hbao.enabled = false;
    }

    const vignette = this.renderer.postProcessing.get<VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    if (vignette) {
      vignette.enabled = true;
      vignette.offset = 0.78;
      vignette.darkness = 0.4;
    }

    const grain = this.renderer.postProcessing.get<GrainElement>(PostProcessingEffectType.GRAIN);
    if (grain) {
      grain.enabled = true;
      grain.intensity = 0.015;
    }

    // ACES_FILMIC tone mapping kept; exposure lightly lifted off pure-neutral as the last grade
    // knob after the P0-1 rebalance (plan: 0.9-1.1 tuned last).
    const toneMap = this.renderer.postProcessing.get<ToneMappingElement>(
      PostProcessingEffectType.TONE_MAPPING,
    );
    if (toneMap) {
      toneMap.exposure = 1.08;
    }

    // Camera setup
    if (ProjectionType.PERSPECTIVE === this.camera.projection.type) {
      const aspect = window.innerWidth / window.innerHeight;
      this.camera.projection = new PerspectiveProjection({
        fov: (45 * Math.PI) / 180,
        aspect,
        near: 0.1,
        far: 100,
      });
      this.camera.updateProjectionMatrix();
    }
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    // P0-4 hero reframe: low-three-quarter cinematic pose holding prism + full exit fan +
    // continuous detector band in one composition (beam path as leading line). Re-derived after
    // P0-2 moved the resting pose. User can still orbit via OrbitController.
    this.camera.position.set(5.4, 3.4, -4.6);
    this.camera.target.set(1.4, 1.45, 2.6);
    const orbit = new OrbitController({ input: this.input, audio: this.audio });
    this._orbitController = orbit;
    this.camera.addBehavior(orbit);

    // Ambient Optical Environment (Dark cleanroom lab aesthetic) -- P0-1 rebalanced down
    const ambientLight = new AmbientLight({
      color: new Color(0.04, 0.05, 0.08),
      intensity: 0.12,
    });
    this.scene.add(ambientLight);

    // Laboratory Overhead Soft Light
    const overheadLight = new DirectionalLight({
      color: new Color(0.9, 0.95, 1.0),
      intensity: 0.25,
    });
    overheadLight.direction.set(0.3, -1, -0.4);
    this.scene.add(overheadLight);

    // Load Environment Map & PBR Textures
    const envTexture = new CubeTexture();
    try {
      await envTexture.loadFrom("./assets/ibl/env.webp", CubeLayout.CROSS_HORIZONTAL);
      const skybox = new Object3D("Skybox");
      skybox.geometry = new Cube({ size: 1000 }).getGeometryData();
      // The raw env panorama is a bright studio HDR plate; shown undimmed it floods the dark
      // cleanroom look with haze and blows the frame (it is ALSO the IBL light source, so keep
      // the texture, only darken the visible sky to a near-black lab backdrop).
      skybox.material = new SkyboxMaterial({
        cubeMap: envTexture,
        color: new Color(0.03, 0.035, 0.05),
      });
      skybox.frustumCulled = false;
      this.scene.add(skybox);
    } catch (e) {
      console.warn("Could not load envmap:", e);
    }

    // Real IBL (irradiance/prefilter/BRDF LUT), baked via tools/ibl-gen.html from a
    // freshly-generated panorama matching this scene's own skybox -- replaces the previous
    // (physically wrong) reuse of the raw, unconvolved skybox as both diffuse and specular map.
    try {
      const brdfTexture = await Texture.fromUrl("./assets/ibl/brdf_lut.webp");
      const irradianceTexture = new CubeTexture();
      await irradianceTexture.loadFrom("./assets/ibl/irradiance.webp", CubeLayout.CROSS_HORIZONTAL);
      const prefilterTexture = new CubeTexture();
      await prefilterTexture.loadMipmapsFrom(
        [
          "./assets/ibl/prefilter/mip0.webp",
          "./assets/ibl/prefilter/mip1.webp",
          "./assets/ibl/prefilter/mip2.webp",
          "./assets/ibl/prefilter/mip3.webp",
          "./assets/ibl/prefilter/mip4.webp",
        ],
        CubeLayout.CROSS_HORIZONTAL,
      );

      this.scene.brdfLUT = brdfTexture;
      this.scene.irradianceMap = irradianceTexture;
      this.scene.prefilterMap = prefilterTexture;
      this.scene.environmentIntensity = 0.34;
    } catch (e) {
      console.warn("IBL maps not loaded:", e);
    }

    let steelDiffuse: Texture | undefined;
    let steelNormal: Texture | undefined;
    let steelRoughness: Texture | undefined;

    let brassDiffuse: Texture | undefined;
    let brassNormal: Texture | undefined;
    let brassRoughness: Texture | undefined;

    try {
      steelDiffuse = await Texture.fromUrl("../shared/assets/scratched_steel_diffuse.webp");
      if (steelDiffuse) {
        steelDiffuse.repeat.x = 1.5;
        steelDiffuse.repeat.y = 1.5;
      }
      steelNormal = await Texture.fromUrl("../shared/assets/scratched_steel_normal.webp");
      if (steelNormal) {
        steelNormal.repeat.x = 1.5;
        steelNormal.repeat.y = 1.5;
      }
      steelRoughness = await Texture.fromUrl("../shared/assets/scratched_steel_roughness.webp");
      if (steelRoughness) {
        steelRoughness.repeat.x = 1.5;
        steelRoughness.repeat.y = 1.5;
      }

      brassDiffuse = await Texture.fromUrl("../shared/assets/rusty_brass_diffuse.webp");
      brassNormal = await Texture.fromUrl("../shared/assets/rusty_brass_normal.webp");
      brassRoughness = await Texture.fromUrl("../shared/assets/rusty_brass_roughness.webp");
    } catch (e) {
      console.warn("Could not load PBR textures:", e);
    }

    // 1. Heavy Optical Isolation Bench (dark anodized aluminum slab, plan P1-2: grounded, matte)
    const tableMat = new StandardMaterial({
      color: new Color(0.14, 0.15, 0.17),
      diffuseMap: steelDiffuse,
      normalMap: steelNormal,
      roughnessMap: steelRoughness,
      metallic: 0.5,
      roughness: 0.6,
      normalScale: new Vector2D(0.35, 0.35),
    });
    const benchTop = new Object3D("BenchTop");
    benchTop.geometry = new Cube({
      size: 1,
    }).getGeometryData();
    benchTop.scale.set(14, 0.4, 10);
    benchTop.material = tableMat;
    benchTop.position.set(0, -0.2, 0);
    benchTop.receiveShadow = true;
    this.scene.add(benchTop);

    // Rotary Optical Stage (Center turntable) -- P1-2: dark anodized like the bench
    this._turntable = new Object3D("TurntableStage");
    this._turntable.position.set(0, 0, 0);
    this.scene.add(this._turntable);

    const stageMat = new StandardMaterial({
      color: new Color(0.15, 0.16, 0.18),
      diffuseMap: steelDiffuse,
      normalMap: steelNormal,
      roughnessMap: steelRoughness,
      metallic: 0.6,
      roughness: 0.55,
      normalScale: new Vector2D(0.3, 0.3),
    });
    const stagePlate = new Object3D("StagePlate");
    stagePlate.geometry = new Cylinder({
      radiusTop: 2.2,
      radiusBottom: 2.4,
      height: 0.15,
      radialSegments: 48,
    }).getGeometryData();
    stagePlate.material = stageMat;
    stagePlate.position.set(0, 0.075, 0);
    stagePlate.receiveShadow = true;
    this._turntable.add(stagePlate);

    // Brass Scale Ring around turntable -- P1-2: re-seated ON the plate's top face (radius 2.18 is
    // inside the stagePlate top radius of 2.2, so the torus no longer clips the plate's sloped
    // edge), slightly proud of the surface with a near-zero contact gap for HBAO contact shading.
    const brassRingMat = new StandardMaterial({
      color: new Color(0.7, 0.55, 0.25),
      diffuseMap: brassDiffuse,
      normalMap: brassNormal,
      roughnessMap: brassRoughness,
      metallic: 0.9,
      roughness: 0.35,
    });
    const dialRing = new Object3D("DialRing");
    dialRing.geometry = new Torus({
      radius: 2.18,
      tube: 0.03,
      radialSegments: 32,
      tubularSegments: 64,
    }).getGeometryData();
    dialRing.material = brassRingMat;
    dialRing.rotation.x = Math.PI / 2;
    dialRing.position.set(0, 0.181, 0);
    this._turntable.add(dialRing);

    // The Central Optical Prism (Equilateral triangular cylinder, n = 1.65 flint glass).
    // P1-1: verified crystalline GlassMaterial path (3-backend, no StandardMaterial.transmission
    // WebGPU-only trap), no self-glow emissive -- the only light on the glass is the tight key
    // SpotLight below, which raises sharp facet glints instead of a milky self-luminous bulb.
    const glassMat = new GlassMaterial({
      color: new Color(0.96, 0.98, 1.0),
      ior: 1.65,
      thickness: 0.55,
      transmission: 1.0,
      roughness: 0.02,
    });
    this._prismMesh = new Object3D("CentralPrism");
    this._prismMesh.geometry = new Cylinder({
      radiusTop: 1.2,
      radiusBottom: 1.2,
      height: 2.2,
      radialSegments: 3,
    }).getGeometryData();
    this._prismMesh.material = glassMat;
    this._prismMesh.position.set(0, 1.25, 0);
    // Rotated so the incident beam (arriving along +X at world angle 270 degrees, see
    // computeSpectralRays()' doc comment) hits the face between local vertices 1 and 2 at
    // NOMINAL_INCIDENCE_ANGLE, not dead-on on an edge (the previous Math.PI/6 landed exactly on a
    // vertex, verified by hand: 240deg local + 30deg rotation = 270deg exactly).
    this._prismMesh.rotation.y = (3 * Math.PI) / 2 - NOMINAL_INCIDENCE_ANGLE - Math.PI;
    this._prismMesh.castShadow = true;
    this._turntable.add(this._prismMesh);

    // P1-1: one tight specular key SpotLight for crisp glass facet glints (GlassMaterial is
    // IBL-blind, so this is its only specular drive). Non-shadow to stay clear of the hard scene
    // cap of <= 3 SpotLights (laser + key = 2). Tightened angle and penumbra ensure razor-sharp
    // specular reflections on prism facet edges during manual and auto rotation.
    const keyGlintSpot = new SpotLight({
      color: new Color(1.0, 1.0, 1.0),
      intensity: 3.2,
      distance: 10,
      angle: Math.PI / 7,
      penumbra: 0.25,
    });
    keyGlintSpot.position.set(5.0, 4.6, -1.6);
    keyGlintSpot.direction.set(-0.805, -0.499, 0.322).normalize();
    keyGlintSpot.castShadow = false;
    this.scene.add(keyGlintSpot);

    // Laser Emitter Pillar & Housing
    const emitterPillar = new Object3D("EmitterPillar");
    emitterPillar.geometry = new Cylinder({
      radiusTop: 0.15,
      radiusBottom: 0.25,
      height: 1.8,
      radialSegments: 24,
    }).getGeometryData();
    emitterPillar.material = tableMat;
    emitterPillar.position.set(-4.5, 0.9, 0);
    this.scene.add(emitterPillar);

    const laserHousingMat = new StandardMaterial({
      color: new Color(0.1, 0.1, 0.12),
      metallic: 0.9,
      roughness: 0.3,
    });
    const laserHousing = new Object3D("LaserHousing");
    laserHousing.geometry = new Cylinder({
      radiusTop: 0.22,
      radiusBottom: 0.22,
      height: 0.8,
      radialSegments: 24,
    }).getGeometryData();
    laserHousing.material = laserHousingMat;
    laserHousing.rotation.z = Math.PI / 2;
    laserHousing.position.set(-4.5, 1.8, 0);
    this.scene.add(laserHousing);

    // Glowing Laser Lens Aperture -- kept modest so it doesn't flood the frame with HDR bloom
    const laserLensMat = new StandardMaterial({
      color: new Color(1, 1, 1),
      emissiveColor: new Color(1.2, 1.2, 1.2),
      emissiveIntensity: 1.6,
      roughness: 0.1,
    });
    const laserEmitterMesh = new Object3D("LaserLens");
    laserEmitterMesh.geometry = new Cylinder({
      radiusTop: 0.12,
      radiusBottom: 0.12,
      height: 0.05,
      radialSegments: 24,
    }).getGeometryData();
    laserEmitterMesh.material = laserLensMat;
    laserEmitterMesh.rotation.z = Math.PI / 2;
    laserEmitterMesh.position.set(-4.08, 1.8, 0);
    this.scene.add(laserEmitterMesh);

    // --- 50:50 Beam Splitter System & Auxiliary Reference Detector ---
    // 1. Dovetail Optical Rail on the bench along X
    const railMat = new StandardMaterial({
      color: new Color(0.12, 0.14, 0.16),
      metallic: 0.85,
      roughness: 0.35,
    });
    const rail = new Object3D("OpticalRail");
    rail.geometry = new Cube({ size: 1 }).getGeometryData();
    rail.scale.set(2.4, 0.04, 0.22);
    rail.position.set(-2.25, 0.02, 0);
    rail.receiveShadow = true;
    this.scene.add(rail);

    // 2. Sliding Beam Splitter Carriage
    this._splitterCarriage = new Object3D("SplitterCarriage");
    this._splitterCarriage.position.set(this._splitterX, 0, 0);

    const carriageBase = new Object3D("CarriageBase");
    carriageBase.geometry = new Cube({ size: 1 }).getGeometryData();
    carriageBase.scale.set(0.32, 0.08, 0.28);
    carriageBase.material = railMat;
    carriageBase.position.set(0, 0.06, 0);
    this._splitterCarriage.add(carriageBase);

    // Vertical mounting post
    const postMat = new StandardMaterial({
      color: new Color(0.18, 0.2, 0.22),
      metallic: 0.9,
      roughness: 0.25,
    });
    const post = new Object3D("MountingPost");
    post.geometry = new Cylinder({
      radiusTop: 0.045,
      radiusBottom: 0.045,
      height: 1.72,
      radialSegments: 16,
    }).getGeometryData();
    post.material = postMat;
    post.position.set(0, 0.94, 0);
    this._splitterCarriage.add(post);

    // 45-degree kinematic mirror mount bracket at beam height
    const mirrorBracket = new Object3D("MirrorBracket");
    mirrorBracket.geometry = new Cylinder({
      radiusTop: 0.18,
      radiusBottom: 0.18,
      height: 0.05,
      radialSegments: 24,
    }).getGeometryData();
    mirrorBracket.material = postMat;
    mirrorBracket.rotation.y = Math.PI / 4;
    mirrorBracket.rotation.z = Math.PI / 2;
    mirrorBracket.position.set(0, 1.8, 0);
    this._splitterCarriage.add(mirrorBracket);

    // Half-silvered semi-reflective mirror plate (50:50)
    const mirrorMat = new StandardMaterial({
      color: new Color(0.9, 0.95, 1.0, 0.55),
      metallic: 0.8,
      roughness: 0.05,
      transparent: true,
      emissiveColor: new Color(0.3, 0.35, 0.4),
      emissiveIntensity: 0.2,
    });
    const mirrorPlate = new Object3D("BeamSplitterMirror");
    mirrorPlate.geometry = new Cylinder({
      radiusTop: 0.15,
      radiusBottom: 0.15,
      height: 0.015,
      radialSegments: 24,
    }).getGeometryData();
    mirrorPlate.material = mirrorMat;
    mirrorPlate.rotation.y = Math.PI / 4;
    mirrorPlate.rotation.z = Math.PI / 2;
    mirrorPlate.position.set(0, 1.8, 0);
    this._splitterCarriage.add(mirrorPlate);

    this.scene.add(this._splitterCarriage);

    // 3. Auxiliary Reference Photodetector Instrument on the bench at z = -2.35
    const refDetectorStand = new Object3D("RefDetectorStand");
    refDetectorStand.geometry = new Cylinder({
      radiusTop: 0.08,
      radiusBottom: 0.14,
      height: 1.5,
      radialSegments: 16,
    }).getGeometryData();
    refDetectorStand.material = railMat;
    refDetectorStand.position.set(-2.25, 0.75, -2.35);
    this.scene.add(refDetectorStand);

    const refDetectorHousing = new Object3D("RefDetectorHousing");
    refDetectorHousing.geometry = new Cube({ size: 1 }).getGeometryData();
    refDetectorHousing.scale.set(2.6, 0.7, 0.28);
    refDetectorHousing.material = new StandardMaterial({
      color: new Color(0.06, 0.07, 0.085),
      metallic: 0.4,
      roughness: 0.85,
    });
    refDetectorHousing.position.set(-2.25, 1.8, -2.35);
    refDetectorHousing.receiveShadow = true;
    this.scene.add(refDetectorHousing);

    // Calibrated sensor display face facing +Z (towards the incoming reflected beam)
    const refSensorFace = new Object3D("RefSensorFace");
    refSensorFace.geometry = new Cube({ size: 1 }).getGeometryData();
    refSensorFace.scale.set(2.45, 0.58, 0.02);
    refSensorFace.material = new StandardMaterial({
      color: new Color(0.04, 0.06, 0.08),
      emissiveColor: new Color(0.7, 0.85, 0.95),
      emissiveIntensity: 0.7,
      emissiveMap: this._createRefSensorTexture(),
    });
    refSensorFace.position.set(-2.25, 1.8, -2.2);
    this.scene.add(refSensorFace);

    // Luminous impact spot on reference detector sensor strip
    const refSpotMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      emissiveColor: new Color(1.5, 1.5, 1.5),
      emissiveIntensity: 1.8,
    });
    this._refSensorSpot = new Object3D("RefSensorSpot");
    this._refSensorSpot.geometry = new Cylinder({
      radiusTop: 0.035,
      radiusBottom: 0.035,
      height: 0.03,
      radialSegments: 16,
    }).getGeometryData();
    this._refSensorSpot.material = refSpotMat;
    this._refSensorSpot.rotation.x = Math.PI / 2;
    this._refSensorSpot.position.set(this._splitterX, 1.8, -2.18);
    this.scene.add(this._refSensorSpot);

    // 4. Split Laser Beams (Pre-Splitter, Post-Splitter, Reflected)
    const incidentBeamMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      emissiveColor: new Color(1.5, 1.5, 1.5),
      emissiveIntensity: 1.1,
      transparent: true,
    });
    this._incidentBeamBefore = new Object3D("IncidentBeam_Before");
    this._incidentBeamBefore.geometry = new Cylinder({
      radiusTop: 0.03,
      radiusBottom: 0.03,
      height: 1.0,
      radialSegments: 16,
    }).getGeometryData();
    this._incidentBeamBefore.material = incidentBeamMat;
    this._incidentBeamBefore.rotation.z = Math.PI / 2;
    this.scene.add(this._incidentBeamBefore);

    const transmittedBeamMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      emissiveColor: new Color(1.4, 1.4, 1.4),
      emissiveIntensity: 0.65,
      transparent: true,
    });
    this._incidentBeamAfter = new Object3D("IncidentBeam_After");
    this._incidentBeamAfter.geometry = new Cylinder({
      radiusTop: 0.026,
      radiusBottom: 0.026,
      height: 1.0,
      radialSegments: 16,
    }).getGeometryData();
    this._incidentBeamAfter.material = transmittedBeamMat;
    this._incidentBeamAfter.rotation.z = Math.PI / 2;
    this.scene.add(this._incidentBeamAfter);

    const reflectedBeamMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      emissiveColor: new Color(1.4, 1.4, 1.4),
      emissiveIntensity: 0.65,
      transparent: true,
    });
    this._reflectedBeam = new Object3D("ReflectedBeam_90Deg");
    this._reflectedBeam.geometry = new Cylinder({
      radiusTop: 0.026,
      radiusBottom: 0.026,
      height: 2.2,
      radialSegments: 16,
    }).getGeometryData();
    this._reflectedBeam.material = reflectedBeamMat;
    this._reflectedBeam.rotation.x = Math.PI / 2;
    this._reflectedBeam.position.set(this._splitterX, 1.8, -1.1);
    this.scene.add(this._reflectedBeam);

    // SpotLight collinear with the incident laser
    this._laserLight = new SpotLight({
      color: new Color(1.0, 1.0, 1.0),
      intensity: 8.0,
      distance: 15,
      angle: Math.PI / 16,
      penumbra: 0.2,
    });
    this._laserLight.position.set(-4.0, 1.8, 0);
    this._laserLight.direction.set(1, 0, 0);
    this._laserLight.castShadow = true;
    this._laserLight.shadowBias = 0.0008;
    this._laserLight.shadowResolution = 1024;
    this.scene.add(this._laserLight);

    // Spectral Ray Bundle: real Snell's-law refraction through the prism (see
    // computeSpectralRays() above), not a hand-placed decorative fan. Computed once, up front
    // (at the turntable's resting rotation), so the Phosphor Screen below can be placed in the
    // fan's *actual* path; `update()` recomputes this every frame as the turntable wobbles and
    // repositions/hides these same meshes -- see the comment there for why some colors vanish for
    // part of the wobble (total internal reflection, not a bug).
    const initialRays = computeSpectralRays(this._prismMesh.rotation.y);
    const validInitialRays = initialRays.filter((r): r is SpectralRay => undefined !== r);

    // Phosphor Target / Measurement Screen -- deliberately NOT at the old "straight ahead of the
    // laser" position. A 60-degree-apex flint-glass prism has a *minimum* deviation of
    // ~51 degrees (2*asin(n*sin(30deg)) - 60deg) between the incident and exit ray, regardless of
    // the prism's orientation -- rotating the prism only changes which local incidence angle the
    // fixed incident beam sees, not this physical floor, so no rotation can bend the real exit fan
    // back toward the beam's own +X line to hit a screen placed there (verified by scanning every
    // rotation: none land within +-3.5 world units of z=0 at x=5.2). The screen is placed instead
    // along the average of the (resting-pose) exit rays, SCREEN_DISTANCE units out from their
    // average exit point, facing back the way the light actually travels. It stays fixed even
    // though the live spot wanders across it as the turntable wobbles -- a real optical bench's
    // measurement screen is bolted down, not vibrating in sync with the sample stage.
    let avgExitX = 0;
    let avgExitZ = 0;
    let avgDirX = 0;
    let avgDirZ = 0;
    for (const ray of validInitialRays) {
      avgExitX += ray.origin.x;
      avgExitZ += ray.origin.y;
      avgDirX += ray.direction.x;
      avgDirZ += ray.direction.y;
    }
    avgExitX /= validInitialRays.length;
    avgExitZ /= validInitialRays.length;
    const avgDirLength = Math.hypot(avgDirX, avgDirZ);
    avgDirX /= avgDirLength;
    avgDirZ /= avgDirLength;
    const SCREEN_DISTANCE = 4; // the live spot wanders ~1.2 units across this plane over the full wobble -- comfortably inside the panel's 2.5-unit width below

    // P1-2: the detector is a matte dark absorber panel -- NOT a white phosphor lamp. The only
    // light on it must be the spectrum band (P0-3) the fan terminates into.
    const screenMat = new StandardMaterial({
      color: new Color(0.05, 0.05, 0.065),
      metallic: 0.0,
      roughness: 0.95,
    });
    const screenPanel = new Object3D("PhosphorScreen");
    screenPanel.geometry = new Cube({
      size: 1,
    }).getGeometryData();
    screenPanel.scale.set(0.3, 3.2, 2.5);
    screenPanel.material = screenMat;
    screenPanel.position.set(
      avgExitX + avgDirX * SCREEN_DISTANCE,
      1.6,
      avgExitZ + avgDirZ * SCREEN_DISTANCE,
    );
    // Same rotation.y convention as the ray meshes below: this points the panel's local +X (its
    // face normal) along the fan's real average travel direction, matching how the old, unrotated
    // panel's +X normal pointed along the old beam's straight-ahead +X direction.
    screenPanel.rotation.y = Math.atan2(-avgDirZ, avgDirX);
    screenPanel.receiveShadow = true;
    this.scene.add(screenPanel);

    // P1-3: faint static measurement graticule on the instrument face -- a canvas-baked emissive
    // map on a hair-thin panel (the same Texture.fromCanvas + emissiveMap path as the band ramp),
    // so the thin dark-grid read is WebGL1/WebGL2/WebGPU-safe and the hand-drawn grid is data-free.
    // The spectrum band still wins the light battle: maximum emission is emissiveColor(0.28) *
    // emissiveIntensity(0.3) ~ 0.08, well below the band's floor.
    const graticuleCanvas = document.createElement("canvas");
    graticuleCanvas.width = 512;
    graticuleCanvas.height = 640;
    const gCtx = graticuleCanvas.getContext("2d");
    if (gCtx) {
      gCtx.clearRect(0, 0, 512, 640);
      gCtx.strokeStyle = "rgba(255,255,255,0.35)";
      gCtx.lineWidth = 1;
      const gridN = 6;
      const gridM = 8;
      for (let i = 1; i < gridN; i++) {
        gCtx.beginPath();
        gCtx.moveTo((i / gridN) * 512, 0);
        gCtx.lineTo((i / gridN) * 512, 640);
        gCtx.stroke();
      }
      for (let j = 1; j < gridM; j++) {
        gCtx.beginPath();
        gCtx.moveTo(0, (j / gridM) * 640);
        gCtx.lineTo(512, (j / gridM) * 640);
        gCtx.stroke();
      }
      gCtx.lineWidth = 2;
      gCtx.strokeStyle = "rgba(255,255,255,0.6)";
      gCtx.beginPath();
      gCtx.moveTo(256, 0);
      gCtx.lineTo(256, 640);
      gCtx.moveTo(0, 320);
      gCtx.lineTo(512, 320);
      gCtx.stroke();

      // Precision spectrograph wavelength ticks & micro-labels
      gCtx.fillStyle = "rgba(255,255,255,0.45)";
      gCtx.font = "14px monospace";
      gCtx.textAlign = "center";
      gCtx.fillText("700nm", 100, 345);
      gCtx.fillText("550nm", 256, 345);
      gCtx.fillText("400nm", 412, 345);
      for (let t = 40; t <= 472; t += 16) {
        gCtx.beginPath();
        gCtx.moveTo(t, 315);
        gCtx.lineTo(t, 325);
        gCtx.stroke();
      }

      // Flip canvas vertically so that texture mapping on the 3D detector plate renders right-side up
      const flippedCanvas = document.createElement("canvas");
      flippedCanvas.width = 512;
      flippedCanvas.height = 640;
      const fCtx = flippedCanvas.getContext("2d");
      if (fCtx) {
        fCtx.translate(0, 640);
        fCtx.scale(1, -1);
        fCtx.drawImage(graticuleCanvas, 0, 0);
      }

      const graticuleTex = Texture.fromCanvas(flippedCanvas, {
        generateMipmaps: false,
        magFilter: TextureFilter.LINEAR,
        minFilter: TextureFilter.LINEAR,
        addressModeU: TextureWrap.CLAMP_TO_EDGE,
        addressModeV: TextureWrap.CLAMP_TO_EDGE,
      });
      const graticule = new Object3D("DetectorGraticule");
      graticule.geometry = new Cube({ size: 1 }).getGeometryData();
      graticule.material = new StandardMaterial({
        color: screenMat.color,
        emissiveColor: new Color(0.55, 0.55, 0.55),
        emissiveIntensity: 0.5,
        emissiveMap: graticuleTex,
      });
      // max emission ~0.28 -- a readable faint instrument scale, still far below the band's floor.
      graticule.scale.set(0.02, 3.0, 2.3);
      // Local -X is the panel's receiving front face pointing back toward the incident beam.
      // Riding 0.165 units forward keeps the graticule slightly proud of the absorber face.
      graticule.position.set(-0.165, 0, 0);
      graticule.receiveShadow = true;
      screenPanel.add(graticule);

      // Precision anodized bezel framing the sensor window inside the absorber housing
      const bezelMat = new StandardMaterial({
        color: new Color(0.18, 0.2, 0.23),
        metallic: 0.85,
        roughness: 0.35,
      });
      const bezel = new Object3D("DetectorBezel");
      bezel.geometry = new Cube({ size: 1 }).getGeometryData();
      bezel.scale.set(0.04, 3.12, 2.42);
      bezel.material = bezelMat;
      bezel.position.set(-0.152, 0, 0);
      screenPanel.add(bezel);
    }

    // Store the detector's RECEIVING face plane (world XZ) for live ray termination: the surface
    // the beam physically hits is the panel face pointing back toward the fan.
    this._screenFaceX = avgExitX + avgDirX * SCREEN_DISTANCE - avgDirX * 0.165;
    this._screenFaceZ = avgExitZ + avgDirZ * SCREEN_DISTANCE - avgDirZ * 0.165;
    this._screenDirX = avgDirX;
    this._screenDirZ = avgDirZ;

    // One mesh per SPECTRUM band, always -- update() toggles `isVisible` per-frame rather than
    // creating/destroying meshes, since which colors are valid changes every frame as the
    // turntable wobbles.
    for (let i = 0; i < SPECTRUM.length; i++) {
      const band = SPECTRUM[i]!;

      // P0-3: thin tapered exit ray, CIE-luminosity-compensated emissive so the full band reads
      // (red is not visually lost against yellow/green). The ray is terminated per-frame at its
      // real detector-plane intersection (scale.y = remaining segment length).
      const emissive = new Color(
        band.color.r * 2.2 * band.luminosity,
        band.color.g * 2.2 * band.luminosity,
        band.color.b * 2.2 * band.luminosity,
      );
      const rayMat = new StandardMaterial({
        color: new Color(0.9, 0.9, 0.9, 0.35),
        emissiveColor: emissive,
        emissiveIntensity: 0.65,
        transparent: true,
      });

      const rayMesh = new Object3D(`SpectralRay_${band.name}`);
      rayMesh.geometry = new Cylinder({
        radiusTop: 0.01,
        radiusBottom: 0.016,
        height: SPECTRAL_RAY_LENGTH,
        radialSegments: 12,
      }).getGeometryData();
      rayMesh.material = rayMat;
      rayMesh.rotation.z = Math.PI / 2;
      rayMesh.isVisible = false;
      this.scene.add(rayMesh);
      this._spectralRays.push(rayMesh);
    }

    // P0-5: ONE faint white internal segment (average entry -> average exit path), visible only
    // while the full band is valid. A separate segment per band would stack ~7x over the
    // near-identical internal path and blow out the glass interior.
    this._internalPath = new Object3D("InternalBeamPath");
    this._internalPath.geometry = new Cylinder({
      radiusTop: 0.011,
      radiusBottom: 0.011,
      height: 1,
      radialSegments: 8,
    }).getGeometryData();
    this._internalPath.material = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0, 0.15),
      emissiveColor: new Color(0.85, 0.9, 0.95),
      emissiveIntensity: 0.95,
      transparent: true,
    });
    this._internalPath.rotation.z = Math.PI / 2;
    this._internalPath.isVisible = false;
    this.scene.add(this._internalPath);

    // P0-3: the spectrum terminates as ONE continuous red->violet gradient band on the detector,
    // generated as an emissive canvas texture (see _createBandGradientTexture) so it renders as a
    // single smooth smear -- no discrete hue blocks, and the 8-bit ceil forbids any white core.
    this._bandMesh = new Object3D("Band_Gradient");
    this._bandMesh.geometry = new Cube({ size: 1 }).getGeometryData();
    this._bandMesh.material = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      emissiveColor: new Color(1.0, 1.0, 1.0),
      emissiveIntensity: 1.35,
      emissiveMap: this._createBandGradientTexture(),
      transparent: true,
    });
    this._bandMesh.isVisible = false;
    this.scene.add(this._bandMesh);

    // Soft chromatic caustic reflection wash on the anodized bench surface
    const causticMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      emissiveColor: new Color(0.9, 0.95, 1.0),
      emissiveIntensity: 0.35,
      emissiveMap: this._createCausticGradientTexture(),
      transparent: true,
      roughness: 0.9,
    });
    this._floorCausticMesh = new Object3D("BenchCausticSpill");
    this._floorCausticMesh.geometry = new Cube({ size: 1 }).getGeometryData();
    this._floorCausticMesh.material = causticMat;
    this._floorCausticMesh.position.set(0, 0.005, 0);
    this._floorCausticMesh.isVisible = false;
    this.scene.add(this._floorCausticMesh);

    // Coherent first frame; update() re-derives and repositions everything every frame.
    this._updateSpectralVisuals(initialRays);

    // Wire up in-viewport Inspector and Maker integration
    this._setupInspector();
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

    // Floor caustic spill: subtle chromatic wash on the anodized bench surface under the rays
    if (this._floorCausticMesh) {
      if (validCount > 0) {
        let avgImpactX = 0;
        let avgImpactZ = 0;
        let impactCount = 0;
        for (const imp of impacts) {
          if (!imp) continue;
          avgImpactX += imp.x;
          avgImpactZ += imp.y;
          impactCount++;
        }
        if (impactCount > 0) {
          avgImpactX /= impactCount;
          avgImpactZ /= impactCount;
          const dx = avgImpactX - avgExitX;
          const dz = avgImpactZ - avgExitZ;
          const len = Math.hypot(dx, dz);
          if (len > 1e-4) {
            this._floorCausticMesh.rotation.y = Math.atan2(-dz, dx);
            this._floorCausticMesh.position.set(
              (avgExitX + avgImpactX) / 2,
              0.005,
              (avgExitZ + avgImpactZ) / 2,
            );
            this._floorCausticMesh.scale.set(len, 0.002, 1.6);
            this._floorCausticMesh.isVisible = true;
          } else {
            this._floorCausticMesh.isVisible = false;
          }
        } else {
          // Free-flight caustics across the bench
          let avgDirX = 0;
          let avgDirZ = 0;
          for (const ray of rays) {
            if (!ray) continue;
            avgDirX += ray.direction.x;
            avgDirZ += ray.direction.y;
          }
          const dirLen = Math.hypot(avgDirX, avgDirZ);
          if (dirLen > 1e-4) {
            avgDirX /= dirLen;
            avgDirZ /= dirLen;
            const reach = 3.6;
            this._floorCausticMesh.rotation.y = Math.atan2(-avgDirZ, avgDirX);
            this._floorCausticMesh.position.set(
              avgExitX + avgDirX * (reach / 2),
              0.005,
              avgExitZ + avgDirZ * (reach / 2),
            );
            this._floorCausticMesh.scale.set(reach, 0.002, 1.6);
            this._floorCausticMesh.isVisible = true;
          } else {
            this._floorCausticMesh.isVisible = false;
          }
        }
      } else {
        this._floorCausticMesh.isVisible = false;
      }
    }
  }

  /** Keyboard shortcuts:
   *  - Arrow Left / Arrow Right: immediately engages manual turntable rotation (pauses auto-wobble).
   *  - Arrow Up / Arrow Down: moves 50:50 Beam Splitter along the optical dovetail rail.
   *  - Shift + Arrow: high-speed nudging / fast translation & rotation.
   *  - M: toggles Beam Splitter bypass (active vs full 100% laser pass-through).
   *  - Space: toggles between manual turntable control and automatic oscillation.
   *  - I: toggles Lab Inspector.
   */
  protected override onKeyDown(event: KeyboardEvent): void {
    if (
      document.activeElement &&
      ("INPUT" === document.activeElement.tagName || "TEXTAREA" === document.activeElement.tagName)
    ) {
      return;
    }
    const isInspectorActive =
      this._inspectorOpen &&
      (this._isHoveringInspector ||
        this._isDraggingInspector ||
        (undefined !== this._inspectorDrawer &&
          this._inspectorDrawer.contains(document.activeElement)));
    if (isInspectorActive) {
      if ("KeyI" === event.code) {
        event.preventDefault();
        this._toggleInspector();
      }
      return;
    }
    super.onKeyDown(event);
    if ("KeyI" === event.code) {
      event.preventDefault();
      this._toggleInspector();
      return;
    }
    if (Keys.LEFT === event.code || Keys.RIGHT === event.code) {
      event.preventDefault();
      if (!this._manualTurntableControl && this._turntable) {
        this._manualTurntableControl = true;
        this._manualTurntableAngle = this._turntable.rotation.y;
      }
    } else if (Keys.UP === event.code || Keys.DOWN === event.code) {
      event.preventDefault();
    } else if ("KeyM" === event.code) {
      event.preventDefault();
      this._splitterActive = !this._splitterActive;
    } else if (Keys.SPACE === event.code) {
      event.preventDefault();
      this._manualTurntableControl = !this._manualTurntableControl;
      if (this._manualTurntableControl && this._turntable) {
        this._manualTurntableAngle = this._turntable.rotation.y;
      } else if (!this._manualTurntableControl && this._turntable) {
        // Re-align auto-wobble phase with current angle to avoid jump
        const clampedRatio = Math.max(-0.999, Math.min(0.999, this._turntable.rotation.y / 0.12));
        this._time = Math.asin(clampedRatio) / 0.6;
      }
    }
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime * 0.5;

    const isInspectorActive =
      this._inspectorOpen &&
      (this._isHoveringInspector ||
        this._isDraggingInspector ||
        (undefined !== this._inspectorDrawer &&
          this._inspectorDrawer.contains(document.activeElement)));

    // 50:50 Beam Splitter navigation on optical rail (UP/DOWN arrow keys)
    const isUp = !isInspectorActive && this.input.isPressed(Keys.UP);
    const isDown = !isInspectorActive && this.input.isPressed(Keys.DOWN);
    if (isUp || isDown) {
      const isShift = this.input.isPressed(Keys.SHIFT_L) || this.input.isPressed(Keys.SHIFT_R);
      const railSpeed = isShift ? 2.4 : 1.1; // units/s
      if (isUp) {
        this._splitterX = Math.min(-1.15, this._splitterX + railSpeed * deltaTime);
      }
      if (isDown) {
        this._splitterX = Math.max(-3.35, this._splitterX - railSpeed * deltaTime);
      }
    }

    if (this._splitterCarriage) {
      this._splitterCarriage.position.x = this._splitterX;
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
        if (!this._manualTurntableControl) {
          this._manualTurntableControl = true;
          this._manualTurntableAngle = this._turntable.rotation.y;
        }
      }

      if (this._manualTurntableControl) {
        // Manual mode: auto-wobble is paused, LEFT/RIGHT spin the turntable by hand.
        const isShift = this.input.isPressed(Keys.SHIFT_L) || this.input.isPressed(Keys.SHIFT_R);
        const manualSpeed = isShift ? 1.5 : 0.6; // rad/s (halved for fine precision control)
        if (isLeft) {
          this._manualTurntableAngle -= manualSpeed * deltaTime;
        }
        if (isRight) {
          this._manualTurntableAngle += manualSpeed * deltaTime;
        }
        this._turntable.rotation.y = this._manualTurntableAngle;
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
    const splitX = this._splitterX;

    if (this._incidentBeamBefore) {
      const lenBefore = splitX - emitterX;
      this._incidentBeamBefore.position.set((emitterX + splitX) / 2, 1.8, 0);
      this._incidentBeamBefore.scale.set(1, lenBefore, 1);
    }

    if (this._incidentBeamAfter) {
      const lenAfter = Math.max(0.01, prismEntryX - splitX);
      this._incidentBeamAfter.position.set((splitX + prismEntryX) / 2, 1.8, 0);
      this._incidentBeamAfter.scale.set(1, lenAfter, 1);
      (this._incidentBeamAfter.material as StandardMaterial).emissiveIntensity = this
        ._splitterActive
        ? 0.65
        : 1.1;
    }

    if (this._reflectedBeam) {
      this._reflectedBeam.position.set(splitX, 1.8, -1.1);
      this._reflectedBeam.isVisible = this._splitterActive;
    }

    if (this._refSensorSpot) {
      this._refSensorSpot.position.set(splitX, 1.8, -2.18);
      this._refSensorSpot.isVisible = this._splitterActive;
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

    if (this._inspectorOpen && this._selectedObject) {
      this._syncHighlight();
    }
  }

  private _isExcludedFromHierarchy(obj: Object3D): boolean {
    return (
      obj === this._highlightMesh ||
      obj.name === "EditorHighlight" ||
      obj.name.startsWith("SpectralRay_") ||
      obj.name.startsWith("IncidentBeam_") ||
      obj.name === "ReflectedBeam_90Deg" ||
      obj.name === "RefSensorSpot" ||
      obj.name === "InternalBeamPath" ||
      obj.name === "Band_Gradient" ||
      obj.name === "BenchCausticSpill" ||
      obj.name === "Skybox"
    );
  }

  private _collectPickable(parent: Object3D, out: Object3D[]): void {
    if (this._isExcludedFromHierarchy(parent)) return;
    if (parent.isVisible && parent.geometry) {
      parent.computeBounds();
      out.push(parent);
    }
    for (const child of parent.children) {
      this._collectPickable(child, out);
    }
  }

  private _pickFromScreen(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2D(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(ndc, this.camera);
    const pickables: Object3D[] = [];
    this._collectPickable(this.scene.root, pickables);
    const hits = this._raycaster.intersectObjects(pickables, true);
    const hitObj = hits.length > 0 ? hits[0]!.object : undefined;
    this._selectObject(hitObj);
  }

  private _selectObject(obj: Object3D | undefined): void {
    this._selection.clear();
    if (obj) {
      this._selection.add(obj);
    }
    this._selectedObject = obj;
    this._propertyPanel?.setSelection(obj);
    this._hierarchyPanel?.setSelected(this._selection);
    this._syncHighlight();
  }

  private _syncHighlight(): void {
    if (!this._highlightMesh) {
      const hl = new Object3D("EditorHighlight");
      hl.geometry = new Cube({ size: 1 }).getGeometryData();
      hl.material = new WireframeMaterial(new Color(0, 0.85, 1));
      hl.isVisible = false;
      this.scene.add(hl);
      this._highlightMesh = hl;
    }
    const hl = this._highlightMesh;
    if (!this._inspectorOpen || !this._selectedObject) {
      hl.isVisible = false;
      return;
    }
    const obj = this._selectedObject;
    if (obj.geometry) {
      obj.computeBounds();
    }
    if (!obj.bounds) {
      hl.isVisible = false;
      return;
    }
    const epsilon = new Vector3D(0.015, 0.015, 0.015);
    if (BoundingType.BOX === obj.bounds.type) {
      const box = obj.bounds as BoundingBox;
      const size = new Vector3D().copyFrom(box.max).sub(box.min).add(epsilon);
      hl.position.copyFrom(box.center);
      hl.rotation.set(0, 0, 0);
      hl.scale.copyFrom(size);
      hl.updateMatrixWorld();
      hl.isVisible = true;
    } else if (BoundingType.SPHERE === obj.bounds.type) {
      const sphere = obj.bounds as BoundingSphere;
      const diameter = sphere.radius * 2;
      const size = new Vector3D(diameter, diameter, diameter).add(epsilon);
      hl.position.copyFrom(sphere.center);
      hl.rotation.set(0, 0, 0);
      hl.scale.copyFrom(size);
      hl.updateMatrixWorld();
      hl.isVisible = true;
    } else {
      hl.isVisible = false;
    }
  }

  private _toggleInspector(force?: boolean): void {
    this._inspectorOpen = undefined !== force ? force : !this._inspectorOpen;
    if (!this._inspectorOpen) {
      this._isHoveringInspector = false;
      this._isDraggingInspector = false;
      if (this._orbitController) {
        this._orbitController.enabled = true;
      }
    }
    if (this._inspectorToggleBtn) {
      if (this._inspectorOpen) {
        this._inspectorToggleBtn.classList.add("active");
      } else {
        this._inspectorToggleBtn.classList.remove("active");
      }
    }
    if (this._inspectorDrawer) {
      if (this._inspectorOpen) {
        this._inspectorDrawer.classList.add("open");
        this._hierarchyPanel?.refresh();
        this._syncHighlight();
      } else {
        this._inspectorDrawer.classList.remove("open");
        if (this._highlightMesh) {
          this._highlightMesh.isVisible = false;
        }
      }
    }
  }

  private _setupInspector(): void {
    if (typeof document === "undefined") return;

    // Inject styling for the Lab Inspector drawer and hierarchy panel
    const styleId = "swm-showcase28-inspector-styles";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .swm-inspector-btn {
          position: fixed;
          bottom: 5px;
          right: 14px;
          width: 26px;
          height: 26px;
          z-index: 10001;
          pointer-events: auto;
          background: var(--tool-card, rgba(22, 29, 45, 0.85));
          color: var(--tool-text, #f8fafc);
          border: 1px solid var(--tool-border, rgba(148, 163, 184, 0.25));
          border-radius: var(--tool-radius-sm, 4px);
          padding: 0;
          font-size: 0.95rem;
          cursor: pointer;
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }
        .swm-inspector-btn:hover {
          border-color: var(--tool-accent, #ffb84d);
          color: var(--tool-accent, #ffb84d);
          box-shadow: 0 0 10px var(--tool-accent-glow, rgba(255, 184, 77, 0.3));
        }
        .swm-inspector-btn.active {
          background: rgba(255, 184, 77, 0.15);
          border-color: var(--tool-accent, #ffb84d);
          color: var(--tool-accent, #ffb84d);
          box-shadow: 0 0 8px var(--tool-accent-glow, rgba(255, 184, 77, 0.25));
        }
        .swm-inspector-drawer {
          position: fixed;
          top: 0;
          right: 0;
          width: 320px;
          height: calc(100vh - 36px);
          background: var(--tool-panel, rgba(14, 18, 28, 0.95));
          backdrop-filter: blur(16px);
          border-left: 1px solid var(--tool-border, rgba(148, 163, 184, 0.2));
          border-bottom: 1px solid var(--tool-border, rgba(148, 163, 184, 0.2));
          color: var(--tool-text, #f8fafc);
          z-index: 10000;
          display: flex;
          flex-direction: column;
          box-shadow: -6px 0 32px rgba(0, 0, 0, 0.6);
          transform: translateX(100%);
          transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          font-family: var(--tool-font-ui, sans-serif);
        }
        .swm-inspector-drawer.open {
          transform: translateX(0);
        }
        .swm-inspector-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          border-bottom: 1px solid var(--tool-border, rgba(148, 163, 184, 0.15));
          background: var(--tool-panel-solid, #0e121c);
        }
        .swm-inspector-title {
          font-size: 0.9rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--tool-text, #f8fafc);
          margin: 0;
        }
        .swm-inspector-close-btn {
          background: none;
          border: none;
          color: var(--tool-text-muted, #94a3b8);
          font-size: 1.1rem;
          cursor: pointer;
          padding: 2px 6px;
          line-height: 1;
        }
        .swm-inspector-close-btn:hover {
          color: var(--tool-danger, #ef4444);
        }
        .swm-inspector-body {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }
        .swm-inspector-section {
          border-bottom: 1px solid var(--tool-border, rgba(148, 163, 184, 0.15));
          display: flex;
          flex-direction: column;
        }
        .swm-inspector-section-header {
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          padding: 8px 12px 6px;
          color: var(--tool-accent, #ffb84d);
          background: rgba(255, 255, 255, 0.02);
          border-bottom: 1px solid rgba(148, 163, 184, 0.1);
        }
        .swm-inspector-pane-wrap {
          padding: 6px;
        }
        .swm-inspector-hierarchy-wrap {
          padding: 6px;
          background: rgba(10, 14, 22, 0.6);
        }
        .maker-hierarchy {
          display: flex;
          flex-direction: column;
        }
        .maker-hierarchy-search-wrapper {
          margin-bottom: 6px;
        }
        .maker-hierarchy-search-input {
          width: 100%;
          box-sizing: border-box;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 4px;
          color: #f8fafc;
          padding: 4px 8px;
          font-size: 0.78rem;
          font-family: inherit;
        }
        .maker-hierarchy-search-input:focus {
          outline: none;
          border-color: var(--tool-accent, #ffb84d);
        }
        .maker-hierarchy-tree {
          overflow-y: auto;
          max-height: 260px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding-right: 2px;
        }
        .maker-hierarchy-row {
          flex-shrink: 0;
          height: 24px;
          line-height: 24px;
          padding-top: 0;
          padding-bottom: 0;
          padding-right: 8px;
          font-family: var(--tool-font-mono, monospace);
          font-size: 0.8rem;
          color: #cbd5e1;
          cursor: pointer;
          user-select: none;
          border-radius: 3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          box-sizing: border-box;
          display: flex;
          align-items: center;
        }
        .maker-hierarchy-row:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
        }
        .maker-hierarchy-row.selected {
          background: rgba(255, 184, 77, 0.22);
          color: var(--tool-accent, #ffb84d);
          font-weight: 600;
        }
        .maker-hierarchy-rename-input {
          background: rgba(15, 23, 42, 0.95);
          border: 1px solid var(--tool-accent, #ffb84d);
          border-radius: 3px;
          color: #fff;
          padding: 2px 6px;
          font-size: 0.8rem;
          font-family: var(--tool-font-mono, monospace);
          width: 100%;
          height: 22px;
          box-sizing: border-box;
        }
      `;
      document.head.appendChild(style);
    }

    // Toggle button in Footer
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "swm-inspector-btn";
    toggleBtn.innerHTML = "<span>⚙</span>";
    toggleBtn.title = "Toggle Lab Inspector Panel (Key: I)";
    toggleBtn.onclick = (): void => {
      this._toggleInspector();
    };
    this._inspectorToggleBtn = toggleBtn;

    const footer = document.querySelector(".app-footer");
    if (footer) {
      footer.appendChild(toggleBtn);
    } else {
      document.body.appendChild(toggleBtn);
    }

    // Inspector Drawer
    const drawer = document.createElement("aside");
    drawer.className = "swm-inspector-drawer";
    this._inspectorDrawer = drawer;

    drawer.innerHTML = `
      <header class="swm-inspector-header">
        <h3 class="swm-inspector-title">Lab Inspector</h3>
        <button id="swmInspectorClose" class="swm-inspector-close-btn" title="Close Inspector">✕</button>
      </header>
      <div class="swm-inspector-body">
        <div class="swm-inspector-section">
          <div class="swm-inspector-section-header">Lab Parameters</div>
          <div id="swmInspectorParams" class="swm-inspector-pane-wrap"></div>
        </div>
        <div class="swm-inspector-section">
          <div class="swm-inspector-section-header">Scene Hierarchy</div>
          <div id="swmInspectorHierarchy" class="swm-inspector-hierarchy-wrap"></div>
        </div>
        <div class="swm-inspector-section">
          <div class="swm-inspector-section-header">Selected Object</div>
          <div id="swmInspectorProps" class="swm-inspector-pane-wrap"></div>
        </div>
      </div>
    `;
    document.body.appendChild(drawer);

    // Isolate mouse, wheel, touch, and pointer events inside drawer so camera orbit and zoom are never triggered
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
      "keydown",
      "keyup",
      "click",
      "dblclick",
      "contextmenu",
    ];
    for (const ev of stopEvents) {
      drawer.addEventListener(
        ev,
        (e) => {
          e.stopPropagation();
          if ("wheel" === ev) {
            this.input.mouse.zoom = 0;
            this.input.mouse.wheelX = 0;
            this.input.mouse.wheelY = 0;
          }
        },
        { passive: "wheel" === ev || "touchstart" === ev || "touchmove" === ev },
      );
    }

    drawer.addEventListener("pointerenter", () => {
      this._isHoveringInspector = true;
      if (this._orbitController) {
        this._orbitController.enabled = false;
      }
    });

    drawer.addEventListener("pointerleave", (e: PointerEvent) => {
      if (0 === e.buttons && !this._isDraggingInspector) {
        this._isHoveringInspector = false;
        if (this._orbitController) {
          this._orbitController.enabled = true;
        }
      }
    });

    drawer.addEventListener("pointerdown", () => {
      this._isHoveringInspector = true;
      this._isDraggingInspector = true;
      if (this._orbitController) {
        this._orbitController.enabled = false;
      }
      this.input.mouse.dx = 0;
      this.input.mouse.dy = 0;
      this.input.mouse.zoom = 0;
      this.input.mouse.left = false;
    });

    window.addEventListener("pointerup", () => {
      this._isDraggingInspector = false;
      if (!this._inspectorDrawer?.matches(":hover")) {
        this._isHoveringInspector = false;
        if (this._orbitController) {
          this._orbitController.enabled = true;
        }
      }
    });

    drawer.querySelector("#swmInspectorClose")?.addEventListener("click", (): void => {
      this._toggleInspector(false);
    });

    // Lab quick params pane
    const paramsContainer = drawer.querySelector("#swmInspectorParams") as HTMLElement;
    if (paramsContainer) {
      const pane = new Pane({ container: paramsContainer });

      const fTurntable = pane.addFolder({ title: "Prism & Turntable", expanded: true });
      const currentDeg = this._turntable ? MathUtils.radToDeg(this._turntable.rotation.y) : 0;
      fTurntable
        .addBinding({ angleDeg: currentDeg }, "angleDeg", {
          min: -180,
          max: 180,
          step: 0.5,
          label: "Stage Angle",
        })
        .on("change", (ev) => {
          if (!this._manualTurntableControl) {
            this._manualTurntableControl = true;
          }
          this._manualTurntableAngle = MathUtils.degToRad(ev.value);
          if (this._turntable) this._turntable.rotation.y = this._manualTurntableAngle;
        });

      fTurntable
        .addBinding({ autoWobble: !this._manualTurntableControl }, "autoWobble", {
          label: "Auto-Wobble",
        })
        .on("change", (ev) => {
          this._manualTurntableControl = !ev.value;
          if (this._manualTurntableControl && this._turntable) {
            this._manualTurntableAngle = this._turntable.rotation.y;
          }
        });

      const fSplitter = pane.addFolder({ title: "50:50 Beam Splitter", expanded: true });
      fSplitter
        .addBinding({ splitterX: this._splitterX }, "splitterX", {
          min: -3.35,
          max: -1.15,
          step: 0.05,
          label: "Rail Pos X",
        })
        .on("change", (ev) => {
          this._splitterX = ev.value;
        });

      fSplitter
        .addBinding({ active: this._splitterActive }, "active", {
          label: "Splitter Engaged",
        })
        .on("change", (ev) => {
          this._splitterActive = ev.value;
        });

      const fOptics = pane.addFolder({ title: "Optics & Glass", expanded: false });
      if (this._prismMesh && this._prismMesh.material instanceof GlassMaterial) {
        const gm = this._prismMesh.material;
        fOptics.addBinding(gm, "ior", { min: 1.1, max: 2.2, step: 0.01, label: "Prism IOR" });
        fOptics.addBinding(gm, "roughness", {
          min: 0.0,
          max: 0.35,
          step: 0.01,
          label: "Roughness",
        });
        fOptics.addBinding(gm, "thickness", { min: 0.1, max: 1.5, step: 0.05, label: "Thickness" });
      }

      const fLight = pane.addFolder({ title: "Laser & Bloom", expanded: false });
      if (this._laserLight) {
        fLight.addBinding(this._laserLight, "intensity", {
          min: 0.5,
          max: 6.0,
          step: 0.1,
          label: "Laser Power",
        });
      }
      const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
      if (bloom) {
        fLight.addBinding(bloom, "intensity", {
          min: 0.0,
          max: 1.2,
          step: 0.05,
          label: "Bloom Glow",
        });
      }
    }

    // Hierarchy Panel integration
    const hierarchyContainer = drawer.querySelector("#swmInspectorHierarchy") as HTMLElement;
    if (hierarchyContainer) {
      this._hierarchyPanel = new HierarchyPanel(
        hierarchyContainer,
        () => this.scene.root,
        {
          onSelect: (obj): void => {
            this._selectObject(obj);
          },
          onReparent: (): void => {},
          onRename: (obj, newName): void => {
            obj.name = newName;
            this._hierarchyPanel?.refresh();
          },
        },
        (obj): boolean => this._isExcludedFromHierarchy(obj),
      );
    }

    // Property Panel integration
    const propsContainer = drawer.querySelector("#swmInspectorProps") as HTMLElement;
    if (propsContainer) {
      this._propertyPanel = new PropertyPanel(propsContainer, this._undo, {
        onPropertyChanged: (_obj, propKey): void => {
          if ("name" === propKey) {
            this._hierarchyPanel?.refresh();
          }
        },
      });
    }

    // Viewport 3D object picking on canvas pointer interaction
    this.canvas.addEventListener("pointerdown", (event: PointerEvent) => {
      if (0 === event.button) {
        this._pointerDownPos = { x: event.clientX, y: event.clientY };
      }
    });

    this.canvas.addEventListener("pointerup", (event: PointerEvent) => {
      if (!this._inspectorOpen || 0 !== event.button || !this._pointerDownPos) {
        return;
      }
      const dx = event.clientX - this._pointerDownPos.x;
      const dy = event.clientY - this._pointerDownPos.y;
      this._pointerDownPos = null;
      if (Math.hypot(dx, dy) > 5) {
        return;
      }
      this._pickFromScreen(event.clientX, event.clientY);
    });
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase28();
attachDevTools(app);
// QA instrumentation hook for the browser capture scripts. Set unconditionally -- the example is
// browser-only, the property is inert, and the repo typechecks without "vite/client" in the
// tsconfig "types", so an import.meta.env guard would only trip the compiler for no gain here.
if (typeof window !== "undefined") {
  const w = window as Window & { __showcase28?: Showcase28 };
  w.__showcase28 = app;
}
app.start().catch((err: unknown) => console.error("[Showcase28] Failed to start:", err));
