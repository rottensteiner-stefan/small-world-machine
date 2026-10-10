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
  HbaoElement,
  Keys,
  MathUtils,
  Object3D,
  Octahedron,
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
  Torus,
  Vector2D,
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
// the turntable's +-0.25 rad wobble (see update()). A shallower incidence angle (closer to the old,
// buggy edge-on 30 degrees) looks safer geometrically but is *not* -- it makes every color total-
// internally-reflect at the far face instead of exiting as a visible spectrum.
const NOMINAL_INCIDENCE_ANGLE = MathUtils.degToRad(44);
const SPECTRAL_RAY_LENGTH = 4.8;

interface SpectrumBand {
  name: string;
  color: Color;
  wavelengthNm: number;
}

const SPECTRUM: SpectrumBand[] = [
  { name: "Red", color: new Color(1.0, 0.05, 0.05), wavelengthNm: 700 },
  { name: "Orange", color: new Color(1.0, 0.45, 0.0), wavelengthNm: 620 },
  { name: "Yellow", color: new Color(1.0, 0.9, 0.05), wavelengthNm: 580 },
  { name: "Green", color: new Color(0.1, 1.0, 0.2), wavelengthNm: 530 },
  { name: "Cyan", color: new Color(0.05, 0.9, 1.0), wavelengthNm: 490 },
  { name: "Blue", color: new Color(0.1, 0.3, 1.0), wavelengthNm: 460 },
  { name: "Violet", color: new Color(0.7, 0.1, 1.0), wavelengthNm: 400 },
];

/** Outward normal of edge `a`-`b`, for a convex polygon centred on the origin (true here: the
 * prism's triangular cross-section is centred at world (0, 0) in XZ). */
function outwardFaceNormal(a: Vector2D, b: Vector2D): Vector2D {
  return new Vector2D((a.x + b.x) / 2, (a.y + b.y) / 2).normalize();
}

interface SpectralRay {
  name: string;
  color: Color;
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

