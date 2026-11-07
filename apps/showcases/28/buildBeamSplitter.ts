import type { Scene } from "@small-world-machine/engine";
import {
  Color,
  Cube,
  Cylinder,
  Object3D,
  SpotLight,
  StandardMaterial,
} from "@small-world-machine/engine";
import { createRefSensorTexture } from "./textures.js";

/** Meshes of the sliding beam splitter that the showcase moves every frame. */
export interface LabBeamSplitter {
  carriage: Object3D;
  refSensorSpot: Object3D;
}

/** 50:50 beam splitter on its optical rail plus the auxiliary reference photodetector. */
export function buildBeamSplitter(scene: Scene, splitterX: number): LabBeamSplitter {
  // --- 50:50 Beam Splitter System & Auxiliary Reference Detector ---
  // 1. Dovetail Optical Rail on the bench along X
  const railMat = new StandardMaterial({
    color: new Color(0.381, 0.409, 0.435),
    metallic: 0.85,
    roughness: 0.35,
  });
  const rail = new Object3D("OpticalRail");
  rail.geometry = new Cube({ size: 1 }).getGeometryData();
  rail.scale.set(2.4, 0.04, 0.22);
  rail.position.set(-2.25, 0.02, 0);
  rail.receiveShadow = true;
  scene.add(rail);

  // 2. Sliding Beam Splitter Carriage
  const splitterCarriage = new Object3D("SplitterCarriage");
  splitterCarriage.position.set(splitterX, 0, 0);

  const carriageBase = new Object3D("CarriageBase");
  carriageBase.geometry = new Cube({ size: 1 }).getGeometryData();
  carriageBase.scale.set(0.32, 0.08, 0.28);
  carriageBase.material = railMat;
  carriageBase.position.set(0, 0.06, 0);
  splitterCarriage.add(carriageBase);

  // Vertical mounting post
  const postMat = new StandardMaterial({
    color: new Color(0.459, 0.481, 0.502),
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
  splitterCarriage.add(post);

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
  splitterCarriage.add(mirrorBracket);

  // Half-silvered semi-reflective mirror plate (50:50)
  const mirrorMat = new StandardMaterial({
    color: new Color(0.953, 0.977, 1, 0.55),
    metallic: 0.8,
    roughness: 0.05,
    transparent: true,
    emissiveColor: new Color(0.579, 0.621, 0.659),
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
  splitterCarriage.add(mirrorPlate);

  scene.add(splitterCarriage);

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
  scene.add(refDetectorStand);

  const refDetectorHousing = new Object3D("RefDetectorHousing");
  refDetectorHousing.geometry = new Cube({ size: 1 }).getGeometryData();
  refDetectorHousing.scale.set(2.6, 0.7, 0.28);
  refDetectorHousing.material = new StandardMaterial({
    color: new Color(0.278, 0.299, 0.326),
    metallic: 0.4,
    roughness: 0.85,
  });
  refDetectorHousing.position.set(-2.25, 1.8, -2.35);
  refDetectorHousing.receiveShadow = true;
  scene.add(refDetectorHousing);

  // Calibrated sensor display face facing +Z (towards the incoming reflected beam)
  const refSensorFace = new Object3D("RefSensorFace");
  refSensorFace.geometry = new Cube({ size: 1 }).getGeometryData();
  refSensorFace.scale.set(2.45, 0.58, 0.02);
  refSensorFace.material = new StandardMaterial({
    color: new Color(0.232, 0.278, 0.317),
    emissiveColor: new Color(0.85, 0.929, 0.977),
    emissiveIntensity: 0.7,
    emissiveMap: createRefSensorTexture(),
  });
  refSensorFace.position.set(-2.25, 1.8, -2.2);
  scene.add(refSensorFace);

  // Luminous impact spot on reference detector sensor strip
  const refSpotMat = new StandardMaterial({
    color: new Color(1.0, 1.0, 1.0),
    emissiveColor: new Color(1.202, 1.202, 1.202),
    emissiveIntensity: 1.8,
  });
  const refSensorSpot = new Object3D("RefSensorSpot");
  refSensorSpot.geometry = new Cylinder({
    radiusTop: 0.035,
    radiusBottom: 0.035,
    height: 0.03,
    radialSegments: 16,
  }).getGeometryData();
  refSensorSpot.material = refSpotMat;
  refSensorSpot.rotation.x = Math.PI / 2;
  refSensorSpot.position.set(splitterX, 1.8, -2.18);
  scene.add(refSensorSpot);

  return { carriage: splitterCarriage, refSensorSpot };
}

/** The laser beam meshes before/after the splitter, the reflected beam and the laser SpotLight. */
export interface LabBeams {
  incidentBeamBefore: Object3D;
  incidentBeamAfter: Object3D;
  reflectedBeam: Object3D;
  laserLight: SpotLight;
}

/** Pre-splitter, post-splitter and reflected laser beams plus the collinear laser SpotLight. */
export function buildBeams(scene: Scene, splitterX: number): LabBeams {
  // 4. Split Laser Beams (Pre-Splitter, Post-Splitter, Reflected)
  const incidentBeamMat = new StandardMaterial({
    color: new Color(1.0, 1.0, 1.0),
    emissiveColor: new Color(1.202, 1.202, 1.202),
    emissiveIntensity: 1.1,
    transparent: true,
  });
  const incidentBeamBefore = new Object3D("IncidentBeam_Before");
  incidentBeamBefore.geometry = new Cylinder({
    radiusTop: 0.03,
    radiusBottom: 0.03,
    height: 1.0,
    radialSegments: 16,
  }).getGeometryData();
  incidentBeamBefore.material = incidentBeamMat;
  incidentBeamBefore.rotation.z = Math.PI / 2;
  scene.add(incidentBeamBefore);

  const transmittedBeamMat = new StandardMaterial({
    color: new Color(1.0, 1.0, 1.0),
    emissiveColor: new Color(1.165, 1.165, 1.165),
    emissiveIntensity: 0.65,
    transparent: true,
  });
  const incidentBeamAfter = new Object3D("IncidentBeam_After");
  incidentBeamAfter.geometry = new Cylinder({
    radiusTop: 0.026,
    radiusBottom: 0.026,
    height: 1.0,
    radialSegments: 16,
  }).getGeometryData();
  incidentBeamAfter.material = transmittedBeamMat;
  incidentBeamAfter.rotation.z = Math.PI / 2;
  scene.add(incidentBeamAfter);

  const reflectedBeamMat = new StandardMaterial({
    color: new Color(1.0, 1.0, 1.0),
    emissiveColor: new Color(1.165, 1.165, 1.165),
    emissiveIntensity: 0.65,
    transparent: true,
  });
  const reflectedBeam = new Object3D("ReflectedBeam_90Deg");
  reflectedBeam.geometry = new Cylinder({
    radiusTop: 0.026,
    radiusBottom: 0.026,
    height: 2.2,
    radialSegments: 16,
  }).getGeometryData();
  reflectedBeam.material = reflectedBeamMat;
  reflectedBeam.rotation.x = Math.PI / 2;
  reflectedBeam.position.set(splitterX, 1.8, -1.1);
  scene.add(reflectedBeam);

  // SpotLight collinear with the incident laser
  const laserLight = new SpotLight({
    color: new Color(1.0, 1.0, 1.0),
    intensity: 8.0,
    distance: 15,
    angle: Math.PI / 16,
    penumbra: 0.2,
  });
  laserLight.position.set(-4.0, 1.8, 0);
  laserLight.direction.set(1, 0, 0);
  laserLight.castShadow = true;
  laserLight.shadowBias = 0.0008;
  laserLight.shadowResolution = 1024;
  scene.add(laserLight);

  return { incidentBeamBefore, incidentBeamAfter, reflectedBeam, laserLight };
}
