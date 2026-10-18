import type {
  BloomElement,
  EngineOptions,
  GrainElement,
  HbaoElement,
  VignetteElement,
} from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  Color,
  Cube,
  Cylinder,
  DirectionalLight,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Object3D,
  Octahedron,
  OpenWaterMaterial,
  OrbitController,
  Plane,
  PointLight,
  PostProcessingEffectType,
  RendererType,
  Sphere,
  StandardMaterial,
  Torus,
  Vector3D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

const PLATFORM_HALF_WIDTH = 3.2;
const PLATFORM_LENGTH = 34;
const TRENCH_OFFSET = 5.6;
const TRENCH_HALF_WIDTH = 1.3;
const WALL_OFFSET = 8.2;
const CEILING_HEIGHT = 6.4;
const BREACH_HALF_Z = 3.2;
const PILLAR_SPACING = 4;

/**
 * Showcase 31: "Overgrown Subway: Karlsplatz Junction Ruin"
 *
 * The "The Whisper" world's U-Bahn-Knoten Karlsplatz, decades after the collapse: a Jugendstil
 * island-platform hall with a jagged ceiling breach pouring cascaded sunlight and roots down
 * onto a flooded, wrecked platform. Exercises CSM against a mostly-enclosed vault, HBAO in the
 * tiled crevices, bloom on the light shaft/emissive moss/emergency lamps, `OpenWaterMaterial`
 * on the flooded trenches, and instanced foliage/debris.
 */
