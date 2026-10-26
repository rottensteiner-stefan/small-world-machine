import type { Geometry } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Annulus,
  Arch,
  Barrel,
  BoundingBox,
  CameraStrategyType,
  Capsule,
  Circle,
  Color,
  Cone,
  Cube,
  CutCylinder,
  Cylinder,
  CylindricalArch,
  DirectionalLight,
  Disk,
  ExtrudeGeometry,
  FPSController,
  Gear,
  Grid,
  Ground,
  HollowCylinder,
  HollowTruncatedCone,
  Line,
  LShape,
  Object3D,
  Octahedron,
  OpenFrame,
  Plane,
  PointedPillar,
  PolygonFan,
  Polyline,
  Pyramid,
  Rhombus,
  Sphere,
  SphericalCap,
  SphericalTriangleSector,
  StandardMaterial,
  Terrain,
  TextTexture,
  Texture,
  Torus,
  Triangle,
  TriStar,
  TruncatedCone,
  Tube,
  Vector2D,
  Vector3D,
  WireframeMaterial,
  ZoomController,
} from "@small-world-machine/engine";
import {
  computeCellFaces,
  FilledPolygon,
  Lathe,
  MarchingCubes,
  metaballField,
  MobiusStrip,
  ParametricSurface,
  PlatonicSolid,
  Supershape,
  TorusKnot,
  VoronoiCells,
  VoronoiShardGeometry,
} from "@small-world-machine/geometry-extras";
import { attachDevTools } from "@small-world-machine/tools";

/**
 * Showcase 6: Geometry Showcase.
 */
export class Showcase6 extends AbstractShowcase {
  private _moveSpeed: number = 10.0;

