import type { Vector3D } from "@small-world-machine/engine";
import {
  Object3D,
  Cube,
  Cylinder,
  StandardMaterial,
  Color,
  PointLight,
} from "@small-world-machine/engine";

export interface FluorescentLampOptions {
  name?: string;
  length?: number;
  caged?: boolean;
  intensity?: number;
  lightDistance?: number;
  color?: Color;
  emissiveColor?: Color;
}

export interface ConduitSegment {
  start: Vector3D;
  end: Vector3D;
  radius?: number;
  junctionAtStart?: boolean;
  junctionAtEnd?: boolean;
}

export interface PillarOptions {
  name?: string;
  width?: number;
  depth?: number;
  height?: number;
  hasCapital?: boolean;
  hasBase?: boolean;
  color?: Color;
}

export interface BeamOptions {
  name?: string;
  width?: number;
  height?: number;
  length?: number;
  color?: Color;
}

export interface SegmentedWallOptions {
  name?: string;
  totalWidth?: number;
  height?: number;
  thickness?: number;
  segmentWidth?: number;
  baseboardHeight?: number;
  hasPillars?: boolean;
}

/**
 * Flakturm Kit Modular Prop and Material Generator.
 * Provides procedurally styled brutalist props (fluorescent fixtures, electrical conduits, signs, debris)
 * and PBR material definitions matching the Vienna Flakturm architecture.
 */
export class FlakturmKit {
  /**
   * Creates an authentic industrial fluorescent tube fixture.
   * Variant 1: Caged industrial fixture (Wannenleuchte mit Schutzgitter).
   * Variant 2: Bare industrial double tube fixture (Nackte Industrie-Leuchtstoffröhre).
   */
  public static createFluorescentLamp(options: FluorescentLampOptions = {}): Object3D {
    const name = options.name ?? "FluorescentLamp";
    const length = options.length ?? 1.2;
    const caged = options.caged ?? true;
    const intensity = options.intensity ?? 1.8;
    const lightDist = options.lightDistance ?? 6.0;
    const tubeColor = options.emissiveColor ?? new Color(0.9, 0.96, 1.0);
    const lightColor = options.color ?? new Color(0.85, 0.92, 1.0);

    const group = new Object3D(name);
    const cubeGeo = new Cube({ size: 1.0 }).getGeometryData();
    const cylGeo = new Cylinder({
      radiusTop: 0.5,
      radiusBottom: 0.5,
      height: 1.0,
      radialSegments: 12,
    }).getGeometryData();

    // 1. Metal Base Housing (Field Grey / Olive-drab)
    const housingMat = new StandardMaterial({
      color: new Color(0.24, 0.26, 0.23),
      roughness: 0.7,
      metallic: 0.4,
    });

    const housing = new Object3D("Housing");
    housing.geometry = cubeGeo;
    housing.material = housingMat;
    housing.scale.set(0.18, 0.08, length);
    housing.position.set(0, 0, 0);
    group.add(housing);

    // 2. Dual Glass Fluorescent Tubes (Emissive White)
    const tubeMat = new StandardMaterial({
      color: tubeColor,
      roughness: 0.1,
      metallic: 0.0,
    });

    const tubeOffsets = [-0.04, 0.04];
    tubeOffsets.forEach((ox, idx) => {
      const tube = new Object3D(`Tube_${idx}`);
      tube.geometry = cylGeo;
      tube.material = tubeMat;
      tube.scale.set(0.024, length * 0.9, 0.024);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(ox, -0.04, 0);
      group.add(tube);
    });

    // 3. Optional Protective Wire Cage (Schutzgitter)
    if (caged) {
      const cageMat = new StandardMaterial({
        color: new Color(0.18, 0.18, 0.2),
        roughness: 0.5,
        metallic: 0.8,
      });

      const cageSteps = 6;
      for (let i = 0; i <= cageSteps; i++) {
        const cz = (i / cageSteps - 0.5) * (length * 0.92);
        const hoop = new Object3D(`CageHoop_${i}`);
        hoop.geometry = cubeGeo;
        hoop.material = cageMat;
        hoop.scale.set(0.2, 0.09, 0.015);
        hoop.position.set(0, -0.05, cz);
        group.add(hoop);
      }
    }

    // 4. Downward Cast Light
    const light = new PointLight({
      name: `${name}_PointLight`,
      color: lightColor,
      intensity,
      distance: lightDist,
    });
    light.position.set(0, -0.15, 0);
    group.add(light);

    return group;
  }

