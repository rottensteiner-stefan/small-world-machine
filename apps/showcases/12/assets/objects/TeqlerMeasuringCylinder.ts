import { AbstractMaterial, Cylinder, Object3D } from "@small-world-machine/engine";

export interface TeqlerMeasuringCylinderOptions {
  /** Radius of the glass tube in meters. Default: 0.08 */
  radius?: number;
  /** Height of the graduated glass tube in meters (excludes foot and pouring lip). Default: 0.7 */
  height?: number;
  /** Material for the glass tube. */
  glassMaterial?: AbstractMaterial;
  /** Material for the hexagonal foot -- real Teqler cylinders use colored polypropylene here,
   * not glass. Defaults to `glassMaterial` if not given. */
  footMaterial?: AbstractMaterial;
  /** Material for the short graduation tick marks. Defaults to `glassMaterial` if not given. */
  scaleMarkMaterial?: AbstractMaterial;
  /** Number of graduation tick marks along the tube. Default: 9 */
  scaleMarkCount?: number;
  segments?: number;
}

/**
 * A lab graduated cylinder in the style of Teqler's glassware: a tall, narrow glass tube on a
 * hexagonal foot for stability. The graduation scale is only *suggested* -- a column of short,
 * irregular tick-mark arcs along one side of the tube, alternating longer "major" and shorter
 * "minor" lengths -- deliberately with no legible numerals, since there's no text-rendering
 * path for this kind of small printed-on lab glassware detail.
 */
export class TeqlerMeasuringCylinder extends Object3D {
  constructor(name: string, options: TeqlerMeasuringCylinderOptions = {}) {
    super(name);

    const {
      radius = 0.08,
      height = 0.7,
      glassMaterial,
      footMaterial = glassMaterial,
      scaleMarkMaterial = glassMaterial,
      scaleMarkCount = 9,
      segments = 32,
    } = options;

    let currentY = 0;

    // 1. Hexagonal foot -- wider than the tube for stability.
    const footRadius = radius * 1.7;
    const footHeight = Math.max(0.04, height * 0.07);
    const footGeo = new Cylinder({
      radiusTop: footRadius,
      radiusBottom: footRadius,
      height: footHeight,
      radialSegments: 6,
    }).getGeometryData();

    const foot = new Object3D(`${name}_Foot`);
    foot.geometry = footGeo;
    if (footMaterial) foot.material = footMaterial;
    foot.position.set(0, footHeight / 2, 0);
    foot.castShadow = true;
    foot.receiveShadow = true;
    this.add(foot);
    currentY += footHeight;

    // 2. Glass tube (the graduated body) -- straight-sided, unlike the flask/bottle shapes.
    const bodyGeo = new Cylinder({
      radiusTop: radius,
      radiusBottom: radius,
      height,
      radialSegments: segments,
    }).getGeometryData();

    const body = new Object3D(`${name}_Body`);
    body.geometry = bodyGeo;
    if (glassMaterial) body.material = glassMaterial;
    body.position.set(0, currentY + height / 2, 0);
    body.castShadow = true;
    this.add(body);
    currentY += height;

    // 3. Flared pouring lip
    const lipHeight = height * 0.04;
    const lipRadius = radius * 1.15;
    const lipGeo = new Cylinder({
      radiusBottom: radius,
      radiusTop: lipRadius,
      height: lipHeight,
      radialSegments: segments,
    }).getGeometryData();

    const lip = new Object3D(`${name}_Lip`);
    lip.geometry = lipGeo;
    if (glassMaterial) lip.material = glassMaterial;
    lip.position.set(0, currentY + lipHeight / 2, 0);
    this.add(lip);

    // --- Inner hollow shell for glass thickness ---
    const tSide = 0.004;
    const tBottom = 0.01;
    const innerBodyHeight = height - tBottom;
    const innerBodyGeo = new Cylinder({
      radiusTop: radius - tSide,
      radiusBottom: radius - tSide,
      height: innerBodyHeight,
      radialSegments: segments,
    }).getGeometryData();

    const innerBody = new Object3D(`${name}_InnerBody`);
    innerBody.geometry = innerBodyGeo;
    if (glassMaterial) innerBody.material = glassMaterial;
    innerBody.position.set(0, footHeight + tBottom + innerBodyHeight / 2, 0);
    this.add(innerBody);

    // 4. Graduation scale -- short, irregular arc segments (never a full ring) climbing one
    // side of the tube. Alternating "major"/"minor" tick lengths reads as a real printed scale
    // at a glance without ever needing to render an actual numeral.
    const scaleGroup = new Object3D(`${name}_Scale`);
    const scaleStartY = height * 0.12;
    const scaleEndY = height * 0.92;
    const scaleMarkHeight = Math.max(0.0015, height * 0.006);
    const scaleRadius = radius + 0.001; // sits just outside the glass surface, avoids z-fighting

    for (let i = 0; i < scaleMarkCount; i++) {
      const t = scaleMarkCount > 1 ? i / (scaleMarkCount - 1) : 0;
      const y = scaleStartY + t * (scaleEndY - scaleStartY);
      const isMajor = i % 3 === 0;
      const arcLength = (isMajor ? 0.7 : 0.35) + (i % 2 === 0 ? 0.08 : -0.05);

      const markGeo = new Cylinder({
        radiusTop: scaleRadius,
        radiusBottom: scaleRadius,
        height: scaleMarkHeight,
        radialSegments: segments,
        thetaStart: -arcLength / 2,
        thetaLength: arcLength,
      }).getGeometryData();

      const mark = new Object3D(`${name}_ScaleMark_${i}`);
      mark.geometry = markGeo;
      if (scaleMarkMaterial) mark.material = scaleMarkMaterial;
      mark.position.set(0, footHeight + y, 0);
      scaleGroup.add(mark);
    }

    this.add(scaleGroup);
  }
}