  /** @inheritdoc */
  protected override async setupScene(): Promise<void> {
    this.onCanvasRecreated();

    // 0. Initialize Octrees for Collision
    this.scene.initOctrees(
      new BoundingBox(new Vector3D(-100, -10, -100), new Vector3D(100, 50, 100)),
    );

    // 1. Camera Setup
    this.defaultFov = (75 * Math.PI) / 180;
    this.configureCamera();
    this.camera.setStrategy(CameraStrategyType.FPS);
    this.camera.position.set(0, 4, -40);

    this.camera.addBehavior(
      new FPSController({
        input: this.input,
        moveSpeed: this._moveSpeed,
        collisionRadius: 0.6,
        scene: this.scene,
      }),
    );
    this.camera.addBehavior(new ZoomController({ input: this.input }));

    // 3. Lights (Bright, multi-angle studio lighting so textured bodies are brilliantly lit)
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.75 }));

    const sun: DirectionalLight = new DirectionalLight({ color: Color.WHITE, intensity: 1.35 });
    sun.direction.set(-1, -1.6, -0.8).normalize();
    this.scene.add(sun);

    const fillLight: DirectionalLight = new DirectionalLight({
      color: new Color(0.953, 0.977, 1),
      intensity: 0.7,
    });
    fillLight.direction.set(1, 0.8, 1.0).normalize();
    this.scene.add(fillLight);

    const backLight: DirectionalLight = new DirectionalLight({
      color: new Color(1, 0.977, 0.929),
      intensity: 0.45,
    });
    backLight.direction.set(0, -0.5, 1.2).normalize();
    this.scene.add(backLight);

    // 4. Floor Grid
    const gridObj: Object3D = new Object3D("FloorGrid");
    gridObj.geometry = new Grid({ size: 160, divisions: 80 }).getGeometryData();
    const gridMat: WireframeMaterial = new WireframeMaterial();
    gridMat.color = Color.fromName("darkslategray")!;
    gridObj.material = gridMat;
    gridObj.isStatic = true;
    this.scene.add(gridObj);

    // 5. Shared Materials (Wireframe, Random Solid PBR, Fireplace Brick PBR Maps)
    const wireMat: WireframeMaterial = new WireframeMaterial();
    wireMat.color = Color.CYAN;

    // Load Fireplace Brick PBR texture maps (Albedo, Normal, Roughness)
    const brickAlbedo = await Texture.fromUrl("./assets/fireplace_brick_albedo.webp");
    const brickNormal = await Texture.fromUrl("./assets/fireplace_brick_normal.webp");
    const brickRoughness = await Texture.fromUrl("./assets/fireplace_brick_roughness.webp");

    const brickMat = new StandardMaterial({
      diffuseMap: brickAlbedo,
      normalMap: brickNormal,
      roughnessMap: brickRoughness,
      roughness: 0.85,
      metallic: 0.0,
    });

    const getRandomColor = (): Color => {
      return new Color(
        Math.random() * 0.7 + 0.3,
        Math.random() * 0.7 + 0.3,
        Math.random() * 0.7 + 0.3,
      );
    };

    const formatDisplayName = (name: string): string => {
      const map: Record<string, string> = {
        Cube: "Cube",
        Sphere: "Sphere",
        Pyramid: "Pyramid",
        Octahedron: "Octahedron",
        Torus: "Torus",
        Capsule: "Capsule",
        Cone: "Cone",
        Cylinder: "Cylinder",
        TruncatedCone: "Truncated Cone",
        CutCylinder: "Cut Cylinder",
        PointedPillar: "Pointed Pillar",
        HollowCylinder: "Hollow Cylinder",
        Barrel: "Barrel",
        SphericalCap: "Spherical Cap",
        SphericalTriangleSector: "Spherical Triangle Sector",
        Arch: "Roman Arch",
        Circle: "Circle",
        Disk: "Disk",
        Annulus: "Annulus",
        Plane: "Plane",
        Ground: "Ground",
        Triangle: "Triangle",
        CylinderSector: "Cylinder Sector",
        FilledPolygon: "Filled Polygon",
        Line: "Line",
        Polyline: "Polyline",
        Tube: "Tube",
        PolygonFan: "Polygon Fan",
        Gear: "Gear",
        Extrude: "Extruded Polygon",
        Lathe: "Lathe",
        Terrain: "Terrain Heightfield",
        Tetrahedron: "Tetrahedron",
        Dodecahedron: "Dodecahedron",
        Icosahedron: "Icosahedron",
        TorusKnot: "Torus Knot",
        MobiusStrip: "Möbius Strip",
        Supershape: "Supershape",
        ParametricSurface: "Parametric Surface",
        MarchingCubes: "Marching Cubes",
        VoronoiCells: "Voronoi Cells",
        VoronoiShard: "Voronoi Shard",
        OpenFrame: "Open Frame",
        LShape: "L-Shape",
        Rhombus: "Rhombus",
        TriStar: "Tri-Star",
        CylindricalArch: "Cylindrical Arch",
        HollowTruncatedCone: "Hollow Truncated Cone",
      };
      return map[name] ?? name;
    };

    const addGeometryItem = (
      name: string,
      geometry: Geometry,
      x: number,
      z: number,
      dimension: "3d" | "2d" | "1d" = "3d",
    ): void => {
      const geomData = geometry.getGeometryData();
      const box = BoundingBox.fromVertices(geomData.vertices);
      const widthX = Math.max(1.0, box.max.x - box.min.x);
      const halfWidth = widthX / 2;
      const depthZ = Math.max(1.0, box.max.z - box.min.z);
      const halfDepth = depthZ / 2;

      // Ensure a generous gap between bounding boxes within the group so they never overlap
      const gap = 0.8;
      const dx3d = widthX + gap;
      const dx2d = halfWidth + gap / 2;

      // 0. Ground Plaque / Sign: White background with Navy Blue text placed in FRONT of the booth
      const displayName = formatDisplayName(name);
      const textTexture = new TextTexture({
        text: displayName,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 40,
        fontWeight: 700,
        color: "#001f3f", // Navy blue
        background: "#ffffff", // Pure white background
        padding: 14,
        align: "center",
        pixelRatio: 2,
      });

      const signObj = new Object3D(`${name}_Sign`);
      signObj.geometry = new Plane({ width: 2.8, height: 0.75 }).getGeometryData();
      signObj.material = new StandardMaterial({
        diffuseMap: textTexture.texture,
        roughness: 0.2,
        metallic: 0.0,
      });
      // Sign placed at the front edge of the pedestal in front of the center body
      const signZ = z - Math.max(2.4, halfDepth + 1.4);
      signObj.position.set(x, 0.25, signZ);
      signObj.rotation.x = -Math.PI / 4;
      signObj.isStatic = true;
      this.scene.add(signObj);

      if (dimension === "1d") {
        // Pure 1D lines / stroke paths: Wireframe in center
        const objWire: Object3D = new Object3D(`${name}_Wire`);
        objWire.geometry = geomData;
        objWire.material = wireMat;
        objWire.position.set(x, 2.0, z);
        objWire.isStatic = true;
        objWire.isCollidable = true;
        this.scene.add(objWire);
      } else if (dimension === "2d") {
        // 2D flat planar surfaces: Left = Wireframe, Right = Solid Color
        const objWire: Object3D = new Object3D(`${name}_Wire`);
        objWire.geometry = geomData;
        objWire.material = wireMat;
        objWire.position.set(x - dx2d, 2.0, z);
        objWire.isStatic = true;
        objWire.isCollidable = true;
        this.scene.add(objWire);

        const objSolid: Object3D = new Object3D(`${name}_Solid`);
        objSolid.geometry = geomData;
        const solidMat = new StandardMaterial({
          color: getRandomColor(),
          roughness: 0.45,
          metallic: 0.15,
        });
        objSolid.material = solidMat;
        objSolid.position.set(x + dx2d, 2.0, z);
        objSolid.isStatic = true;
        objSolid.isCollidable = true;
        this.scene.add(objSolid);
      } else {
        // 3D volumetric bodies: Left = Wireframe, Center = Solid Color, Right = Textured Fireplace Brick
        const objWire: Object3D = new Object3D(`${name}_Wire`);
        objWire.geometry = geomData;
        objWire.material = wireMat;
        objWire.position.set(x - dx3d, 2.0, z);
        objWire.isStatic = true;
        objWire.isCollidable = true;
        this.scene.add(objWire);

        const objSolid: Object3D = new Object3D(`${name}_Solid`);
        objSolid.geometry = geomData;
        const solidMat = new StandardMaterial({
          color: getRandomColor(),
          roughness: 0.45,
          metallic: 0.15,
        });
        objSolid.material = solidMat;
        objSolid.position.set(x, 2.0, z);
        objSolid.isStatic = true;
        objSolid.isCollidable = true;
        this.scene.add(objSolid);

        const objBrick: Object3D = new Object3D(`${name}_Brick`);
        objBrick.geometry = geomData;
        objBrick.material = brickMat;
        objBrick.position.set(x + dx3d, 2.0, z);
        objBrick.isStatic = true;
        objBrick.isCollidable = true;
        this.scene.add(objBrick);
      }
    };

    // Helper: 3D Helix Polyline
    const helixPts: Vector3D[] = [];
    const helixTurns = 3;
    const helixSegmentCount = 64;
    for (let j = 0; j <= helixSegmentCount; j++) {
      const t = (j / helixSegmentCount) * helixTurns * Math.PI * 2;
      const y = (j / helixSegmentCount) * 3 - 1.5;
      helixPts.push(new Vector3D(Math.cos(t) * 1.2, y, Math.sin(t) * 1.2));
    }

    // Helper: 5-Point Regular Star PolygonFan
    const starFanPts: Vector3D[] = [];
    const starPoints = 5;
    for (let j = 0; j < starPoints * 2; j++) {
      const angle = (j * Math.PI) / starPoints - Math.PI / 2;
      const r = j % 2 === 0 ? 1.5 : 0.65;
      starFanPts.push(new Vector3D(Math.cos(angle) * r, Math.sin(angle) * r, 0));
    }

    // Helper: Filled Polygon with Hole (Square with circular cutout)
    const squareOuterRing = [
      new Vector3D(-1.5, 0, -1.5),
      new Vector3D(1.5, 0, -1.5),
      new Vector3D(1.5, 0, 1.5),
      new Vector3D(-1.5, 0, 1.5),
    ];
    const circularHoleRing: Vector3D[] = [];
    const holeSegments = 16;
    for (let j = 0; j < holeSegments; j++) {
      const a = (j / holeSegments) * Math.PI * 2;
      circularHoleRing.push(new Vector3D(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7));
    }

    // Helper: Procedural wavy heightfield Terrain
    const terrainRes = 16;
    const terrainData = new Float32Array(terrainRes * terrainRes);
    for (let tz = 0; tz < terrainRes; tz++) {
      for (let tx = 0; tx < terrainRes; tx++) {
        const u = (tx / (terrainRes - 1)) * Math.PI * 2;
        const v = (tz / (terrainRes - 1)) * Math.PI * 2;
        terrainData[tz * terrainRes + tx] = (Math.sin(u) * Math.cos(v) + 1) * 0.5;
      }
    }
    const terrainGeom = Terrain.fromHeightData({
      heightData: terrainData,
      heightmapResolution: terrainRes,
      width: 3,
      depth: 3,
      maxHeight: 1.2,
      meshWidthSegments: 16,
      meshDepthSegments: 16,
    });

    // Helper: Single Voronoi fracture shard
    const shardFaces = computeCellFaces(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0.5, z: 0.2 },
        { x: -0.8, y: 0.9, z: -0.3 },
        { x: 0.3, y: -1, z: 0.5 },
        { x: -0.4, y: -0.5, z: -0.9 },
      ],
      0,
      { min: { x: -1.4, y: -1.4, z: -1.4 }, max: { x: 1.4, y: 1.4, z: 1.4 } },
    );
    const shardGeom = shardFaces
      ? new VoronoiShardGeometry(shardFaces)
      : new PlatonicSolid({ solid: "tetrahedron", radius: 1.5 });

    const geometries: { name: string; geom: Geometry; dimension?: "3d" | "2d" | "1d" }[] = [
      // Row 1: Core Polyhedra & 3D Curved Primitives (7 items)
      { name: "Cube", geom: new Cube({ size: 2.4 }) },
      { name: "Sphere", geom: new Sphere({ radius: 1.4, widthSegments: 32, heightSegments: 24 }) },
      { name: "Cone", geom: new Cone({ radius: 1.4, height: 2.8, radialSegments: 32 }) },
      {
        name: "Cylinder",
        geom: new Cylinder({ radiusTop: 1.4, radiusBottom: 1.4, height: 2.8, radialSegments: 32 }),
      },
      { name: "Pyramid", geom: new Pyramid({ base: 2.6, height: 2.8, radialSegments: 4 }) },
      { name: "Octahedron", geom: new Octahedron({ radius: 1.6 }) },
      {
        name: "Torus",
        geom: new Torus({ radius: 1.4, tube: 0.45, radialSegments: 16, tubularSegments: 32 }),
      },

      // Row 2: Capsules, Frustums & Rechneronline Bodies (7 items)
      {
        name: "Capsule",
        geom: new Capsule({ radius: 0.9, length: 1.8, radialSegments: 16, capSegments: 8 }),
      },
      {
        name: "TruncatedCone",
        geom: new TruncatedCone({
          radiusBottom: 1.4,
          radiusTop: 0.7,
          height: 2.8,
          radialSegments: 32,
        }),
      },
      {
        name: "CutCylinder",
        geom: new CutCylinder({ radius: 1.4, heightMin: 1.2, heightMax: 3.0, radialSegments: 32 }),
      },
      {
        name: "PointedPillar",
        geom: new PointedPillar({
          radiusBase: 1.1,
          radiusTransition: 0.75,
          heightPillar: 2.0,
          heightTip: 1.0,
          radialSegments: 32,
        }),
      },
      {
        name: "HollowCylinder",
        geom: new HollowCylinder({
          radiusOuter: 1.4,
          wallThickness: 0.4,
          height: 2.8,
          radialSegments: 32,
        }),
      },
      {
        name: "Barrel",
        geom: new Barrel({
          radiusMiddle: 1.4,
          radiusEnds: 1.0,
          height: 2.8,
          radialSegments: 32,
          heightSegments: 16,
        }),
      },
      {
        name: "Tube",
        geom: new Tube({
          radius: 1.4,
          innerRadius: 0.75,
          height: 2.8,
          radialSegments: 32,
          heightSegments: 1,
        }),
      },

      // Row 3: Slices, Vaults, Gears, Arches & Frustums (7 items)
      {
        name: "CylindricalArch",
        geom: new CylindricalArch({
          pipeRadius: 0.6,
          bendRadius: 1.4,
          arcAngle: Math.PI / 2,
          radialSegments: 32,
          arcSegments: 32,
        }),
      },
      {
        name: "HollowTruncatedCone",
        geom: new HollowTruncatedCone({
          outerRadiusBottom: 1.4,
          outerRadiusTop: 0.8,
          innerRadiusBottom: 1.0,
          innerRadiusTop: 0.5,
          height: 2.8,
          radialSegments: 32,
        }),
      },
      {
        name: "SphericalCap",
        geom: new SphericalCap({
          radius: 1.8,
          height: 1.1,
          radialSegments: 32,
          heightSegments: 16,
        }),
      },
      {
        name: "SphericalTriangleSector",
        geom: new SphericalTriangleSector({
          radius: 1.6,
          angle: Math.PI * 0.65,
          widthSegments: 32,
          heightSegments: 16,
        }),
      },
      {
        name: "Arch",
        geom: new Arch({ length: 3.2, height: 2.8, depth: 1.2, radius: 1.1, radialSegments: 32 }),
      },
      {
        name: "CylinderSector",
        geom: new Cylinder({
          radiusTop: 1.4,
          radiusBottom: 1.4,
          height: 2.8,
          radialSegments: 24,
          thetaStart: 0,
          thetaLength: Math.PI * 1.25,
        }),
      },
      {
        name: "Gear",
        geom: new Gear({ innerRadius: 0.9, toothHeight: 0.45, teeth: 10, thickness: 0.5 }),
      },

      // Row 4: Platonic Solids, Knots & Parametric Topologies (7 items)
      {
        name: "Extrude",
        geom: new ExtrudeGeometry({
          shape: [
            new Vector2D(-1.1, -0.35),
            new Vector2D(-0.35, -0.35),
            new Vector2D(-0.35, -1.1),
            new Vector2D(0.35, -1.1),
            new Vector2D(0.35, -0.35),
            new Vector2D(1.1, -0.35),
            new Vector2D(1.1, 0.35),
            new Vector2D(0.35, 0.35),
            new Vector2D(0.35, 1.1),
            new Vector2D(-0.35, 1.1),
            new Vector2D(-0.35, 0.35),
            new Vector2D(-1.1, 0.35),
          ],
          depth: 0.8,
        }),
      },
      {
        name: "Lathe",
        geom: new Lathe({
          segments: 32,
          profile: [
            new Vector3D(0.3, -1.4, 0),
            new Vector3D(0.85, -0.9, 0),
            new Vector3D(0.35, -0.15, 0),
            new Vector3D(0.45, 0.6, 0),
            new Vector3D(1.0, 1.3, 0),
            new Vector3D(1.05, 1.4, 0),
          ],
        }),
      },
      {
        name: "Tetrahedron",
        geom: new PlatonicSolid({ solid: "tetrahedron", radius: 1.5 }),
      },
      {
        name: "Dodecahedron",
        geom: new PlatonicSolid({ solid: "dodecahedron", radius: 1.5 }),
      },
      {
        name: "Icosahedron",
        geom: new PlatonicSolid({ solid: "icosahedron", radius: 1.5 }),
      },
      {
        name: "TorusKnot",
        geom: new TorusKnot({
          radius: 1.1,
          tube: 0.32,
          p: 2,
          q: 3,
          tubularSegments: 128,
          radialSegments: 16,
        }),
      },
      {
        name: "MobiusStrip",
        geom: new MobiusStrip({
          radius: 1.2,
          width: 0.65,
          twists: 1,
          segments: 96,
          widthSegments: 8,
        }),
      },

      // Row 5: Parametric, Implicit, Voronoi & Terrain (6 items)
      {
        name: "Supershape",
        geom: new Supershape({
          radius: 1.3,
          longitude: { m: 6, n1: 0.7, n2: 0.3, n3: 0.2 },
          latitude: { m: 6, n1: 0.7, n2: 0.3, n3: 0.2 },
        }),
      },
      {
        name: "ParametricSurface",
        geom: new ParametricSurface({
          uMin: -1.5,
          uMax: 1.5,
          vMin: -1.5,
          vMax: 1.5,
          uSegments: 36,
          vSegments: 36,
          surface: (u: number, v: number): Vector3D => {
            const x = u - u ** 3 / 3 + u * v ** 2;
            const y = (u ** 2 - v ** 2) * 0.8;
            const z = -v + v ** 3 / 3 - v * u ** 2;
            return new Vector3D(x * 0.6, y * 0.6, z * 0.6);
          },
        }),
      },
      {
        name: "MarchingCubes",
        geom: new MarchingCubes({
          resolution: 24,
          min: { x: -1.4, y: -1.4, z: -1.4 },
          max: { x: 1.4, y: 1.4, z: 1.4 },
          sample: metaballField([
            { x: -0.4, y: 0, z: 0, radius: 0.65, strength: 1 },
            { x: 0.4, y: 0.2, z: 0, radius: 0.55, strength: 1 },
            { x: 0, y: -0.4, z: 0.3, radius: 0.5, strength: 1 },
          ]),
        }),
      },
      {
        name: "VoronoiCells",
        geom: new VoronoiCells({
          pointCount: 16,
          bounds: { min: { x: -1.3, y: -1.3, z: -1.3 }, max: { x: 1.3, y: 1.3, z: 1.3 } },
          cellPadding: 0.86,
          seed: 17,
        }),
      },
      {
        name: "VoronoiShard",
        geom: shardGeom,
      },
      { name: "Terrain", geom: terrainGeom },

      // Row 6: 2D Polygonal & Profile Shapes (7 items)
      {
        name: "OpenFrame",
        geom: new OpenFrame({ width: 2.6, height: 2.6, thickness: 0.5, depth: 0 }),
        dimension: "2d",
      },
      {
        name: "LShape",
        geom: new LShape({ width: 2.6, height: 2.6, thickness: 0.6, depth: 0 }),
        dimension: "2d",
      },
      {
        name: "Rhombus",
        geom: new Rhombus({ side: 2.2, angle: Math.PI / 3, depth: 0 }),
        dimension: "2d",
      },
      {
        name: "TriStar",
        geom: new TriStar({ armLength: 1.8, innerAngle: Math.PI / 6, depth: 0 }),
        dimension: "2d",
      },
      {
        name: "FilledPolygon",
        geom: new FilledPolygon({ outer: squareOuterRing, holes: [circularHoleRing] }),
        dimension: "2d",
      },
      {
        name: "Annulus",
        geom: new Annulus({
          innerRadius: 0.7,
          outerRadius: 1.5,
          thetaSegments: 32,
          phiSegments: 4,
        }),
        dimension: "2d",
      },
      { name: "Disk", geom: new Disk({ radius: 1.4, segments: 32, rings: 3 }), dimension: "2d" },

      // Row 7: 2D Planar Surfaces & 1D Lines/Paths (7 items)
      { name: "Circle", geom: new Circle({ radius: 1.4, segments: 32 }), dimension: "2d" },
      { name: "Plane", geom: new Plane({ width: 2.8, height: 2.8 }), dimension: "2d" },
      { name: "Ground", geom: new Ground({ width: 2.8, depth: 2.8 }), dimension: "2d" },
      {
        name: "Triangle",
        geom: new Triangle(
          new Vector3D(-1.4, 0, 0),
          new Vector3D(1.4, 0, 0),
          new Vector3D(0, 0, -2.4),
        ),
        dimension: "2d",
      },
      { name: "PolygonFan", geom: new PolygonFan({ points: starFanPts }), dimension: "1d" },
      {
        name: "Polyline",
        geom: new Polyline({ points: helixPts, closed: false }),
        dimension: "1d",
      },
      {
        name: "Line",
        geom: new Line(new Vector3D(-1.4, 0, 0), new Vector3D(1.4, 0, 0)),
        dimension: "1d",
      },
    ];

    const spacingX: number = 11.5;
    const spacingZ: number = 12.0;
    const itemsPerRow: number = 7;
    const startX: number = -((itemsPerRow - 1) * spacingX) / 2;

    for (let i = 0; i < geometries.length; i++) {
      const row = Math.floor(i / itemsPerRow);
      const col = i % itemsPerRow;

      const x = startX + col * spacingX;
      const z = -30 + row * spacingZ;

      addGeometryItem(
        geometries[i]!.name,
        geometries[i]!.geom,
        x,
        z,
        geometries[i]!.dimension ?? "3d",
      );
    }

    // IMPORTANT: Update all world matrices BEFORE computing bounds
    // and building the octree, otherwise bounds will be at (0,0,0).
    this.scene.update();

    // Now compute bounds for all static objects
    for (const obj of this.scene.objects) {
      if (obj.isStatic) obj.computeBounds();
    }

    this.scene.updateStaticOctree();
    console.log("Showcase 6: Scene ready.");
  }

  protected override update(): void {}
}

const app = new Showcase6();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase6] Failed to start:", err));
