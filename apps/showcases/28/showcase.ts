import {
  AbstractShowcase,
  AmbientLight,
  BloomElement,
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
  VignetteElement,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

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
  const entryA = vertices[1]!;
  const entryB = vertices[2]!;
  const otherFaces: [Vector2D, Vector2D][] = [
    [vertices[0]!, vertices[1]!],
    [vertices[2]!, vertices[0]!],
  ];

  // The beam travels along z = 0; intersect that line with the entry edge to get the real entry
  // point instead of assuming one.
  const tEntry = (0 - entryA.y) / (entryB.y - entryA.y);
  const entryPoint = new Vector2D(entryA.x + tEntry * (entryB.x - entryA.x), 0);
  const entryNormal = outwardFaceNormal(entryA, entryB);
  const incidentDir = new Vector2D(1, 0);

  const rays: (SpectralRay | undefined)[] = [];
  for (const band of SPECTRUM) {
    // Real, dense-flint-glass Cauchy dispersion -- consistent with this showcase's own
    // "n = 1.65 flint glass" comment on the prism material (real n ranges ~1.629 red to ~1.688
    // violet with this preset).
    const n = Optics.cauchyIndex(band.wavelengthNm, CauchyMaterials.FLINT_GLASS);
    const internalDir = Optics.refract(incidentDir, entryNormal, 1.0, n);
    if (!internalDir) {
      rays.push(undefined);
      continue;
    }

    let exitPoint: Vector2D | undefined;
    let exitFace: [Vector2D, Vector2D] | undefined;
    const internalRay = new Ray2D(entryPoint, internalDir);
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
      entryPoint,
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
    // P0-2 moved the resting pose. User can still orbit via OrbitController / Ctrl+T.
    this.camera.position.set(5.4, 3.4, -4.6);
    this.camera.target.set(1.4, 1.45, 2.6);
    this.camera.addBehavior(new OrbitController({ input: this.input, audio: this.audio }));

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
      color: new Color(0.85, 0.95, 1.0),
      ior: 1.65,
      thickness: 0.8,
      transmission: 1.0,
      roughness: 0.04,
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
    // cap of <= 3 SpotLights (laser + key = 2). Kept WIDE and WEAK so it shades facets softly
    // instead of throwing the harsh circular hotspot the earlier tight 6.0 cone left on the glass.
    const keyGlintSpot = new SpotLight({
      color: new Color(1.0, 1.0, 1.0),
      intensity: 2.5,
      distance: 9,
      angle: Math.PI / 6,
      penumbra: 0.5,
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

    // Coherent Incident White Laser Beam -- bright but not overdriven
    const incidentBeamMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      emissiveColor: new Color(1.5, 1.5, 1.5),
      emissiveIntensity: 0.9,
      transparent: true,
    });
    const incidentBeam = new Object3D("IncidentBeam");
    incidentBeam.geometry = new Cylinder({
      radiusTop: 0.03,
      radiusBottom: 0.03,
      height: 3.8,
      radialSegments: 16,
    }).getGeometryData();
    incidentBeam.material = incidentBeamMat;
    incidentBeam.rotation.z = Math.PI / 2;
    incidentBeam.position.set(-2.2, 1.8, 0);
    this.scene.add(incidentBeam);

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
      gCtx.strokeStyle = "rgba(255,255,255,0.55)";
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
      gCtx.beginPath();
      gCtx.moveTo(256, 0);
      gCtx.lineTo(256, 640);
      gCtx.moveTo(0, 320);
      gCtx.lineTo(512, 320);
      gCtx.stroke();
      const graticuleTex = Texture.fromCanvas(graticuleCanvas, {
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
      // Local +X is the panel's outward face; riding 0.17 units proud of the absorber keeps the
      // graticule above the face while never intersecting the panel body or the incoming rays.
      graticule.position.set(0.17, 0, 0);
      graticule.receiveShadow = true;
      screenPanel.add(graticule);
    }

    // Store the detector's RECEIVING face plane (world XZ) for live ray termination: the surface
    // the beam physically hits is the panel face pointing back toward the fan (center minus half
    // the 0.3 thickness along the travel axis).
    this._screenFaceX = avgExitX + avgDirX * SCREEN_DISTANCE - avgDirX * 0.15;
    this._screenFaceZ = avgExitZ + avgDirZ * SCREEN_DISTANCE - avgDirZ * 0.15;
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
        emissiveIntensity: 0.15,
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
      color: new Color(1.0, 1.0, 1.0, 0.1),
      emissiveColor: new Color(0.25, 0.25, 0.25),
      emissiveIntensity: 0.6,
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
      emissiveIntensity: 0.95,
      emissiveMap: this._createBandGradientTexture(),
      transparent: true,
    });
    this._bandMesh.isVisible = false;
    this.scene.add(this._bandMesh);

    // Coherent first frame; update() re-derives and repositions everything every frame.
    this._updateSpectralVisuals(initialRays);
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
      const valid = undefined !== ray && undefined !== impact;
      const rayMesh = this._spectralRays[i]!;
      rayMesh.isVisible = valid;
      if (!valid) continue;

      // exit ray terminates exactly where it physically lands on the detector face -- the rays are
      // dim enough now that no bright tip stacks onto the band (the earlier blown-out white core
      // came from the old 2.2-HDR tips; truncating early only created a visible air-gap instead).
      const t = Math.hypot(impact!.x - ray!.origin.x, impact!.y - ray!.origin.y);
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

    // P0-3: one continuous gradient band laid from the red impact to the violet impact. The ramp
    // texture's left edge (red) maps to local +X, so rotating the smear along the red->violet
    // chord guarantees the spectrum order is physically correct at the endpoints.
    if (this._bandMesh) {
      const first = impacts[0];
      const last = impacts[impacts.length - 1];
      const dx = undefined !== first && undefined !== last ? last.x - first.x : 0;
      const dz = undefined !== first && undefined !== last ? last.y - first.y : 0;
      const bandLen = Math.hypot(dx, dz);
      if (undefined !== first && undefined !== last && bandLen > 1e-4) {
        this._bandMesh.rotation.y = Math.atan2(-dz, dx);
        this._bandMesh.position.set((first.x + last.x) / 2, 1.8, (first.y + last.y) / 2);
        this._bandMesh.scale.set(bandLen, 0.36, 0.03);
        this._bandMesh.isVisible = true;
      } else {
        this._bandMesh.isVisible = false;
      }
    }
  }

  /** Secret shortcut: Ctrl+T toggles manual turntable control (see `update()`'s LEFT/RIGHT handling). */
  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (Keys.T === event.code && event.ctrlKey) {
      event.preventDefault();
      this._manualTurntableControl = !this._manualTurntableControl;
      if (this._manualTurntableControl && this._turntable) {
        this._manualTurntableAngle = this._turntable.rotation.y;
      }
    }
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime * 0.5;

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
      if (this._manualTurntableControl) {
        // Manual mode: auto-wobble is paused, LEFT/RIGHT spin the turntable by hand.
        const manualSpeed = 1.5; // rad/s
        if (this.input.isPressed(Keys.LEFT)) {
          this._manualTurntableAngle -= manualSpeed * deltaTime;
        }
        if (this.input.isPressed(Keys.RIGHT)) {
          this._manualTurntableAngle += manualSpeed * deltaTime;
        }
        this._turntable.rotation.y = this._manualTurntableAngle;
      } else {
        // Gentle slow turntable rotation showcasing prism facets and refraction shifts. P0-2:
        // amplitude narrowed to +-0.12 rad, the verified full-spectrum window (all 7 bands stay
        // valid at every angle in it -- numeric gate over the whole range).
        this._turntable.rotation.y = Math.sin(this._time * 0.6) * 0.12;
      }
    }

    // The spectral rays must track the turntable's live wobble: the prism's actual world
    // rotation (base + wobble) determines the entry incidence angle, which determines every
    // downstream Snell's-law refraction -- exit point, exit direction, and whether a given color
    // clears the far face's critical angle at all. With the re-tuned 50deg/+-0.12 rad resting
    // window all 7 bands are valid throughout (verified by a full-range scan), so the per-frame
    // re-derivation below always produces the complete fan, spectrum band and internal path.
    if (this._turntable && this._prismMesh) {
      const liveRays = computeSpectralRays(this._prismMesh.rotation.y + this._turntable.rotation.y);
      this._updateSpectralVisuals(liveRays);
    }

    // Floating gem removed per plan P1-4 (default remove).

    // Dynamic spectral pulse oscillation (thickness only -- scale.y carries the live ray length)
    for (let i = 0; i < this._spectralRays.length; i++) {
      const ray = this._spectralRays[i];
      if (ray && ray.isVisible) {
        const pulse = 0.95 + Math.sin(this._time * 4.0 + i * 0.5) * 0.08;
        ray.scale.set(pulse, ray.scale.y, pulse);
      }
    }
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
