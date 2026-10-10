import { AbstractMaterial, Cylinder, Object3D } from "@small-world-machine/engine";

export interface ApothecaryBottleOptions {
  radius?: number;
  height?: number;
  glassMaterial?: AbstractMaterial;
  stopperMaterial?: AbstractMaterial; // Often the same glass, sometimes ground glass (matt)
  segments?: number;
}

export class ApothecaryBottle extends Object3D {
  constructor(name: string, options: ApothecaryBottleOptions = {}) {
    super(name);

    const {
      radius = 1.0,
      height = 2.0,
      glassMaterial,
      stopperMaterial = glassMaterial,
      segments = 32,
    } = options;

    // Define proportions
    const bodyHeight = height * 0.5;
    const shoulderHeight = height * 0.15;
    const neckHeight = height * 0.2;
    const lipHeight = height * 0.05;

    const stopperBaseHeight = height * 0.05;
    const stopperTopHeight = height * 0.05;

    const shoulderRadiusTop = radius * 0.4;
    const neckRadius = radius * 0.4;
    const lipRadius = radius * 0.45;

    const stopperStemRadius = radius * 0.35;
    const stopperTopRadius = radius * 0.5;

    let currentY = 0;

    // 1. Cylindrical Body
    const bodyGeo = new Cylinder({
      radiusBottom: radius,
      radiusTop: radius,
      height: bodyHeight,
      radialSegments: segments,
    }).getGeometryData();

    const body = new Object3D(`${name}_Body`);
    body.geometry = bodyGeo;
    if (glassMaterial) body.material = glassMaterial;
    body.position.set(0, currentY + bodyHeight / 2, 0);
    this.add(body);
    currentY += bodyHeight;

    // 2. Tapered Shoulder
    const shoulderGeo = new Cylinder({
      radiusBottom: radius,
      radiusTop: shoulderRadiusTop,
      height: shoulderHeight,
      radialSegments: segments,
    }).getGeometryData();

    const shoulder = new Object3D(`${name}_Shoulder`);
    shoulder.geometry = shoulderGeo;
    if (glassMaterial) shoulder.material = glassMaterial;
    shoulder.position.set(0, currentY + shoulderHeight / 2, 0);
    this.add(shoulder);
    currentY += shoulderHeight;

    // 3. Cylindrical Neck
    const neckGeo = new Cylinder({
      radiusBottom: neckRadius,
      radiusTop: neckRadius,
      height: neckHeight,
      radialSegments: segments,
    }).getGeometryData();

    const neck = new Object3D(`${name}_Neck`);
    neck.geometry = neckGeo;
    if (glassMaterial) neck.material = glassMaterial;
    neck.position.set(0, currentY + neckHeight / 2, 0);
    this.add(neck);
    currentY += neckHeight;

    // 4. Flared Lip
    const lipGeo = new Cylinder({
      radiusBottom: neckRadius,
      radiusTop: lipRadius,
      height: lipHeight,
      radialSegments: segments,
    }).getGeometryData();

    const lip = new Object3D(`${name}_Lip`);
    lip.geometry = lipGeo;
    if (glassMaterial) lip.material = glassMaterial;
    lip.position.set(0, currentY + lipHeight / 2, 0);
    this.add(lip);
    currentY += lipHeight;

    // 5. Stopper (Verschluss)
    const stopperGroup = new Object3D(`${name}_StopperGroup`);

    // Stem (goes inside the neck)
    const stopperStemGeo = new Cylinder({
      radiusBottom: stopperStemRadius,
      radiusTop: stopperStemRadius,
      height: stopperBaseHeight,
      radialSegments: segments,
    }).getGeometryData();

    const stopperStem = new Object3D(`${name}_StopperStem`);
    stopperStem.geometry = stopperStemGeo;
    if (stopperMaterial) stopperStem.material = stopperMaterial;
    // The stem hangs down from the top of the bottle
    stopperStem.position.set(0, currentY - stopperBaseHeight / 2, 0);
    stopperGroup.add(stopperStem);

    // Top Disc/Knob
    const stopperTopGeo = new Cylinder({
      radiusBottom: stopperTopRadius,
      radiusTop: stopperTopRadius,
      height: stopperTopHeight,
      radialSegments: segments,
    }).getGeometryData();

    const stopperTop = new Object3D(`${name}_StopperTop`);
    stopperTop.geometry = stopperTopGeo;
    if (stopperMaterial) stopperTop.material = stopperMaterial;
    stopperTop.position.set(0, currentY + stopperTopHeight / 2, 0);
    stopperGroup.add(stopperTop);

    this.add(stopperGroup);

    // --- Inner Shells for Glass Thickness ---
    const tSide = 0.005;
    const tBottom = 0.01;
    let innerY = tBottom;

    // Inner Body
    const innerBodyHeight = bodyHeight - tBottom;
    const innerBodyGeo = new Cylinder({
      radiusBottom: radius - tSide,
      radiusTop: radius - tSide,
      height: innerBodyHeight,
      radialSegments: segments,
    }).getGeometryData();

    const innerBody = new Object3D(`${name}_InnerBody`);
    innerBody.geometry = innerBodyGeo;
    if (glassMaterial) innerBody.material = glassMaterial;
    innerBody.position.set(0, innerY + innerBodyHeight / 2, 0);
    this.add(innerBody);
    innerY += innerBodyHeight;

    // Inner Shoulder
    const innerShoulderGeo = new Cylinder({
      radiusBottom: radius - tSide,
      radiusTop: shoulderRadiusTop - tSide,
      height: shoulderHeight,
      radialSegments: segments,
    }).getGeometryData();

    const innerShoulder = new Object3D(`${name}_InnerShoulder`);
    innerShoulder.geometry = innerShoulderGeo;
    if (glassMaterial) innerShoulder.material = glassMaterial;
    innerShoulder.position.set(0, innerY + shoulderHeight / 2, 0);
    this.add(innerShoulder);
    innerY += shoulderHeight;

    // Inner Neck
    // Make sure the neck inner shell is wide enough for the stopper stem
    const innerNeckGeo = new Cylinder({
      radiusBottom: neckRadius - tSide,
      radiusTop: neckRadius - tSide,
      height: neckHeight,
      radialSegments: segments,
    }).getGeometryData();

    const innerNeck = new Object3D(`${name}_InnerNeck`);
    innerNeck.geometry = innerNeckGeo;
    if (glassMaterial) innerNeck.material = glassMaterial;
    innerNeck.position.set(0, innerY + neckHeight / 2, 0);
    this.add(innerNeck);
  }
}