class Showcase31 extends AbstractShowcase {
  private _sunLight!: DirectionalLight;
  private _emergencyLights: PointLight[] = [];
  private _vineRoots: Object3D[] = [];
  private _waterMaterials: OpenWaterMaterial[] = [];
  private _dustMesh?: InstancedMesh;
  private _dustPhases: number[] = [];
  private _dustBaseY: number[] = [];
  private _time = 0;

  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      ...options,
    });
  }

  protected override async setupScene(): Promise<void> {
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 0.9;
      bloom.threshold = 0.9;
    }
    const hbao = this.renderer.postProcessing.get<HbaoElement>(PostProcessingEffectType.HBAO);
    if (hbao) {
      hbao.enabled = true;
      hbao.radius = 0.9;
      hbao.intensity = 1.4;
    }
    const vignette = this.renderer.postProcessing.get<VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    if (vignette) {
      vignette.enabled = true;
      vignette.darkness = 0.75;
      vignette.offset = 0.55;
    }
    const grain = this.renderer.postProcessing.get<GrainElement>(PostProcessingEffectType.GRAIN);
    if (grain) {
      grain.enabled = true;
      grain.intensity = 0.045;
    }

    this.defaultFov = (55 * Math.PI) / 180;
    this.defaultFar = 150;
    this.configureCamera();
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    this.camera.position.set(0.5, 3.4, 13.5);
    this.camera.target.set(0, 1.8, -1.5);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    // Dank, cool underground ambient fill -- there is no sky here, only whatever the breach lets in.
    this.scene.add(new AmbientLight({ color: new Color(0.07, 0.09, 0.08), intensity: 0.55 }));

    // The sun shaft: a steep, narrow beam finding its way straight down through the breach.
    this._sunLight = new DirectionalLight({
      color: new Color(1.0, 0.97, 0.85),
      intensity: 2.6,
    });
    this._sunLight.position.set(1.5, 20, 0);
    this._sunLight.direction.set(-0.08, -1.0, 0.02);
    this._sunLight.castShadow = true;
    this._sunLight.shadowBias = 0.0011;
    this._sunLight.shadowResolution = 2048;
    this.scene.add(this._sunLight);

    this._buildMaterialsAndStructure();
    this._buildTrenchesAndWater();
    this._buildRocksAndRubble();
    this._buildBreachAndVines();
    this._buildTrainWreck();
    this._buildEmergencyLights();
    this._buildFoliageInstances();
    this._buildDustMotes();
  }

  private _buildMaterialsAndStructure(): void {
    const tileMat = new StandardMaterial({
      color: new Color(0.18, 0.32, 0.24),
      roughness: 0.55,
      metallic: 0.02,
    });
    const tileTrimMat = new StandardMaterial({
      color: new Color(0.55, 0.44, 0.22),
      roughness: 0.35,
      metallic: 0.75,
    });
    const concreteMat = new StandardMaterial({
      color: new Color(0.42, 0.41, 0.38),
      roughness: 0.92,
      metallic: 0.0,
    });
    this._concreteMat = concreteMat;

    // Central island platform.
    const platform = new Object3D("Platform");
    platform.geometry = new Cube({ size: 1 }).getGeometryData();
    platform.scale.set(PLATFORM_HALF_WIDTH * 2, 0.5, PLATFORM_LENGTH);
    platform.position.set(0, -0.25, 0);
    platform.material = concreteMat;
    platform.receiveShadow = true;
    this.scene.add(platform);

    // Outer tiled walls.
    for (const side of [-1, 1]) {
      const wall = new Object3D(`OuterWall_${side}`);
      wall.geometry = new Cube({ size: 1 }).getGeometryData();
      wall.scale.set(0.6, CEILING_HEIGHT, PLATFORM_LENGTH);
      wall.position.set(side * WALL_OFFSET, CEILING_HEIGHT / 2, 0);
      wall.material = tileMat;
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);

      // Gold trim band at eye level, a Jugendstil signature.
      const trim = new Object3D(`WallTrim_${side}`);
      trim.geometry = new Cube({ size: 1 }).getGeometryData();
      trim.scale.set(0.64, 0.35, PLATFORM_LENGTH);
      trim.position.set(side * WALL_OFFSET, 2.4, 0);
      trim.material = tileTrimMat;
      this.scene.add(trim);
    }

    // Two colonnades of vaulted-ceiling pillars, one along each trench-facing platform edge.
    const numPillars = Math.floor(PLATFORM_LENGTH / PILLAR_SPACING);
    for (const side of [-1, 1]) {
      const pillarX = side * (PLATFORM_HALF_WIDTH + 0.5);
      for (let i = 0; i < numPillars; i++) {
        const z = (i - (numPillars - 1) / 2) * PILLAR_SPACING;
        const inBreach = Math.abs(z) < BREACH_HALF_Z + 1.5;

        const pillar = new Object3D(`Pillar_${side}_${i}`);
        pillar.geometry = new Cylinder({
          radiusTop: 0.34,
          radiusBottom: 0.42,
          height: CEILING_HEIGHT,
          radialSegments: 16,
        }).getGeometryData();
        pillar.position.set(pillarX, CEILING_HEIGHT / 2, z);
        pillar.material = inBreach ? concreteMat : tileMat;
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        this.scene.add(pillar);

        const capital = new Object3D(`Capital_${side}_${i}`);
        capital.geometry = new Torus({
          radius: 0.5,
          tube: 0.14,
          radialSegments: 12,
          tubularSegments: 20,
        }).getGeometryData();
        capital.rotation.x = MathUtils.HALF_PI;
        capital.position.set(pillarX, CEILING_HEIGHT - 0.3, z);
        capital.material = tileTrimMat;
        capital.castShadow = true;
        this.scene.add(capital);

        // Ceiling vault segment above this bay -- skipped inside the breach gap.
        if (!inBreach) {
          const vault = new Object3D(`Vault_${side}_${i}`);
          vault.geometry = new Cube({ size: 1 }).getGeometryData();
          vault.scale.set(PLATFORM_HALF_WIDTH + 0.5, 0.5, PILLAR_SPACING - 0.2);
          vault.position.set(side * (PLATFORM_HALF_WIDTH + 0.5) * 0.5, CEILING_HEIGHT + 0.25, z);
          vault.material = concreteMat;
          vault.castShadow = true;
          vault.receiveShadow = true;
          this.scene.add(vault);
        }
      }
    }

    // Jagged broken lip chunks ringing the breach, tilted at odd angles like torn concrete.
    const lipPositions: Array<[number, number, number]> = [
      [-2.6, CEILING_HEIGHT - 0.1, -BREACH_HALF_Z + 0.3],
      [2.4, CEILING_HEIGHT + 0.2, -BREACH_HALF_Z - 0.1],
      [-1.8, CEILING_HEIGHT - 0.3, BREACH_HALF_Z - 0.2],
      [2.1, CEILING_HEIGHT + 0.1, BREACH_HALF_Z + 0.4],
      [0.2, CEILING_HEIGHT + 0.5, -BREACH_HALF_Z + 1.1],
    ];
    for (let i = 0; i < lipPositions.length; i++) {
      const [x, y, z] = lipPositions[i]!;
      const chunk = new Object3D(`LipChunk_${i}`);
      chunk.geometry = new Cube({ size: 1 }).getGeometryData();
      chunk.scale.set(1.4 + (i % 2) * 0.6, 0.4, 1.1);
      chunk.position.set(x, y, z);
      chunk.rotation.set(
        (Math.sin(i * 3.1) * MathUtils.HALF_PI) / 3,
        Math.cos(i * 1.7) * 0.5,
        (Math.sin(i * 2.3) * MathUtils.HALF_PI) / 4,
      );
      chunk.material = concreteMat;
      chunk.castShadow = true;
      chunk.receiveShadow = true;
      this.scene.add(chunk);
    }
  }

  private _concreteMat!: StandardMaterial;

  private _buildTrenchesAndWater(): void {
    const rustMat = new StandardMaterial({
      color: new Color(0.32, 0.16, 0.08),
      roughness: 0.75,
      metallic: 0.55,
    });
    this._rustMat = rustMat;

    for (const side of [-1, 1]) {
      const centerX = side * TRENCH_OFFSET;

      const trenchFloor = new Object3D(`TrenchFloor_${side}`);
      trenchFloor.geometry = new Cube({ size: 1 }).getGeometryData();
      trenchFloor.scale.set(TRENCH_HALF_WIDTH * 2, 0.3, PLATFORM_LENGTH);
      trenchFloor.position.set(centerX, -1.15, 0);
      trenchFloor.material = this._concreteMat;
      trenchFloor.receiveShadow = true;
      this.scene.add(trenchFloor);

      // Rusted rails, half-submerged.
      for (const railOffset of [-0.75, 0.75]) {
        const rail = new Object3D(`Rail_${side}_${railOffset}`);
        rail.geometry = new Cube({ size: 1 }).getGeometryData();
        rail.scale.set(0.08, 0.12, PLATFORM_LENGTH);
        rail.position.set(centerX + railOffset, -0.55, 0);
        rail.material = rustMat;
        this.scene.add(rail);
      }

      const water = new OpenWaterMaterial({
        waterColor: new Color(0.05, 0.14, 0.1),
        deepWaterColor: new Color(0.01, 0.04, 0.03),
        edgeColor: new Color(0.3, 0.4, 0.32),
        edgeSoftness: 0.6,
        speed: 0.3,
        wave1: [0.6, 0.3, 0.04, 8.0],
        wave2: [0.15, 0.5, 0.06, 4.0],
        wave3: [-0.2, 0.4, 0.03, 2.5],
      });
      this._waterMaterials.push(water);

      const waterObj = new Object3D(`TrenchWater_${side}`);
      const plane = new Plane({
        width: TRENCH_HALF_WIDTH * 2 - 0.1,
        height: PLATFORM_LENGTH - 1,
        widthSegments: 16,
        heightSegments: 64,
      });
      plane.computeTangents();
      waterObj.geometry = plane.getGeometryData();
      waterObj.material = water;
      waterObj.rotation.x = -MathUtils.HALF_PI;
      waterObj.position.set(centerX, -0.75, 0);
      this.scene.add(waterObj);

      // Retaining lip between platform and trench.
      const lip = new Object3D(`TrenchLip_${side}`);
      lip.geometry = new Cube({ size: 1 }).getGeometryData();
      lip.scale.set(0.3, 1.0, PLATFORM_LENGTH);
      lip.position.set(side * (TRENCH_OFFSET - TRENCH_HALF_WIDTH - 0.15), -0.5, 0);
      lip.material = this._concreteMat;
      lip.receiveShadow = true;
      this.scene.add(lip);
    }
  }

  private _rustMat!: StandardMaterial;

  private _buildRocksAndRubble(): void {
    // Weathered rocks poking through the trench water -- gives OpenWaterMaterial's refraction/
    // foam something to actually intersect, instead of an untouched open surface.
    const rockMat = new StandardMaterial({
      color: new Color(0.24, 0.24, 0.22),
      roughness: 0.9,
      metallic: 0.0,
    });
    const rockCount = 5;
    const rockMesh = new InstancedMesh(
      "TrenchRocks",
      new Octahedron({ radius: 1 }).getGeometryData(),
      rockMat,
      rockCount * 2,
    );
    const pos = new Vector3D();
    const rot = new Vector3D();
    const scale = new Vector3D();
    const m = new Matrix4();
    let idx = 0;
    for (const side of [-1, 1]) {
      const centerX = side * TRENCH_OFFSET;
      for (let i = 0; i < rockCount; i++) {
        const x = centerX + (Math.random() - 0.5) * (TRENCH_HALF_WIDTH * 1.6);
        const z = -PLATFORM_LENGTH / 2 + 4 + Math.random() * (PLATFORM_LENGTH - 10);
        const s = 0.3 + Math.random() * 0.4;
        // Water surface sits at y=-0.75 -- straddle it so part pokes above, part stays submerged.
        const y = -0.75 + s * (0.1 + Math.random() * 0.35);
        pos.set(x, y, z);
        rot.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        scale.set(s, s * (0.6 + Math.random() * 0.5), s * (0.8 + Math.random() * 0.4));
        m.compose(pos, rot, scale);
        rockMesh.setMatrixAt(idx, m);
        idx++;
      }
    }
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    this.scene.add(rockMesh);

    // A rubble "beach": debris spilling from the platform edge down into one trench, breaching
    // the water in a mound instead of a clean cut -- like scree sliding into a flooded pit.
    const rubbleMat = this._concreteMat;
    const rubbleCount = 20;
    const rubbleMesh = new InstancedMesh(
      "RubbleBeach",
      new Cube({ size: 1 }).getGeometryData(),
      rubbleMat,
      rubbleCount,
    );
    const beachCenterX = TRENCH_OFFSET;
    const beachZ = -PLATFORM_LENGTH / 2 + 2.5;
    for (let i = 0; i < rubbleCount; i++) {
      const x = beachCenterX + (Math.random() - 0.5) * (TRENCH_HALF_WIDTH * 2 + 1.4);
      const z = beachZ + (Math.random() - 0.5) * 3.5;
      const s = 0.2 + Math.random() * 0.35;
      // Random height band straddling the waterline (-0.75) up onto the platform (0) -- a loose
      // talus pile, some chunks dry, some half-sunk, without modeling a precise per-piece slope.
      const y = -0.95 + Math.random() * 1.1;
      pos.set(x, y, z);
      rot.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      scale.set(s, s * (0.6 + Math.random() * 0.6), s);
      m.compose(pos, rot, scale);
      rubbleMesh.setMatrixAt(i, m);
    }
    rubbleMesh.castShadow = true;
    rubbleMesh.receiveShadow = true;
    this.scene.add(rubbleMesh);
  }

  private _buildBreachAndVines(): void {
    const vineMat = new StandardMaterial({
      color: new Color(0.16, 0.24, 0.1),
      roughness: 0.85,
      metallic: 0.0,
    });

    const godRayMat = new StandardMaterial({
      color: new Color(1.0, 0.97, 0.86, 0.16),
      emissiveColor: new Color(0.55, 0.5, 0.35),
      emissiveIntensity: 0.9,
      transparent: true,
      roughness: 0.15,
    });
    const godRay = new Object3D("GodRayShaft");
    godRay.geometry = new Cylinder({
      radiusTop: 0.22,
      radiusBottom: 1.7,
      height: CEILING_HEIGHT + 1.5,
      radialSegments: 16,
    }).getGeometryData();
    godRay.material = godRayMat;
    godRay.position.set(0.6, CEILING_HEIGHT / 2 + 0.5, -0.5);
    this._godRay = godRay;
    this.scene.add(godRay);

    // A dozen hanging vines/roots dangling through the breach, each a short chain of tapered
    // segments so they read as organically drooping rather than perfectly straight.
    const vineAttachPoints: Array<[number, number]> = [
      [-2.0, -2.4],
      [1.4, -2.9],
      [-0.6, -1.0],
      [2.6, -0.3],
      [-2.8, 0.6],
      [0.4, 1.4],
      [-1.4, 2.2],
      [2.2, 2.6],
      [-0.2, -3.0],
      [1.8, 1.0],
    ];
    for (let v = 0; v < vineAttachPoints.length; v++) {
      const [x, z] = vineAttachPoints[v]!;
      const root = new Object3D(`VineRoot_${v}`);
      root.position.set(x, CEILING_HEIGHT + 0.3, z);
      this.scene.add(root);
      this._vineRoots.push(root);

      const segments = 4 + (v % 3);
      let parent: Object3D = root;
      for (let s = 0; s < segments; s++) {
        const t = s / segments;
        const segLength = 0.7 - t * 0.25;
        const radius = 0.09 * (1 - t * 0.55);
        const seg = new Object3D(`VineSeg_${v}_${s}`);
        seg.geometry = new Cylinder({
          radiusTop: Math.max(0.015, radius * 0.75),
          radiusBottom: Math.max(0.02, radius),
          height: segLength,
          radialSegments: 6,
        }).getGeometryData();
        seg.material = vineMat;
        // Alternate bend so the chain snakes rather than curling in one direction only.
        seg.rotation.z = Math.sin(v * 5.2 + s * 1.9) * 0.35;
        seg.rotation.x = Math.cos(v * 3.7 + s * 2.3) * 0.25;
        seg.position.y = s === 0 ? -segLength / 2 : -segLength;
        parent.add(seg);
        parent = seg;
      }

      // A small leaf cluster at the tip.
      const tip = new Object3D(`VineTip_${v}`);
      tip.geometry = new Octahedron({ radius: 0.14 }).getGeometryData();
      tip.material = vineMat;
      tip.position.y = -0.15;
      parent.add(tip);
    }
  }

  private _godRay!: Object3D;

  private _buildTrainWreck(): void {
    const bodyMat = new StandardMaterial({
      color: new Color(0.5, 0.14, 0.12),
      roughness: 0.7,
      metallic: 0.2,
    });
    const wheelMat = this._rustMat;
    const glassMat = new StandardMaterial({
      color: new Color(0.6, 0.75, 0.7),
      emissiveColor: new Color(1.4, 0.9, 0.4),
      emissiveIntensity: 1.2,
      roughness: 0.25,
      transparent: true,
    });

    const wreck = new Object3D("TrainWreck");
    wreck.position.set(TRENCH_OFFSET, -0.55, -8);
    wreck.rotation.z = 0.22;
    wreck.rotation.y = 0.08;
    this.scene.add(wreck);

    const body = new Object3D("WreckBody");
    body.geometry = new Cube({ size: 1 }).getGeometryData();
    body.scale.set(2.0, 1.9, 9.0);
    body.material = bodyMat;
    body.castShadow = true;
    body.receiveShadow = true;
    wreck.add(body);

    const roof = new Object3D("WreckRoof");
    roof.geometry = new Cylinder({
      radiusTop: 1.0,
      radiusBottom: 1.0,
      height: 9.0,
      radialSegments: 12,
      thetaStart: 0,
      thetaLength: Math.PI,
    }).getGeometryData();
    roof.rotation.z = MathUtils.HALF_PI;
    roof.rotation.y = MathUtils.HALF_PI;
    roof.position.set(0, 0.95, 0);
    roof.material = bodyMat;
    roof.castShadow = true;
    wreck.add(roof);

    const headlight = new Object3D("WreckHeadlight");
    headlight.geometry = new Octahedron({ radius: 0.22 }).getGeometryData();
    headlight.material = glassMat;
    headlight.position.set(0, 0.4, 4.6);
    wreck.add(headlight);

    for (const wOffset of [-4.0, 4.0]) {
      for (const side of [-0.85, 0.85]) {
        const wheel = new Object3D(`WreckWheel_${wOffset}_${side}`);
        wheel.geometry = new Cylinder({
          radiusTop: 0.5,
          radiusBottom: 0.5,
          height: 0.25,
          radialSegments: 16,
        }).getGeometryData();
        wheel.rotation.z = MathUtils.HALF_PI;
        wheel.position.set(side, -1.15, wOffset);
        wheel.material = wheelMat;
        wheel.castShadow = true;
        wreck.add(wheel);
      }
    }
  }

  private _buildEmergencyLights(): void {
    const lampMat = new StandardMaterial({
      color: new Color(0.7, 0.35, 0.1),
      emissiveColor: new Color(2.8, 1.1, 0.15),
      emissiveIntensity: 3.5,
      roughness: 0.2,
    });
    const deepLampMat = new StandardMaterial({
      color: new Color(0.15, 0.4, 0.45),
      emissiveColor: new Color(0.3, 1.4, 1.6),
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });

    const fixtures: Array<[number, number, number, StandardMaterial, Color, number]> = [
      [PLATFORM_HALF_WIDTH + 0.9, 3.0, -13, lampMat, new Color(1.0, 0.5, 0.15), 8.0],
      [-(PLATFORM_HALF_WIDTH + 0.9), 3.2, 13, lampMat, new Color(1.0, 0.55, 0.18), 8.0],
      [0, 2.4, -15.5, deepLampMat, new Color(0.25, 0.75, 0.85), 7.0],
    ];

    for (let i = 0; i < fixtures.length; i++) {
      const [x, y, z, mat, color, distance] = fixtures[i]!;
      const fixture = new Object3D(`EmergencyFixture_${i}`);
      fixture.geometry = new Cylinder({
        radiusTop: 0.16,
        radiusBottom: 0.2,
        height: 0.3,
        radialSegments: 10,
      }).getGeometryData();
      fixture.position.set(x, y, z);
      fixture.material = mat;
      this.scene.add(fixture);

      const light = new PointLight({ color, intensity: 2.6, distance });
      light.position.set(x, y, z);
      this.scene.add(light);
      this._emergencyLights.push(light);
    }
  }

  private _buildFoliageInstances(): void {
    const mossMat = new StandardMaterial({
      color: new Color(0.14, 0.28, 0.13),
      roughness: 0.95,
      metallic: 0.0,
    });

    const mossPositions: Array<[number, number, number, number]> = [];
    // Moss creeping along the platform edges nearest the breach.
    for (let z = -6; z <= 6; z += 0.8) {
      for (const side of [-1, 1]) {
        if (Math.random() > 0.55) continue;
        const x = side * (PLATFORM_HALF_WIDTH - 0.2 - Math.random() * 0.6);
        mossPositions.push([x, 0.05, z + (Math.random() - 0.5) * 0.4, 0.12 + Math.random() * 0.18]);
      }
    }
    // Moss climbing the nearby pillar bases.
    for (const side of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        const z = i * 3.5;
        const px = side * (PLATFORM_HALF_WIDTH + 0.5);
        for (let k = 0; k < 4; k++) {
          mossPositions.push([
            px + (Math.random() - 0.5) * 0.5,
            0.1 + k * 0.35 + Math.random() * 0.15,
            z + (Math.random() - 0.5) * 0.5,
            0.1 + Math.random() * 0.14,
          ]);
        }
      }
    }

    const mossMesh = new InstancedMesh(
      "MossClusters",
      new Sphere({ radius: 1, widthSegments: 6, heightSegments: 5 }).getGeometryData(),
      mossMat,
      mossPositions.length,
    );
    const pos = new Vector3D();
    const rot = new Vector3D();
    const scale = new Vector3D();
    const m = new Matrix4();
    for (let i = 0; i < mossPositions.length; i++) {
      const [x, y, z, s] = mossPositions[i]!;
      pos.set(x, y, z);
      rot.set(0, Math.random() * Math.PI * 2, 0);
      scale.set(s, s * 0.6, s);
      m.compose(pos, rot, scale);
      mossMesh.setMatrixAt(i, m);
    }
    mossMesh.receiveShadow = true;
    this.scene.add(mossMesh);

    // Small fallen debris chunks scattered near the breach.
    const debrisMat = this._concreteMat;
    const debrisCount = 14;
    const debrisMesh = new InstancedMesh(
      "BreachDebris",
      new Cube({ size: 1 }).getGeometryData(),
      debrisMat,
      debrisCount,
    );
    for (let i = 0; i < debrisCount; i++) {
      const x = (Math.random() - 0.5) * 5.0;
      const z = (Math.random() - 0.5) * (BREACH_HALF_Z * 2 + 2);
      const s = 0.15 + Math.random() * 0.35;
      pos.set(x, s * 0.5, z);
      rot.set(Math.random(), Math.random() * Math.PI, Math.random());
      scale.set(s, s * 0.7, s);
      m.compose(pos, rot, scale);
      debrisMesh.setMatrixAt(i, m);
    }
    debrisMesh.castShadow = true;
    debrisMesh.receiveShadow = true;
    this.scene.add(debrisMesh);
  }

  private _buildDustMotes(): void {
    const dustMat = new StandardMaterial({
      color: new Color(1.0, 0.95, 0.8),
      emissiveColor: new Color(1.2, 1.1, 0.85),
      emissiveIntensity: 1.4,
      transparent: true,
      roughness: 0.4,
    });
    const count = 60;
    this._dustMesh = new InstancedMesh(
      "DustMotes",
      new Sphere({ radius: 1, widthSegments: 4, heightSegments: 3 }).getGeometryData(),
      dustMat,
      count,
    );
    const m = new Matrix4();
    const pos = new Vector3D();
    const rot = new Vector3D(0, 0, 0);
    const scale = new Vector3D();
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 3.2 + 0.6;
      const z = (Math.random() - 0.5) * (BREACH_HALF_Z * 2 - 0.5) - 0.5;
      const y = Math.random() * CEILING_HEIGHT;
      const s = 0.015 + Math.random() * 0.02;
      this._dustBaseY.push(y);
      this._dustPhases.push(Math.random() * Math.PI * 2);
      pos.set(x, y, z);
      scale.set(s, s, s);
      m.compose(pos, rot, scale);
      this._dustMesh.setMatrixAt(i, m);
    }
    this.scene.add(this._dustMesh);
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime;

    for (const water of this._waterMaterials) {
      water.time += deltaTime;
    }

    // Gentle wind sway on the hanging vines/roots.
    for (let i = 0; i < this._vineRoots.length; i++) {
      const root = this._vineRoots[i];
      if (!root) continue;
      root.rotation.z = Math.sin(this._time * 0.7 + i * 1.3) * 0.06;
      root.rotation.x = Math.cos(this._time * 0.55 + i * 0.9) * 0.05;
    }

    // Turbulent breathing on the god-ray shaft, matching the sun's flicker through leaves.
    if (this._godRay) {
      const flicker =
        0.88 + Math.sin(this._time * 1.7) * 0.1 + Math.cos(this._time * 3.4 + 1.1) * 0.05;
      this._godRay.scale.set(flicker, 1.0, flicker);
    }

    // Failing emergency lighting: irregular flicker, not a clean sine.
    for (let i = 0; i < this._emergencyLights.length; i++) {
      const light = this._emergencyLights[i];
      if (!light) continue;
      const flicker =
        Math.sin(this._time * 9.0 + i * 4.0) * 0.3 + Math.sin(this._time * 23.0 + i * 7.0) * 0.15;
      light.intensity = 2.6 + flicker;
    }

    // Dust motes drift slowly upward through the shaft and wrap back down at the ceiling.
    if (this._dustMesh) {
      const m = new Matrix4();
      const pos = new Vector3D();
      const rot = new Vector3D(0, 0, 0);
      const scale = new Vector3D();
      for (let i = 0; i < this._dustMesh.instanceCount; i++) {
        const phase = this._dustPhases[i] ?? 0;
        const baseY = this._dustBaseY[i] ?? 0;
        const y = (baseY + this._time * 0.25) % CEILING_HEIGHT;
        const x = 0.6 + Math.sin(this._time * 0.4 + phase) * 1.6;
        const z = -0.5 + Math.cos(this._time * 0.3 + phase * 1.7) * 2.4;
        pos.set(x, y, z);
        scale.set(0.02, 0.02, 0.02);
        m.compose(pos, rot, scale);
        this._dustMesh.setMatrixAt(i, m);
      }
      this._dustMesh.instanceMatrixNeedsUpdate = true;
    }

    // Slow drift in the sun's angle, sweeping shadows across the flooded platform over time.
    if (this._sunLight) {
      const drift = this._time * 0.03;
      this._sunLight.direction.set(
        -0.08 + Math.sin(drift) * 0.05,
        -1.0,
        0.02 + Math.cos(drift) * 0.05,
      );
    }
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase31();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase31] Failed to start:", err));
