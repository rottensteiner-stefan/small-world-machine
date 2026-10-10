import {
  AbstractMaterial,
  Cube,
  Cylinder,
  GeometryDataInterface,
  Object3D,
} from "@small-world-machine/engine";

const applyBoxUVs = (
  geo: GeometryDataInterface,
  width: number,
  height: number,
  depth: number,
  offsetX: number = 0,
  offsetY: number = 0,
  rotateTop: boolean = false,
): GeometryDataInterface => {
  const newGeo = { ...geo }; // Shallow copy
  if (!geo.uvs || geo.uvs.length < 48) return newGeo; // Needs at least 24 vertices

  newGeo.uvs = new Float32Array(geo.uvs);

  // Right (+X) face [indices 0-7] - dimensions: depth x height
  for (let i = 0; i < 8; i += 2) {
    newGeo.uvs[i] = geo.uvs[i]! * depth + offsetX;
    newGeo.uvs[i + 1] = geo.uvs[i + 1]! * height + offsetY;
  }
  // Left (-X) face [indices 8-15] - dimensions: depth x height
  for (let i = 8; i < 16; i += 2) {
    newGeo.uvs[i] = geo.uvs[i]! * depth + offsetX;
    newGeo.uvs[i + 1] = geo.uvs[i + 1]! * height + offsetY;
  }
  // Top (+Y) face [indices 16-23] - dimensions: width x depth
  for (let i = 16; i < 24; i += 2) {
    const u = geo.uvs[i]!;
    const v = geo.uvs[i + 1]!;
    if (rotateTop) {
      newGeo.uvs[i] = v * depth + offsetX;
      newGeo.uvs[i + 1] = u * width + offsetY;
    } else {
      newGeo.uvs[i] = u * width + offsetX;
      newGeo.uvs[i + 1] = v * depth + offsetY;
    }
  }
  // Bottom (-Y) face [indices 24-31] - dimensions: width x depth
  for (let i = 24; i < 32; i += 2) {
    const u = geo.uvs[i]!;
    const v = geo.uvs[i + 1]!;
    if (rotateTop) {
      newGeo.uvs[i] = v * depth + offsetX;
      newGeo.uvs[i + 1] = u * width + offsetY;
    } else {
      newGeo.uvs[i] = u * width + offsetX;
      newGeo.uvs[i + 1] = v * depth + offsetY;
    }
  }
  // Front (+Z) face [indices 32-39] - dimensions: width x height
  for (let i = 32; i < 40; i += 2) {
    newGeo.uvs[i] = geo.uvs[i]! * width + offsetX;
    newGeo.uvs[i + 1] = geo.uvs[i + 1]! * height + offsetY;
  }
  // Back (-Z) face [indices 40-47] - dimensions: width x height
  for (let i = 40; i < 48; i += 2) {
    newGeo.uvs[i] = geo.uvs[i]! * width + offsetX;
    newGeo.uvs[i + 1] = geo.uvs[i + 1]! * height + offsetY;
  }

  return newGeo;
};

export interface WorkbenchTableOptions {
  /** Width in meters (X-axis). Default: 1.2 */
  width?: number;
  /** Depth in meters (Z-axis). Default: 0.7 */
  depth?: number;
  /** Height in meters (Y-axis). Default: 0.45 */
  height?: number;
  /** Thickness of the tabletop in meters. Default: 0.08 */
  topThickness?: number;
  /** Material for the wooden parts */
  woodMaterial?: AbstractMaterial;
  /** Material for the metal bolts and frames */
  metalMaterial?: AbstractMaterial;
}