  /**
   * Creates modular surface-mounted electrical conduit wiring with junction boxes and wall clips.
   */
  public static createConduitRun(segments: ConduitSegment[]): Object3D {
    const group = new Object3D("ConduitRun");
    const cylGeo = new Cylinder({
      radiusTop: 0.5,
      radiusBottom: 0.5,
      height: 1.0,
      radialSegments: 8,
    }).getGeometryData();
    const cubeGeo = new Cube({ size: 1.0 }).getGeometryData();

    const cableMat = new StandardMaterial({
      color: new Color(0.12, 0.12, 0.14),
      roughness: 0.85,
      metallic: 0.1,
    });

    const boxMat = new StandardMaterial({
      color: new Color(0.08, 0.08, 0.09),
      roughness: 0.6,
      metallic: 0.2,
    });

    segments.forEach((seg, idx) => {
      const radius = seg.radius ?? 0.02;
      const dx = seg.end.x - seg.start.x;
      const dy = seg.end.y - seg.start.y;
      const dz = seg.end.z - seg.start.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (len > 0.001) {
        const cable = new Object3D(`Cable_${idx}`);
        cable.geometry = cylGeo;
        cable.material = cableMat;
        cable.scale.set(radius, len, radius);

        const midX = (seg.start.x + seg.end.x) * 0.5;
        const midY = (seg.start.y + seg.end.y) * 0.5;
        const midZ = (seg.start.z + seg.end.z) * 0.5;
        cable.position.set(midX, midY, midZ);

        // Orient cylinder along delta vector
        if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
          const yaw = Math.atan2(dx, dz);
          const pitch = Math.atan2(Math.sqrt(dx * dx + dz * dz), dy);
          cable.rotation.y = yaw;
          cable.rotation.z = -pitch;
        }

        group.add(cable);
      }

      // Junction Box at start if requested
      if (seg.junctionAtStart) {
        const jbox = new Object3D(`JunctionBox_Start_${idx}`);
        jbox.geometry = cylGeo;
        jbox.material = boxMat;
        jbox.scale.set(0.12, 0.06, 0.12);
        jbox.position.set(seg.start.x, seg.start.y, seg.start.z);
        group.add(jbox);
      }

      // Junction Box at end if requested
      if (seg.junctionAtEnd) {
        const jbox = new Object3D(`JunctionBox_End_${idx}`);
        jbox.geometry = cylGeo;
        jbox.material = boxMat;
        jbox.scale.set(0.12, 0.06, 0.12);
        jbox.position.set(seg.end.x, seg.end.y, seg.end.z);
        group.add(jbox);
      }

      // Wall Mounting Bracket / Schelle (midpoint)
      const bracket = new Object3D(`Bracket_${idx}`);
      bracket.geometry = cubeGeo;
      bracket.material = boxMat;
      bracket.scale.set(radius * 2.2, 0.02, radius * 2.2);
      bracket.position.set(
        (seg.start.x + seg.end.x) * 0.5,
        (seg.start.y + seg.end.y) * 0.5,
        (seg.start.z + seg.end.z) * 0.5,
      );
      group.add(bracket);
    });

