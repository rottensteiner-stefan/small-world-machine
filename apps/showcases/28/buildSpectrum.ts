import {
  Color,
  Cube,
  CullMode,
  Cylinder,
  GeometryDataInterface,
  Object3D,
  SpotLight,
  StandardMaterial,
  Scene,
} from "@small-world-machine/engine";
import { CausticFanGeometry } from "./CausticFanGeometry.js";
import { createBandGradientTexture, createCausticGradientTexture } from "./textures.js";
import { SPECTRAL_RAY_LENGTH, SPECTRUM } from "./optics.js";

/** The per-frame driven meshes and lights of the spectrum (rays, internal path, band, caustic, bounce). */
export interface LabSpectrum {
  spectralRays: Object3D[];
  internalPath: Object3D;
  bandMesh: Object3D;
  causticGeometryData: GeometryDataInterface;
  floorCausticMesh: Object3D;
  chromaticBounceLight: SpotLight;
}

/**
 * One hidden mesh per spectrum band, the internal beam segment, the continuous detector band, the
 * bench caustic fan and the chromatic bounce light. `update()` positions and shows them per frame.
 */
export function buildSpectrum(
  scene: Scene,
  causticIntensity: number,
  chromaticBounceIntensity: number,
): LabSpectrum {
  const spectralRays: Object3D[] = [];
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
    scene.add(rayMesh);
    spectralRays.push(rayMesh);
  }

  // P0-5: ONE faint white internal segment (average entry -> average exit path), visible only
  // while the full band is valid. A separate segment per band would stack ~7x over the
  // near-identical internal path and blow out the glass interior.
  const internalPath = new Object3D("InternalBeamPath");
  internalPath.geometry = new Cylinder({
    radiusTop: 0.011,
    radiusBottom: 0.011,
    height: 1,
    radialSegments: 8,
  }).getGeometryData();
  internalPath.material = new StandardMaterial({
    color: new Color(1.0, 1.0, 1.0, 0.15),
    emissiveColor: new Color(0.85, 0.9, 0.95),
    emissiveIntensity: 0.95,
    transparent: true,
  });
  internalPath.rotation.z = Math.PI / 2;
  internalPath.isVisible = false;
  scene.add(internalPath);

  // P0-3: the spectrum terminates as ONE continuous red->violet gradient band on the detector,
  // generated as an emissive canvas texture (see _createBandGradientTexture) so it renders as a
  // single smooth smear -- no discrete hue blocks, and the 8-bit ceil forbids any white core.
  const bandMesh = new Object3D("Band_Gradient");
  bandMesh.geometry = new Cube({ size: 1 }).getGeometryData();
  bandMesh.material = new StandardMaterial({
    color: new Color(1.0, 1.0, 1.0),
    emissiveColor: new Color(1.0, 1.0, 1.0),
    emissiveIntensity: 1.35,
    emissiveMap: createBandGradientTexture(),
    transparent: true,
  });
  bandMesh.isVisible = false;
  scene.add(bandMesh);

  // P2-1: Live-derived continuous chromatic caustic dispersion fan on the anodized bench surface
  const causticGeo = new CausticFanGeometry();
  const causticGeometryData = causticGeo.getGeometryData();

  const causticMat = new StandardMaterial({
    color: new Color(0.0, 0.0, 0.0),
    emissiveColor: new Color(1.0, 1.0, 1.0),
    emissiveIntensity: causticIntensity,
    emissiveMap: createCausticGradientTexture(),
    transparent: true,
    roughness: 0.9,
  });
  causticMat.cullMode = CullMode.NONE;
  causticMat.depthWrite = false;

  const floorCausticMesh = new Object3D("BenchCausticSpill");
  floorCausticMesh.geometry = causticGeometryData;
  floorCausticMesh.material = causticMat;
  floorCausticMesh.frustumCulled = false;
  floorCausticMesh.position.set(0, 0, 0);
  floorCausticMesh.isVisible = false;
  scene.add(floorCausticMesh);

  // P2-2: Chromatic bounce SpotLight near the exit fan (cap <= 3 spots total in scene)
  const chromaticBounceLight = new SpotLight({
    name: "ChromaticBounceSpot",
    color: new Color(0.2, 0.8, 0.85),
    intensity: chromaticBounceIntensity,
    distance: 6.5,
    angle: Math.PI / 4,
    penumbra: 0.85,
    decay: 1.5,
    castShadow: false,
  });
  scene.add(chromaticBounceLight);

  return {
    spectralRays,
    internalPath,
    bandMesh,
    causticGeometryData,
    floorCausticMesh,
    chromaticBounceLight,
  };
}
