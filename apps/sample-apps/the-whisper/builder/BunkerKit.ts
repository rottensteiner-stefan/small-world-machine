import type { Texture } from "@small-world-machine/engine";
import { Object3D, Cube, Cylinder, StandardMaterial, Color } from "@small-world-machine/engine";

export interface HeldTorchOptions {
  name?: string;
  /** Staff wood colour. */
  woodColor?: Color;
  /** Iron head / grip-wrap colour. */
  ironColor?: Color;
}

export interface RivetOptions {
  name?: string;
  /** Head radius. */
  radius?: number;
  /** Head height (protrusion depth along local +Z). */
  height?: number;
  color?: Color;
}

export interface BoltArrayOptions {
  name?: string;
  /** Local (x, y, z) position for each bolt — z is where the surface actually is at that (x, y),
   * not a shared flat plane (a rounded mesh's surface height varies with x/y). */
  positions: Array<[number, number, number]>;
  radius?: number;
  height?: number;
  color?: Color;
}

export interface TerminalBoltSetOptions {
  name?: string;
  /**
   * Measured half-extents of the loaded terminal mesh, in the SAME local space the bolt set is
   * attached in (i.e. measured on the actual glTF geometry, not guessed from documentation —
   * the Tripo3D reconstruction bulges into a rounded "pill" rather than a flat rugged slab, so a
   * flat-panel guess places bolts deep inside the volume or floating past the silhouette).
   */
  halfWidth: number;
  halfHeight: number;
  halfDepth: number;
  /** Screen bezel center, as a fraction of halfHeight above the vertical center (0..~0.6). */
  screenCenterYFraction?: number;
  /** How far the bolt head protrudes past the ellipsoid surface it's projected onto. */
  protrusion?: number;
}

export interface MorgueTrayOptions {
  name?: string;
  /** Overall tray width (X). */
  width?: number;
  /** Overall tray depth (Z). +Z is the head end that protrudes from the wall cabinet. */
  depth?: number;
  /** Height of the open side/foot rim walls (Y). */
  wallHeight?: number;
  /** Optional pre-loaded ID plate decal (e.g. `sign_koje42.png`) for the head-end plate. */
  plateTexture?: Texture;
}

/**
 * Bunker Kit Procedural Prop Generator.
 * Complements the Tripo3D-sourced bunker props (coffee grinder, terminal, bunk bed) with
 * geometry where exact per-face correctness matters more than sculpted detail.
 */