    return group;
  }

  /**
   * Creates a procedural rubble & concrete debris cluster with exposed rebar.
   */
  public static createDebrisCluster(count = 8, radius = 1.0): Object3D {
    const cluster = new Object3D("DebrisCluster");
    const cubeGeo = new Cube({ size: 1.0 }).getGeometryData();
    const cylGeo = new Cylinder({
      radiusTop: 0.5,
      radiusBottom: 0.5,
      height: 1.0,
      radialSegments: 8,
    }).getGeometryData();

    const concreteMat = new StandardMaterial({
      color: new Color(0.38, 0.38, 0.36),
      roughness: 0.95,
      metallic: 0.05,
    });

    const brickMat = new StandardMaterial({
      color: new Color(0.48, 0.22, 0.16),
      roughness: 0.9,
      metallic: 0.0,
    });

    const rebarMat = new StandardMaterial({
      color: new Color(0.45, 0.22, 0.14),
      roughness: 0.7,
      metallic: 0.6,
    });

    for (let i = 0; i < count; i++) {
      const isBrick = i % 3 === 0;
      const chunk = new Object3D(`RubbleChunk_${i}`);
      chunk.geometry = cubeGeo;
      chunk.material = isBrick ? brickMat : concreteMat;

      const sx = 0.1 + Math.random() * 0.25;
      const sy = 0.08 + Math.random() * 0.18;
      const sz = 0.1 + Math.random() * 0.25;
      chunk.scale.set(sx, sy, sz);

      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius;
      chunk.position.set(Math.cos(angle) * dist, sy * 0.5, Math.sin(angle) * dist);
      chunk.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      cluster.add(chunk);
    }

    // Exposed bent rebar hooks
    for (let r = 0; r < 2; r++) {
      const rebar = new Object3D(`RebarHook_${r}`);
      rebar.geometry = cylGeo;
      rebar.material = rebarMat;
      rebar.scale.set(0.015, 0.5, 0.015);
      rebar.position.set((r - 0.5) * 0.4, 0.2, (Math.random() - 0.5) * 0.4);
      rebar.rotation.set(0.6, Math.random() * Math.PI, 0.4);
      cluster.add(rebar);
    }

    return cluster;
  }

  /**
   * Creates a wall-mounted square steel ventilation & escape hatch door with woven wire mesh grid
   * (Gitter-Schachttür as seen in corridor reference flakturm_ref_18.jpg).
   */
  public static createVentHatch(
    options: {
      name?: string;
      width?: number;
      height?: number;
      depth?: number;
      openAngle?: number;
    } = {},
  ): Object3D {
    const name = options.name ?? "BunkerVentHatch";
    const width = options.width ?? 0.85;
    const height = options.height ?? 0.95;
    const depth = options.depth ?? 0.15;
    const openAngle = options.openAngle ?? Math.PI / 2.2;

    const group = new Object3D(name);
    const cubeGeo = new Cube({ size: 1.0 }).getGeometryData();
    const cylGeo = new Cylinder({
      radiusTop: 0.5,
      radiusBottom: 0.5,
      height: 1.0,
      radialSegments: 8,
    }).getGeometryData();

    const frameMat = new StandardMaterial({
      color: new Color(0.22, 0.23, 0.25),
      roughness: 0.65,
      metallic: 0.5,
    });

    const meshMat = new StandardMaterial({
      color: new Color(0.18, 0.19, 0.2),
      roughness: 0.45,
      metallic: 0.8,
    });

    // 1. Wall Collar Frame (Wandzarge)
    const collar = new Object3D("WallCollar");
    collar.geometry = cubeGeo;
    collar.material = frameMat;
    collar.scale.set(width + 0.08, height + 0.08, depth);
    collar.position.set(0, 0, 0);
    group.add(collar);

    // Inner cavity opening (dark back)
    const cavityMat = new StandardMaterial({
      color: new Color(0.04, 0.04, 0.05),
      roughness: 0.95,
      metallic: 0.0,
    });
    const cavity = new Object3D("CavityHole");
    cavity.geometry = cubeGeo;
    cavity.material = cavityMat;
    cavity.scale.set(width * 0.9, height * 0.9, depth * 0.95);
    cavity.position.set(0, 0, -0.01);
    group.add(cavity);

    // 2. Door Hinge & Swing Assembly
    const doorHinge = new Object3D("DoorHinge");
    doorHinge.position.set(-width * 0.5, 0, depth * 0.5);
    doorHinge.rotation.y = openAngle;

    // Door outer rectangular frame
    const doorLeaf = new Object3D("DoorLeaf");
    doorLeaf.position.set(width * 0.5, 0, 0);

    const borderThickness = 0.06;
    const borders: [number, number, number, number, number, number][] = [
      [0, height * 0.5 - borderThickness * 0.5, 0, width, borderThickness, 0.04],
      [0, -height * 0.5 + borderThickness * 0.5, 0, width, borderThickness, 0.04],
      [-width * 0.5 + borderThickness * 0.5, 0, 0, borderThickness, height, 0.04],
      [width * 0.5 - borderThickness * 0.5, 0, 0, borderThickness, height, 0.04],
    ];

    borders.forEach(([px, py, pz, sx, sy, sz], idx) => {
      const bar = new Object3D(`BorderBar_${idx}`);
      bar.geometry = cubeGeo;
      bar.material = frameMat;
      bar.scale.set(sx, sy, sz);
      bar.position.set(px, py, pz);
      doorLeaf.add(bar);
    });

    // Wire Mesh Grid Bars (Horizontal and Vertical lattice)
    const gridSteps = 7;
    for (let g = 1; g < gridSteps; g++) {
      const gy = (g / gridSteps - 0.5) * (height - borderThickness * 2);
      const hBar = new Object3D(`MeshHBar_${g}`);
      hBar.geometry = cylGeo;
      hBar.material = meshMat;
      hBar.scale.set(0.008, width - borderThickness * 2, 0.008);
      hBar.rotation.z = Math.PI / 2;
      hBar.position.set(0, gy, 0);
      doorLeaf.add(hBar);

      const gx = (g / gridSteps - 0.5) * (width - borderThickness * 2);
      const vBar = new Object3D(`MeshVBar_${g}`);
      vBar.geometry = cylGeo;
      vBar.material = meshMat;
      vBar.scale.set(0.008, height - borderThickness * 2, 0.008);
      vBar.position.set(gx, 0, 0);
      doorLeaf.add(vBar);
    }

    // Door Handle / Latch
    const latch = new Object3D("LatchHandle");
    latch.geometry = cubeGeo;
    latch.material = frameMat;
    latch.scale.set(0.04, 0.12, 0.06);
    latch.position.set(width * 0.5 - 0.04, 0, 0.04);
    doorLeaf.add(latch);

    doorHinge.add(doorLeaf);
    group.add(doorHinge);

    return group;
  }

  /**
   * Creates a reinforced concrete wall pillar / pilaster (ADR 0019) to break up long wall spans.
   */
  public static createPillar(options: PillarOptions = {}): Object3D {
    const name = options.name ?? "ConcretePillar";
    const width = options.width ?? 0.5;
    const depth = options.depth ?? 0.5;
    const height = options.height ?? 3.2;
    const hasCapital = options.hasCapital ?? true;
    const hasBase = options.hasBase ?? true;

    const group = new Object3D(name);
    const cubeGeo = new Cube({ size: 1.0 }).getGeometryData();
    const concreteMat = new StandardMaterial({
      color: options.color ?? new Color(0.2, 0.22, 0.25),
      roughness: 0.9,
      metallic: 0.1,
    });

    // Main Column Shaft
    const shaft = new Object3D("PillarShaft");
    shaft.geometry = cubeGeo;
    shaft.material = concreteMat;
    shaft.scale.set(width, height, depth);
    shaft.position.set(0, height * 0.5, 0);
    group.add(shaft);

    // Stepped Base (Sockel)
    if (hasBase) {
      const base = new Object3D("PillarBase");
      base.geometry = cubeGeo;
      base.material = concreteMat;
      base.scale.set(width * 1.15, 0.25, depth * 1.15);
      base.position.set(0, 0.125, 0);
      group.add(base);
    }

    // Capital / Head (Kämpferplatte unter Deckenbalken)
    if (hasCapital) {
      const cap = new Object3D("PillarCapital");
      cap.geometry = cubeGeo;
      cap.material = concreteMat;
      cap.scale.set(width * 1.2, 0.2, depth * 1.2);
      cap.position.set(0, height - 0.1, 0);
      group.add(cap);
    }

    return group;
  }

  /**
   * Creates a heavy reinforced concrete ceiling beam / girder (ADR 0019).
   */
  public static createBeam(options: BeamOptions = {}): Object3D {
    const name = options.name ?? "ConcreteBeam";
    const width = options.width ?? 0.4;
    const height = options.height ?? 0.5;
    const length = options.length ?? 6.0;

    const group = new Object3D(name);
    const cubeGeo = new Cube({ size: 1.0 }).getGeometryData();
    const concreteMat = new StandardMaterial({
      color: options.color ?? new Color(0.18, 0.2, 0.23),
      roughness: 0.9,
      metallic: 0.1,
    });

    const beamMesh = new Object3D("BeamMesh");
    beamMesh.geometry = cubeGeo;
    beamMesh.material = concreteMat;
    beamMesh.scale.set(width, height, length);
    beamMesh.position.set(0, -height * 0.5, 0);
    group.add(beamMesh);

    return group;
  }

  /**
   * Creates a modular segmented wall according to the 4-pillar scale doctrine (ADR 0019).
   * Partitions a wide wall into rhythmic panels, damp baseboard, and separating pilasters.
   */
  public static createSegmentedWall(options: SegmentedWallOptions = {}): Object3D {
    const name = options.name ?? "SegmentedWall";
    const totalWidth = options.totalWidth ?? 10.0;
    const height = options.height ?? 3.2;
    const thickness = options.thickness ?? 0.3;
    const targetSegmentWidth = options.segmentWidth ?? 3.5;
    const baseboardHeight = options.baseboardHeight ?? 0.8;
    const hasPillars = options.hasPillars ?? true;

    const group = new Object3D(name);
    const cubeGeo = new Cube({ size: 1.0 }).getGeometryData();

    const wallMat = new StandardMaterial({
      color: new Color(0.2, 0.22, 0.25),
      roughness: 0.9,
      metallic: 0.1,
    });

    const dampBaseMat = new StandardMaterial({
      color: new Color(0.12, 0.14, 0.16),
      roughness: 0.95,
      metallic: 0.05,
    });

    const numSegments = Math.max(1, Math.round(totalWidth / targetSegmentWidth));
    const segmentWidth = totalWidth / numSegments;
    const upperHeight = height - baseboardHeight;

    for (let s = 0; s < numSegments; s++) {
      const centerX = (s + 0.5) * segmentWidth - totalWidth * 0.5;

      // 1. Damp Baseboard Panel
      const basePanel = new Object3D(`BasePanel_${s}`);
      basePanel.geometry = cubeGeo;
      basePanel.material = dampBaseMat;
      basePanel.scale.set(segmentWidth, baseboardHeight, thickness);
      basePanel.position.set(centerX, baseboardHeight * 0.5, 0);
      group.add(basePanel);

      // 2. Upper Wall Panel (takes main concrete/panel texture)
      const upperPanel = new Object3D(`UpperPanel_${s}`);
      upperPanel.geometry = cubeGeo;
      upperPanel.material = wallMat;
      upperPanel.scale.set(segmentWidth, upperHeight, thickness);
      upperPanel.position.set(centerX, baseboardHeight + upperHeight * 0.5, 0);
      group.add(upperPanel);
    }

    // 3. Separating Pilasters between panels and at ends
    if (hasPillars) {
      const pillarWidth = 0.45;
      const pillarDepth = thickness + 0.15;
      for (let p = 0; p <= numSegments; p++) {
        const px = p * segmentWidth - totalWidth * 0.5;
        const pillar = this.createPillar({
          name: `Pilaster_${p}`,
          width: pillarWidth,
          depth: pillarDepth,
          height: height,
          hasCapital: true,
          hasBase: true,
        });
        pillar.position.set(px, 0, 0);
        group.add(pillar);
      }
    }

    return group;
  }
}
