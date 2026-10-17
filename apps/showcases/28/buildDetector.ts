import type { Scene } from "@small-world-machine/engine";
import {
  Color,
  Cube,
  Object3D,
  StandardMaterial,
  Texture,
  TextureFilter,
  TextureWrap,
} from "@small-world-machine/engine";
import type { SpectralRay } from "./optics.js";
import { computeSpectralRays } from "./optics.js";

/** Result of placing the detector: the resting spectral rays and the detector's receiving face plane. */
export interface LabDetector {
  initialRays: (SpectralRay | undefined)[];
  /** Receiving face plane (world XZ): centre ... */
  screenFaceX: number;
  screenFaceZ: number;
  /** ... and the unit travel direction of the fan (face normal). */
  screenDirX: number;
  screenDirZ: number;
}

/**
 * Computes the resting exit fan of the prism and bolts the matte absorber panel (graticule, bezel)
 * into its average path.
 */
export function buildDetector(scene: Scene, prismRotationY: number): LabDetector {
  // Spectral Ray Bundle: real Snell's-law refraction through the prism (see
  // computeSpectralRays() above), not a hand-placed decorative fan. Computed once, up front
  // (at the turntable's resting rotation), so the Phosphor Screen below can be placed in the
  // fan's *actual* path; `update()` recomputes this every frame as the turntable wobbles and
  // repositions/hides these same meshes -- see the comment there for why some colors vanish for
  // part of the wobble (total internal reflection, not a bug).
  const initialRays = computeSpectralRays(prismRotationY);
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
  scene.add(screenPanel);

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
  const screenFaceX = avgExitX + avgDirX * SCREEN_DISTANCE - avgDirX * 0.165;
  const screenFaceZ = avgExitZ + avgDirZ * SCREEN_DISTANCE - avgDirZ * 0.165;
  const screenDirX = avgDirX;
  const screenDirZ = avgDirZ;

  return { initialRays, screenFaceX, screenFaceZ, screenDirX, screenDirZ };
}