export class BunkerKit {
  /**
   * Creates a wall-cabinet cold-storage morgue drawer, pulled fully out.
   * Only the head end (the short face that protrudes out of the wall and is pulled by hand)
   * carries a handle and ID plate. The long sides stay open, plain steel — accessible from
   * above. The foot end (normally hidden inside the wall recess) is a bare steel cap with no
   * hardware at all, since it is never touched or seen from outside.
   * Exposes two named attachment sockets for scene-specific dressing:
   * - `NeckSpotlightTarget` near the head end (+Z), above the tray floor.
   * - `ToeTag` near the foot end (-Z), where a hanging forensic tag would sit.
   */
  public static createMorgueTray(options: MorgueTrayOptions = {}): Object3D {
    const name = options.name ?? "MorgueTray";
    const width = options.width ?? 0.8;
    const depth = options.depth ?? 1.85;
    const wallHeight = options.wallHeight ?? 0.12;
    const wallThk = 0.035;

    const group = new Object3D(name);
    const cubeGeo = new Cube({ size: 1.0 }).getGeometryData();
    const cylGeo = new Cylinder({
      radiusTop: 0.5,
      radiusBottom: 0.5,
      height: 1.0,
      radialSegments: 12,
    }).getGeometryData();

    const steelMat = new StandardMaterial({
      color: new Color(0.58, 0.61, 0.63),
      roughness: 0.42,
      metallic: 0.75,
    });

    const steelDarkMat = new StandardMaterial({
      color: new Color(0.16, 0.17, 0.19),
      roughness: 0.55,
      metallic: 0.6,
    });

    // 1. Tray Floor (Wanne)
    const floorPan = new Object3D("TrayFloor");
    floorPan.geometry = cubeGeo;
    floorPan.material = steelMat;
    floorPan.scale.set(width, 0.03, depth);
    floorPan.position.set(0, 0.015, 0);
    group.add(floorPan);

    // 2. Open Long Side Rims (Seiten offen & zugänglich — plain, no hardware)
    [-1, 1].forEach((side, idx) => {
      const rim = new Object3D(`SideRim_${idx}`);
      rim.geometry = cubeGeo;
      rim.material = steelMat;
      rim.scale.set(wallThk, wallHeight, depth);
      rim.position.set(side * (width * 0.5 - wallThk * 0.5), wallHeight * 0.5, 0);
      group.add(rim);
    });

    // 3. Foot-End Cap (-Z, hidden inside the wall recess — flush, no handle, no plate)
    const footCap = new Object3D("FootEndCap");
    footCap.geometry = cubeGeo;
    footCap.material = steelDarkMat;
    footCap.scale.set(width, wallHeight, wallThk);
    footCap.position.set(0, wallHeight * 0.5, -depth * 0.5 + wallThk * 0.5);
    group.add(footCap);

    // 4. Head-End Drawer Front (+Z, protrudes from the wall — carries handle + ID plate)
    const headCapHeight = wallHeight * 2.1;
    const headCap = new Object3D("HeadEndCap");
    headCap.geometry = cubeGeo;
    headCap.material = steelMat;
    headCap.scale.set(width, headCapHeight, wallThk * 1.6);
    headCap.position.set(0, headCapHeight * 0.5, depth * 0.5 - wallThk * 0.8);
    group.add(headCap);

    // 5. Pull Handle (only on the head end)
    const handleMat = steelDarkMat;
    const handleZ = depth * 0.5 + wallThk * 0.3;
    const handleY = headCapHeight * 0.55;
    [-1, 1].forEach((side, idx) => {
      const post = new Object3D(`HandlePost_${idx}`);
      post.geometry = cylGeo;
      post.material = handleMat;
      post.scale.set(0.02, 0.05, 0.02);
      post.rotation.x = Math.PI / 2;
      post.position.set(side * width * 0.22, handleY, handleZ);
      group.add(post);
    });
    const handleBar = new Object3D("HandleBar");
    handleBar.geometry = cylGeo;
    handleBar.material = handleMat;
    handleBar.scale.set(0.018, width * 0.44 + 0.05, 0.018);
    handleBar.rotation.z = Math.PI / 2;
    handleBar.position.set(0, handleY, handleZ + 0.05);
    group.add(handleBar);

    // 6. ID Plate (only on the head end, above the handle)
    const plateMat = new StandardMaterial({
      color: new Color(1, 1, 1),
      roughness: 0.5,
      metallic: 0.3,
      diffuseMap: options.plateTexture,
      alphaMap: options.plateTexture,
      transparent: options.plateTexture !== undefined,
    });
    const idPlate = new Object3D("IdPlate");
    idPlate.geometry = cubeGeo;
    idPlate.material = plateMat;
    idPlate.scale.set(width * 0.6, headCapHeight * 0.42, 0.008);
    idPlate.position.set(0, headCapHeight * 0.85, handleZ + 0.01);
    group.add(idPlate);

    // 7. Story-Dressing Attachment Sockets (empty, for scene-specific props/decals)
    const neckSocket = new Object3D("NeckSpotlightTarget");
    neckSocket.position.set(0, wallHeight + 0.18, depth * 0.22);
    group.add(neckSocket);

    const toeTagSocket = new Object3D("ToeTag");
    toeTagSocket.position.set(width * 0.3, wallHeight * 0.5, -depth * 0.42);
    group.add(toeTagSocket);

    return group;
  }

  /**
   * Creates a single slotted flathead bolt/rivet: a short cylindrical head with a recessed
   * screwdriver slot, protruding along local +Z. Meant to be attached as a child of a
   * single-mesh Tripo3D model (which cannot be edited surgically) to add real geometric
   * fastener detail that a toon `OutlineElement` pass can actually outline — unlike a bolt
   * baked only into a normal map, which has no silhouette.
   */
  public static createRivet(options: RivetOptions = {}): Object3D {
    const name = options.name ?? "Rivet";
    const radius = options.radius ?? 0.012;
    const height = options.height ?? 0.006;
    const color = options.color ?? new Color(0.14, 0.14, 0.15);

    const group = new Object3D(name);
    const headGeo = new Cylinder({
      radiusTop: radius,
      radiusBottom: radius,
      height,
      radialSegments: 10,
    }).getGeometryData();

    const headMat = new StandardMaterial({ color, roughness: 0.5, metallic: 0.7 });
    const head = new Object3D("Head");
    head.geometry = headGeo;
    head.material = headMat;
    head.rotation.x = Math.PI / 2;
    group.add(head);

    // Slotted screwdriver groove: a thin dark bar recessed into the head's outer face.
    const slotGeo = new Cube({ size: 1.0 }).getGeometryData();
    const slotMat = new StandardMaterial({
      color: new Color(0.03, 0.03, 0.035),
      roughness: 0.8,
      metallic: 0.1,
    });
    const slot = new Object3D("Slot");
    slot.geometry = slotGeo;
    slot.material = slotMat;
    slot.scale.set(radius * 1.5, radius * 0.28, height * 0.5);
    slot.position.set(0, 0, height * 0.26);
    group.add(slot);

    return group;
  }

  /**
   * Creates a set of rivets at given local (x, y, z) positions. Intended to be added as a
   * child of a loaded prop mesh whose own geometry cannot be edited.
   */
  public static createBoltArray(options: BoltArrayOptions): Object3D {
    const group = new Object3D(options.name ?? "BoltArray");
    const radius = options.radius ?? 0.012;
    const height = options.height ?? 0.006;
    const color = options.color ?? new Color(0.14, 0.14, 0.15);
    options.positions.forEach(([x, y, z], idx) => {
      const rivet = BunkerKit.createRivet({ name: `Bolt_${idx}`, radius, height, color });
      rivet.position.set(x, y, z);
      group.add(rivet);
    });
    return group;
  }