export class WorkbenchTable extends Object3D {
  constructor(name: string, options: WorkbenchTableOptions = {}) {
    super(name);

    // 1 Unit = 1 Meter approach
    const w = options.width ?? 1.2;
    const d = options.depth ?? 0.7;
    const h = options.height ?? 0.45;
    const t = options.topThickness ?? 0.08;

    const woodMat = options.woodMaterial;
    const metalMat = options.metalMaterial;

    const unitCubeGeo = new Cube({ size: 1 }).getGeometryData();

    // --- 1. TABLE TOP ---
    const topGroup = new Object3D(`${name}_Top`);
    topGroup.position.set(0, h - t / 2, 0); // Origin is in the center of the tabletop volume

    // 4 Planks spanning the full width
    const numPlanks = 4;
    const plankDepth = d / numPlanks;
    // We add a tiny gap between planks to sell the illusion
    const gap = 0.005;
    const actualPlankDepth = plankDepth - gap;

    for (let i = 0; i < numPlanks; i++) {
      const plank = new Object3D(`${name}_Plank_${i}`);
      // Grain runs along X (width). Top face UV scaled by w and actualPlankDepth.
      plank.geometry = applyBoxUVs(
        unitCubeGeo,
        w,
        t,
        actualPlankDepth,
        Math.random(),
        Math.random(),
        false,
      );
      plank.scale.set(w, t, actualPlankDepth);
      if (woodMat) plank.material = woodMat;
      plank.castShadow = true;
      plank.receiveShadow = true;
      const zPos = -d / 2 + plankDepth * i + plankDepth / 2;
      plank.position.set(0, 0, zPos);
      topGroup.add(plank);
    }

    // Top Bolts (going through planks into legs)
    const boltWasherGeo = new Cylinder({
      radiusTop: 0.06,
      radiusBottom: 0.06,
      height: 0.005,
      radialSegments: 16,
    }).getGeometryData();

    const boltNutGeo = new Cylinder({
      radiusTop: 0.04,
      radiusBottom: 0.04,
      height: 0.02,
      radialSegments: 6,
    }).getGeometryData();

    const addTopBolt = (x: number, z: number): void => {
      const boltGroup = new Object3D(`${name}_Bolt_${x}_${z}`);
      boltGroup.position.set(x, t / 2, z);

      const washer = new Object3D(`${name}_Washer`);
      washer.geometry = boltWasherGeo;
      if (metalMat) washer.material = metalMat;
      washer.position.set(0, 0.002, 0); // Sink 0.5mm into wood to prevent Z-fighting
      washer.castShadow = true;
      boltGroup.add(washer);

      const nut = new Object3D(`${name}_Nut`);
      nut.geometry = boltNutGeo;
      if (metalMat) nut.material = metalMat;
      nut.position.set(0, 0.014, 0); // Sink 0.5mm into washer to prevent Z-fighting
      nut.castShadow = true;
      // Slight random rotation for realism
      nut.rotation.y = (Math.random() * Math.PI) / 4;
      boltGroup.add(nut);

      topGroup.add(boltGroup);
    };

    // Place bolts exactly over the legs
    const boltX = w / 2 - 0.15;
    const boltZ = (d - 0.05) / 2 - 0.1 / 2 - 0.05;
    addTopBolt(boltX, boltZ);
    addTopBolt(boltX, -boltZ);
    addTopBolt(-boltX, boltZ);
    addTopBolt(-boltX, -boltZ);

    this.add(topGroup);

    // --- 2. THE BASE ---
    const baseGroup = new Object3D(`${name}_Base`);

    // Runners (Bodenkufen)
    const runnerHeight = 0.08;
    const runnerWidth = 0.12;
    const radius = runnerHeight / 2;
    const runnerStraightDepth = d - 0.05;

    const runnerEndCylGeo = new Cylinder({
      radiusTop: radius,
      radiusBottom: radius,
      height: runnerWidth,
      radialSegments: 16,
      thetaStart: 0,
      thetaLength: Math.PI / 2, // Quarter circle
    }).getGeometryData();

    const sideBoltWasherGeo = new Cylinder({
      radiusTop: 0.02,
      radiusBottom: 0.02,
      height: 0.004,
      radialSegments: 16,
    }).getGeometryData();

    const sideBoltNutGeo = new Cylinder({
      radiusTop: 0.015,
      radiusBottom: 0.015,
      height: 0.015,
      radialSegments: 6,
    }).getGeometryData();

    const legWidth = 0.1;
    const legDepth = 0.1;
    // Leg height goes from top of runner to bottom of tabletop
    const legHeight = h - runnerHeight - t;

    // Legs inset slightly from ends
    const legInsetX = w / 2 - 0.15; // Place legs near the ends of the planks
    const legZ = runnerStraightDepth / 2 - legDepth / 2 - 0.05;

    const createSideBase = (x: number, isLeft: boolean): Object3D => {
      const sideGroup = new Object3D(`${name}_SideBase_${isLeft ? "L" : "R"}`);
      sideGroup.position.set(x, 0, 0);

      // Main runner body (straight part)
      const runnerBody = new Object3D(`${name}_RunnerBody`);
      runnerBody.geometry = applyBoxUVs(
        unitCubeGeo,
        runnerWidth,
        runnerHeight,
        runnerStraightDepth,
        Math.random(),
        Math.random(),
        true,
      );
      runnerBody.scale.set(runnerWidth, runnerHeight, runnerStraightDepth);
      if (woodMat) runnerBody.material = woodMat;
      runnerBody.position.set(0, runnerHeight / 2, 0);
      runnerBody.castShadow = true;
      runnerBody.receiveShadow = true;
      sideGroup.add(runnerBody);

      // Front rounded end (top half curve, bottom half flat)
      const runnerFrontCyl = new Object3D(`${name}_RunnerFrontCyl`);
      // Use different offset for the cylinder part, but same scale
      // Cylinder UVs aren't easily fixed by Box UVs, so we use original mapping without scaling for now
      runnerFrontCyl.geometry = runnerEndCylGeo;
      if (woodMat) runnerFrontCyl.material = woodMat;
      runnerFrontCyl.rotation.z = Math.PI / 2;
      runnerFrontCyl.position.set(0, runnerHeight / 2, runnerStraightDepth / 2);
      runnerFrontCyl.castShadow = true;
      runnerFrontCyl.receiveShadow = true;
      sideGroup.add(runnerFrontCyl);

      const runnerFrontBox = new Object3D(`${name}_RunnerFrontBox`);
      runnerFrontBox.geometry = applyBoxUVs(
        unitCubeGeo,
        runnerWidth,
        radius,
        radius,
        Math.random(),
        Math.random(),
        true,
      );
      runnerFrontBox.scale.set(runnerWidth, radius, radius);
      if (woodMat) runnerFrontBox.material = woodMat;
      runnerFrontBox.position.set(0, radius / 2, runnerStraightDepth / 2 + radius / 2);
      runnerFrontBox.castShadow = true;
      runnerFrontBox.receiveShadow = true;
      sideGroup.add(runnerFrontBox);

      // Back rounded end (top half curve, bottom half flat)
      const runnerBackCyl = new Object3D(`${name}_RunnerBackCyl`);
      runnerBackCyl.geometry = runnerEndCylGeo;
      if (woodMat) runnerBackCyl.material = woodMat;
      runnerBackCyl.rotation.z = Math.PI / 2;
      runnerBackCyl.position.set(0, runnerHeight / 2, -runnerStraightDepth / 2);
      runnerBackCyl.castShadow = true;
      runnerBackCyl.receiveShadow = true;
      sideGroup.add(runnerBackCyl);

      const runnerBackBox = new Object3D(`${name}_RunnerBackBox`);
      runnerBackBox.geometry = applyBoxUVs(
        unitCubeGeo,
        runnerWidth,
        radius,
        radius,
        Math.random(),
        Math.random(),
        true,
      );
      runnerBackBox.scale.set(runnerWidth, radius, radius);
      if (woodMat) runnerBackBox.material = woodMat;
      runnerBackBox.position.set(0, radius / 2, -(runnerStraightDepth / 2 + radius / 2));
      runnerBackBox.castShadow = true;
      runnerBackBox.receiveShadow = true;
      sideGroup.add(runnerBackBox);

      const legF = new Object3D(`${name}_Leg_Front`);
      // For vertical legs, grain runs along Y. By rotating top by 90deg, U maps to Y?
      // Actually, applyBoxUVs might not support Y-axis grain if texture is X-axis.
      // Since our texture is X-axis, and Front face uses U=Width, V=Height.
      // We can rotate the Leg Object3D itself instead of UVs?
      // Let's just create it with swapped Width/Height, and then rotate the Leg Object by 90 deg around Z!
      legF.geometry = applyBoxUVs(
        unitCubeGeo,
        legHeight,
        legWidth,
        legDepth,
        Math.random(),
        Math.random(),
        false,
      );
      legF.scale.set(legHeight, legWidth, legDepth);
      legF.rotation.z = Math.PI / 2;
      if (woodMat) legF.material = woodMat;
      legF.position.set(0, runnerHeight + legHeight / 2, legZ);
      legF.castShadow = true;
      legF.receiveShadow = true;
      sideGroup.add(legF);

      const legB = new Object3D(`${name}_Leg_Back`);
      legB.geometry = applyBoxUVs(
        unitCubeGeo,
        legHeight,
        legWidth,
        legDepth,
        Math.random(),
        Math.random(),
        false,
      );
      legB.scale.set(legHeight, legWidth, legDepth);
      legB.rotation.z = Math.PI / 2;
      if (woodMat) legB.material = woodMat;
      legB.position.set(0, runnerHeight + legHeight / 2, -legZ);
      legB.castShadow = true;
      legB.receiveShadow = true;
      sideGroup.add(legB);

      // Add bolts going through the runner into the legs
      const addRunnerBolts = (baseZ: number): void => {
        const outDir = isLeft ? -1 : 1;
        // Rotation to face outside: if left side (-X), point to -X (z rot = PI/2)
        const rotZ = isLeft ? Math.PI / 2 : -Math.PI / 2;
        const boltXOffset = runnerWidth / 2;
        const boltZOffset = 0.025;

        const placeBolt = (bZ: number): void => {
          const bGroup = new Object3D(`${name}_RBolt`);
          bGroup.position.set(boltXOffset * outDir, runnerHeight / 2, bZ);
          bGroup.rotation.set(0, 0, rotZ);

          const w = new Object3D(`${name}_RW`);
          w.geometry = sideBoltWasherGeo;
          if (metalMat) w.material = metalMat;
          w.position.set(0, 0.002, 0);
          w.castShadow = true;
          bGroup.add(w);

          const n = new Object3D(`${name}_RN`);
          n.geometry = sideBoltNutGeo;
          if (metalMat) n.material = metalMat;
          n.position.set(0, 0.0115, 0);
          n.rotation.y = (Math.random() * Math.PI) / 4;
          n.castShadow = true;
          bGroup.add(n);

          sideGroup.add(bGroup);
        };

        placeBolt(baseZ + boltZOffset);
        placeBolt(baseZ - boltZOffset);
      };

      addRunnerBolts(legZ);
      addRunnerBolts(-legZ);

      return sideGroup;
    };

    baseGroup.add(createSideBase(-legInsetX, true));
    baseGroup.add(createSideBase(legInsetX, false));

    // --- 3. SHELF (Ablage) ---
    // Metal rails running across
    const shelfHeight = runnerHeight + legHeight * 0.3; // 30% up the legs
    const shelfDepth = legZ * 2; // Rails span between the legs
    // Rails between the leg frames
    const railHeight = 0.08;
    const railWidth = 0.04;
    const railLength = legInsetX * 2 - legWidth;

    const createRail = (z: number): void => {
      const rail = new Object3D(`${name}_Rail`);
      rail.geometry = applyBoxUVs(
        unitCubeGeo,
        railLength,
        railHeight,
        railWidth,
        Math.random(),
        Math.random(),
        false,
      );
      rail.scale.set(railLength, railHeight, railWidth);
      if (woodMat) rail.material = woodMat;
      rail.position.set(0, shelfHeight + railHeight / 2, z);
      rail.castShadow = true;
      rail.receiveShadow = true;
      baseGroup.add(rail);
    };

    createRail(legZ - legDepth / 2 + railWidth / 2);
    createRail(-legZ + legDepth / 2 - railWidth / 2);

    // Shelf Slats (Latten)
    const numSlats = 12;
    const slatDepth = shelfDepth + 0.04; // Overhangs rails slightly
    const slatHeight = 0.02;
    const slatGap = 0.02;
    const totalSlatWidth = railLength - 0.04; // Keep inside legs
    const slatWidth = (totalSlatWidth - (numSlats - 1) * slatGap) / numSlats;

    for (let i = 0; i < numSlats; i++) {
      const slat = new Object3D(`${name}_Slat_${i}`);
      // Grain along depth (Z). We rotate the object 90 deg around Y.
      slat.geometry = applyBoxUVs(
        unitCubeGeo,
        slatDepth,
        slatHeight,
        slatWidth,
        Math.random(),
        Math.random(),
        false,
      );
      slat.scale.set(slatDepth, slatHeight, slatWidth);
      slat.rotation.y = Math.PI / 2;
      if (woodMat) slat.material = woodMat;
      slat.castShadow = true;
      slat.receiveShadow = true;

      const xPos = -totalSlatWidth / 2 + slatWidth / 2 + i * (slatWidth + slatGap);
      slat.position.set(xPos, shelfHeight + railHeight / 2 + slatHeight / 2, 0);
      baseGroup.add(slat);
    }

    this.add(baseGroup);
  }
}