    rays.push({ name: band.name, color: band.color, origin: exitPoint, direction: exitDir });
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
  private _gemMesh!: Object3D;
  private _laserLight!: SpotLight;
  private _spectralRays: Object3D[] = [];
  private _time = 0;
  // Secret manual-control mode: Ctrl+T pauses the automatic wobble and lets LEFT/RIGHT spin
  // the turntable by hand instead.
  private _manualTurntableControl = false;
  private _manualTurntableAngle = 0;

  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      ...options,
    });
  }

  protected override async setupScene(): Promise<void> {
    // Post-Processing: Vivid HDR Bloom for laser and dispersed spectral rays
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 1.4;
      bloom.threshold = 0.75;
    }

    const hbao = this.renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao) {
      hbao.enabled = true;
      hbao.radius = 0.6;
      hbao.intensity = 1.0;
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
    this.camera.position.set(0, 5.5, 11);
    this.camera.target.set(0, 1.2, 0);
    this.camera.addBehavior(new OrbitController({ input: this.input, audio: this.audio }));

    // Ambient Optical Environment (Dark cleanroom lab aesthetic)
    const ambientLight = new AmbientLight({
      color: new Color(0.04, 0.05, 0.08),
      intensity: 0.8,
    });
    this.scene.add(ambientLight);

    // Laboratory Overhead Soft Light
    const overheadLight = new DirectionalLight({
      color: new Color(0.9, 0.95, 1.0),
      intensity: 0.5,
    });
    overheadLight.direction.set(0.3, -1, -0.4);
    this.scene.add(overheadLight);

    // Load Environment Map & PBR Textures
    const envTexture = new CubeTexture();
    try {
      await envTexture.loadFrom("./assets/ibl/env.webp", CubeLayout.CROSS_HORIZONTAL);
      const skybox = new Object3D("Skybox");
      skybox.geometry = new Cube({ size: 1000 }).getGeometryData();
      skybox.material = new SkyboxMaterial({ cubeMap: envTexture });
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
      this.scene.environmentIntensity = 1.5;
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
        steelDiffuse.repeat.x = 4;
        steelDiffuse.repeat.y = 3;
      }
      steelNormal = await Texture.fromUrl("../shared/assets/scratched_steel_normal.webp");
      if (steelNormal) {
        steelNormal.repeat.x = 4;
        steelNormal.repeat.y = 3;
      }
      steelRoughness = await Texture.fromUrl("../shared/assets/scratched_steel_roughness.webp");
      if (steelRoughness) {
        steelRoughness.repeat.x = 4;
        steelRoughness.repeat.y = 3;
      }

      brassDiffuse = await Texture.fromUrl("../shared/assets/rusty_brass_diffuse.webp");
      brassNormal = await Texture.fromUrl("../shared/assets/rusty_brass_normal.webp");
      brassRoughness = await Texture.fromUrl("../shared/assets/rusty_brass_roughness.webp");
    } catch (e) {
      console.warn("Could not load PBR textures:", e);
    }

    // 1. Heavy Optical Isolation Bench (Anodized Aluminum Slab)
    const tableMat = new StandardMaterial({
      color: new Color(0.2, 0.22, 0.25),
      diffuseMap: steelDiffuse,
      normalMap: steelNormal,
      roughnessMap: steelRoughness,
      metallic: 0.95,
      roughness: 0.35,
      envMap: envTexture,
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

    // Rotary Optical Stage (Center turntable)
    this._turntable = new Object3D("TurntableStage");
    this._turntable.position.set(0, 0, 0);
    this.scene.add(this._turntable);

    const stageMat = new StandardMaterial({
      color: new Color(0.3, 0.32, 0.36),
      diffuseMap: steelDiffuse,
      normalMap: steelNormal,
      roughnessMap: steelRoughness,
      metallic: 0.95,
      roughness: 0.2,
      envMap: envTexture,
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

    // Brass Scale Ring around turntable
    const brassRingMat = new StandardMaterial({
      color: new Color(0.85, 0.7, 0.3),
      diffuseMap: brassDiffuse,
      normalMap: brassNormal,
      roughnessMap: brassRoughness,
      metallic: 0.9,
      roughness: 0.25,
      envMap: envTexture,
    });
    const dialRing = new Object3D("DialRing");
    dialRing.geometry = new Torus({
      radius: 2.3,
      tube: 0.04,
      radialSegments: 32,
      tubularSegments: 64,
    }).getGeometryData();
    dialRing.material = brassRingMat;
    dialRing.rotation.x = Math.PI / 2;
    dialRing.position.set(0, 0.15, 0);
    this._turntable.add(dialRing);

    // The Central Optical Prism (Equilateral triangular cylinder, n = 1.65 flint glass)
    const glassMat = new StandardMaterial({
      color: new Color(0.92, 0.96, 1.0),
      metallic: 0.1,
      roughness: 0.05,
      transparent: true,
      emissiveColor: new Color(0.1, 0.2, 0.35),
      emissiveIntensity: 0.3,
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

    // Secondary Floating Diamond Polyhedron
    const diamondMat = new StandardMaterial({
      color: new Color(1.0, 0.95, 1.0),
      metallic: 0.2,
      roughness: 0.02,
      transparent: true,
      emissiveColor: new Color(0.3, 0.15, 0.4),
      emissiveIntensity: 0.4,
    });
    this._gemMesh = new Object3D("DiamondOctahedron");
    this._gemMesh.geometry = new Octahedron({
      radius: 0.65,
    }).getGeometryData();
    this._gemMesh.material = diamondMat;
    this._gemMesh.position.set(2.8, 1.5, -1.2);
    this._gemMesh.castShadow = true;
    this.scene.add(this._gemMesh);

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

    // Glowing Laser Lens Aperture
    const laserLensMat = new StandardMaterial({
      color: new Color(1, 1, 1),
      emissiveColor: new Color(1.5, 1.5, 1.5),
      emissiveIntensity: 3.0,
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

    // Coherent Incident White Laser Beam
    const incidentBeamMat = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      emissiveColor: new Color(2.5, 2.5, 2.5),
      emissiveIntensity: 4.0,
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

    const screenMat = new StandardMaterial({
      color: new Color(0.9, 0.92, 0.95),
      metallic: 0.05,
      roughness: 0.85,
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

    // One mesh per SPECTRUM band, always -- update() toggles `isVisible` per-frame rather than
    // creating/destroying meshes, since which colors are valid changes every frame as the
    // turntable wobbles.
    for (let i = 0; i < SPECTRUM.length; i++) {
      const band = SPECTRUM[i]!;
      const ray = initialRays[i];

      const rayMat = new StandardMaterial({
        color: band.color,
        emissiveColor: new Color(band.color.r * 2.2, band.color.g * 2.2, band.color.b * 2.2),
        emissiveIntensity: 3.5,
        transparent: true,
      });

      const rayMesh = new Object3D(`SpectralRay_${band.name}`);
      rayMesh.geometry = new Cylinder({
        radiusTop: 0.02,
        radiusBottom: 0.04,
        height: SPECTRAL_RAY_LENGTH,
        radialSegments: 12,
      }).getGeometryData();
      rayMesh.material = rayMat;
      rayMesh.rotation.z = Math.PI / 2;
      rayMesh.isVisible = undefined !== ray;
      if (ray) this._positionSpectralRay(rayMesh, ray);
      this.scene.add(rayMesh);
      this._spectralRays.push(rayMesh);
    }
  }

  /** Positions/orients `rayMesh` to match `ray`'s computed exit point/direction. `rotation.z` above
   * points the cylinder's local +Y (height) axis along local +X; a further rotation.y by theta
   * turns that into world direction (cos theta, -sin theta) in (x, z) -- solve for theta given the
   * exit direction (see the module doc comment: `.y` on a `Vector2D` here stores world Z). */
  private _positionSpectralRay(rayMesh: Object3D, ray: SpectralRay): void {
    rayMesh.rotation.y = Math.atan2(-ray.direction.y, ray.direction.x);
    rayMesh.position.set(
      ray.origin.x + ray.direction.x * (SPECTRAL_RAY_LENGTH / 2),
      1.8,
      ray.origin.y + ray.direction.y * (SPECTRAL_RAY_LENGTH / 2),
    );
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
        // Gentle slow turntable rotation showcasing prism facets and refraction shifts
        this._turntable.rotation.y = Math.sin(this._time * 0.6) * 0.25;
      }
    }

    // The spectral rays must track the turntable's live wobble: the prism's actual world
    // rotation (base + wobble) determines the entry incidence angle, which determines every
    // downstream Snell's-law refraction -- exit point, exit direction, and whether a given color
    // clears the far face's critical angle at all. It doesn't: the wobble's +-0.25 rad swing is
    // wider than this flint-glass prism's total-internal-reflection-free window, so roughly the
    // upper half of each swing genuinely has no exit ray for one or more colors -- confirmed by
    // scanning the full wobble range, not a bug to "fix" by clamping the angle.
    if (this._turntable && this._prismMesh) {
      const liveRays = computeSpectralRays(this._prismMesh.rotation.y + this._turntable.rotation.y);
      for (let i = 0; i < this._spectralRays.length; i++) {
        const rayMesh = this._spectralRays[i]!;
        const ray = liveRays[i];
        rayMesh.isVisible = undefined !== ray;
        if (ray) this._positionSpectralRay(rayMesh, ray);
      }
    }

    // Floating gem levitation & counter-spin
    if (this._gemMesh) {
      this._gemMesh.rotation.x = this._time * 0.8;
      this._gemMesh.rotation.y = this._time * 1.1;
      this._gemMesh.position.y = 1.5 + Math.sin(this._time * 2.0) * 0.15;
    }

    // Dynamic spectral pulse oscillation
    for (let i = 0; i < this._spectralRays.length; i++) {
      const ray = this._spectralRays[i];
      if (ray) {
        const pulse = 0.95 + Math.sin(this._time * 4.0 + i * 0.5) * 0.08;
        ray.scale.set(pulse, 1.0, pulse);
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase28();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase28] Failed to start:", err));
