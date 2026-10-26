import type { Scene } from "@small-world-machine/engine";
import {
  Color,
  Cube,
  Cylinder,
  GlassMaterial,
  Object3D,
  SpotLight,
  StandardMaterial,
  Torus,
  Vector2D,
} from "@small-world-machine/engine";
import { NOMINAL_INCIDENCE_ANGLE } from "./optics.js";
import type { LabSurfaceTextures } from "./buildEnvironment.js";

/** The bench, rotary stage and the central prism. */
export interface LabBench {
  turntable: Object3D;
  prismMesh: Object3D;
  /** Anodized bench material, reused by the laser emitter pillar. */
  tableMaterial: StandardMaterial;
}

/** Heavy optical isolation bench, rotary stage with brass dial, the glass prism and its key glint spot. */
export function buildBench(scene: Scene, textures: LabSurfaceTextures): LabBench {
  // 1. Heavy Optical Isolation Bench (dark anodized aluminum slab, plan P1-2: grounded, matte)
  const tableMat = new StandardMaterial({
    color: new Color(0.409, 0.422, 0.447),
    diffuseMap: textures.steel.diffuse,
    normalMap: textures.steel.normal,
    roughnessMap: textures.steel.roughness,
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
  scene.add(benchTop);

  // Rotary Optical Stage (Center turntable) -- P1-2: dark anodized like the bench
  const turntable = new Object3D("TurntableStage");
  turntable.position.set(0, 0, 0);
  scene.add(turntable);

  const stageMat = new StandardMaterial({
    color: new Color(0.422, 0.435, 0.459),
    diffuseMap: textures.steel.diffuse,
    normalMap: textures.steel.normal,
    roughnessMap: textures.steel.roughness,
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
  turntable.add(stagePlate);

  // Brass Scale Ring around turntable -- P1-2: re-seated ON the plate's top face (radius 2.18 is
  // inside the stagePlate top radius of 2.2, so the torus no longer clips the plate's sloped
  // edge), slightly proud of the surface with a near-zero contact gap for HBAO contact shading.
  const brassRingMat = new StandardMaterial({
    color: new Color(0.85, 0.762, 0.533),
    diffuseMap: textures.brass.diffuse,
    normalMap: textures.brass.normal,
    roughnessMap: textures.brass.roughness,
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
  turntable.add(dialRing);

  // The Central Optical Prism (Equilateral triangular cylinder, n = 1.65 flint glass).
  // P1-1: verified crystalline GlassMaterial path (3-backend, no StandardMaterial.transmission
  // WebGPU-only trap), no self-glow emissive -- the only light on the glass is the tight key
  // SpotLight below, which raises sharp facet glints instead of a milky self-luminous bulb.
  const glassMat = new GlassMaterial({
    color: new Color(0.982, 0.991, 1),
    ior: 1.65,
    thickness: 0.55,
    transmission: 1.0,
    roughness: 0.02,
  });
  const prismMesh = new Object3D("CentralPrism");
  prismMesh.geometry = new Cylinder({
    radiusTop: 1.2,
    radiusBottom: 1.2,
    height: 2.2,
    radialSegments: 3,
  }).getGeometryData();
  prismMesh.material = glassMat;
  prismMesh.position.set(0, 1.25, 0);
  // Rotated so the incident beam (arriving along +X at world angle 270 degrees, see
  // computeSpectralRays()' doc comment) hits the face between local vertices 1 and 2 at
  // NOMINAL_INCIDENCE_ANGLE, not dead-on on an edge (the previous Math.PI/6 landed exactly on a
  // vertex, verified by hand: 240deg local + 30deg rotation = 270deg exactly).
  prismMesh.rotation.y = (3 * Math.PI) / 2 - NOMINAL_INCIDENCE_ANGLE - Math.PI;
  prismMesh.castShadow = true;
  turntable.add(prismMesh);

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
  scene.add(keyGlintSpot);

  return { turntable, prismMesh, tableMaterial: tableMat };
}

/** Laser emitter pillar, housing and glowing lens aperture. */
export function buildLaserEmitter(scene: Scene, tableMat: StandardMaterial): void {
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
  scene.add(emitterPillar);

  const laserHousingMat = new StandardMaterial({
    color: new Color(0.351, 0.351, 0.381),
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
  scene.add(laserHousing);

  // Glowing Laser Lens Aperture -- kept modest so it doesn't flood the frame with HDR bloom
  const laserLensMat = new StandardMaterial({
    color: new Color(1, 1, 1),
    emissiveColor: new Color(1.086, 1.086, 1.086),
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
  scene.add(laserEmitterMesh);
}