  /**
   * Creates the 8-bolt fastener set for the Amts-Terminal 2100 casing: 4 bolts at the outer
   * case corners (holding the rugged housing shell together) and 4 around the screen bezel
   * (holding the display window in place) — matching the concept art
   * (`public/assets/kits/bunker/terminal_2100/preview.jpg`), which the Tripo3D reconstruction
   * only baked into the normal map (fake bump, no real silhouette) rather than real geometry.
   *
   * The Tripo3D reconstruction bulges into a rounded "pill" rather than a flat rugged slab (a
   * known single-image-to-3D limitation), so bolts are projected onto that actual ellipsoid
   * surface — `z = halfDepth * sqrt(1 - (x/halfWidth)^2 - (y/halfHeight)^2)` — instead of a
   * flat panel plane, which would either bury them inside the volume or float them past the
   * silhouette depending on the guessed depth. Pass `halfWidth`/`halfHeight`/`halfDepth`
   * measured from the actual loaded mesh (see `_loadPropKits` in prologue.ts), not from
   * `meta.json`'s documented (and, for this asset, inaccurate) dimensions.
   */
  public static createTerminalBoltSet(options: TerminalBoltSetOptions): Object3D {
    const { halfWidth, halfHeight, halfDepth } = options;
    const screenCenterYFraction = options.screenCenterYFraction ?? 0.32;
    const protrusion = options.protrusion ?? 0.15;

    const surfaceZ = (uFrac: number, vFrac: number): number => {
      const u = uFrac;
      const v = vFrac;
      const under = Math.max(0.08, 1 - u * u - v * v);
      return halfDepth * Math.sqrt(under);
    };

    const point = (uFrac: number, vFrac: number): [number, number, number] => {
      const x = uFrac * halfWidth;
      const y = vFrac * halfHeight;
      const z = surfaceZ(uFrac, vFrac) * (1 + protrusion);
      return [x, y, z];
    };

    const caseCornerPositions: Array<[number, number, number]> = [
      point(-0.48, 0.55),
      point(0.48, 0.55),
      point(-0.48, -0.55),
      point(0.48, -0.55),
    ];

    const screenV = screenCenterYFraction;
    const bezelCornerPositions: Array<[number, number, number]> = [
      point(-0.24, screenV + 0.22),
      point(0.24, screenV + 0.22),
      point(-0.24, screenV - 0.22),
      point(0.24, screenV - 0.22),
    ];

    const group = new Object3D(options.name ?? "TerminalBoltSet");
    group.add(
      BunkerKit.createBoltArray({
        name: "CaseCornerBolts",
        positions: caseCornerPositions,
        radius: halfWidth * 0.075,
        height: halfDepth * 0.05,
      }),
    );
    group.add(
      BunkerKit.createBoltArray({
        name: "BezelBolts",
        positions: bezelCornerPositions,
        radius: halfWidth * 0.05,
        height: halfDepth * 0.035,
      }),
    );
    return group;
  }

  /**
   * Creates a handheld torch whose grip sits at the local origin: the wooden staff runs from the
   * butt (-Y) up to the iron basket head (+Y), where the scene's Fire prefab is placed. The staff
   * uses `StandardMaterial` so the carried firelight actually falls on its own wood.
   */
  public static createHeldTorch(options: HeldTorchOptions = {}): Object3D {
    const torch = new Object3D(options.name ?? "HeldTorch");
    const woodMat = new StandardMaterial({
      color: options.woodColor ?? new Color(0.42, 0.28, 0.16),
      roughness: 0.85,
      metallic: 0.0,
    });
    const ironMat = new StandardMaterial({
      color: options.ironColor ?? new Color(0.16, 0.15, 0.14),
      roughness: 0.55,
      metallic: 0.7,
    });

    const staff = new Object3D("TorchStaff");
    staff.geometry = new Cylinder({
      radiusTop: 0.016,
      radiusBottom: 0.024,
      height: 0.62,
      radialSegments: 10,
    }).getGeometryData();
    staff.material = woodMat;
    staff.position.set(0, 0.02, 0);
    torch.add(staff);

    const grip = new Object3D("TorchGrip");
    grip.geometry = new Cylinder({
      radiusTop: 0.024,
      radiusBottom: 0.024,
      height: 0.1,
      radialSegments: 10,
    }).getGeometryData();
    grip.material = ironMat;
    torch.add(grip);

    const head = new Object3D("TorchHead");
    head.geometry = new Cylinder({
      radiusTop: 0.028,
      radiusBottom: 0.05,
      height: 0.12,
      radialSegments: 12,
    }).getGeometryData();
    head.material = ironMat;
    head.position.set(0, 0.39, 0);
    torch.add(head);

    torch.position.set(0, 0, 0);
    torch.rotation.set(0, 0, 0);

    return torch;
  }
}
