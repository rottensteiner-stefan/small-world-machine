import type { AbstractMaterial } from "@small-world-machine/engine";
import { Cylinder, Object3D } from "@small-world-machine/engine";

export interface ErlenmeyerFlaskOptions {
  radius?: number;
  height?: number;
  glassMaterial?: AbstractMaterial;
  segments?: number;
}

export class ErlenmeyerFlask extends Object3D {
  constructor(name: string, options: ErlenmeyerFlaskOptions = {}) {
    super(name);

    const { radius = 1.0, height = 2.0, glassMaterial, segments = 32 } = options;

    // Define proportions
    const bodyHeight = height * 0.6;
    const neckHeight = height * 0.35;
    const lipHeight = height * 0.05;

    const bodyRadiusTop = radius * 0.3;
    const neckRadius = radius * 0.3;
    const lipRadius = radius * 0.35;

    // 1. Conical Body
    const bodyGeo = new Cylinder({
      radiusBottom: radius,
      radiusTop: bodyRadiusTop,
      height: bodyHeight,
      radialSegments: segments,
    }).getGeometryData();

    const body = new Object3D(`${name}_Body`);
    body.geometry = bodyGeo;
    if (glassMaterial) body.material = glassMaterial;
    body.position.set(0, bodyHeight / 2, 0);
    this.add(body);

    // 2. Cylindrical Neck
    const neckGeo = new Cylinder({
      radiusBottom: neckRadius,
      radiusTop: neckRadius,
      height: neckHeight,
      radialSegments: segments,
    }).getGeometryData();

    const neck = new Object3D(`${name}_Neck`);
    neck.geometry = neckGeo;
    if (glassMaterial) neck.material = glassMaterial;
    neck.position.set(0, bodyHeight + neckHeight / 2, 0);
    this.add(neck);

    // 3. Flared Lip
    const lipGeo = new Cylinder({
      radiusBottom: neckRadius,
      radiusTop: lipRadius,
      height: lipHeight,
      radialSegments: segments,
    }).getGeometryData();

    const lip = new Object3D(`${name}_Lip`);
    lip.geometry = lipGeo;
    if (glassMaterial) lip.material = glassMaterial;
    lip.position.set(0, bodyHeight + neckHeight + lipHeight / 2, 0);
    this.add(lip);

    // --- Inner Shells for Glass Thickness ---
    // Thickness: 1cm at bottom (0.01), 0.5cm at sides (0.005)
    const tSide = 0.005;
    const tBottom = 0.01;

    // Inner material needs to render on the inside (front faces cull, or we could invert the geometry, but the engine doesn't have an invert method natively easily, so we assume the material is either double-sided or we'll address culling in the material soon).
    // The user said "Aber fangen wir mal einfach an", so we just add the inner geometry using the same material.

    // Inner Body
    const innerBodyHeight = bodyHeight - tBottom;
    const innerBodyGeo = new Cylinder({
      radiusBottom: radius - tSide,
      radiusTop: bodyRadiusTop - tSide,
      height: innerBodyHeight,
      radialSegments: segments,
    }).getGeometryData();

    const innerBody = new Object3D(`${name}_InnerBody`);
    innerBody.geometry = innerBodyGeo;
    if (glassMaterial) innerBody.material = glassMaterial;
    innerBody.position.set(0, tBottom + innerBodyHeight / 2, 0);
    this.add(innerBody);

    // Inner Neck
    const innerNeckGeo = new Cylinder({
      radiusBottom: neckRadius - tSide,
      radiusTop: neckRadius - tSide,
      height: neckHeight,
      radialSegments: segments,
    }).getGeometryData();

    const innerNeck = new Object3D(`${name}_InnerNeck`);
    innerNeck.geometry = innerNeckGeo;
    if (glassMaterial) innerNeck.material = glassMaterial;
    innerNeck.position.set(0, bodyHeight + neckHeight / 2, 0);
    this.add(innerNeck);
  }
}
