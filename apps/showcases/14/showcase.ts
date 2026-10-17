import type {
  BloomElement,
  GrainElement,
  OutlineElement,
  QuantizeElement,
  Scene,
  ToneMappingElement,
  VignetteElement,
} from "@small-world-machine/engine";
import {
  AbstractLight,
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  Color,
  Cube,
  Cylinder,
  FrostglassMaterial,
  GlassMaterial,
  Object3D,
  PerspectiveProjection,
  PointLight,
  PostProcessingEffectType,
  ProjectionType,
  RendererType,
  SpotLight,
  StandardMaterial,
  Texture,
  ToneMappingMode,
  Torus,
} from "@small-world-machine/engine";

// ============================================================================
// 1. Shared Simulation State
// ============================================================================

class SharedState {
  public static sweepActive: boolean = true;
  public static sweepSpeed: number = 1.0;
  public static cameraAngle: "high" | "desk" | "door" = "high";
  public static lightMode: "swing" | "flicker" = "swing";
  public static sirensActive: boolean = true;
  public static paperTexture?: Texture;
  public static floorTexture?: Texture;
  public static wallTexture?: Texture;
}

// ============================================================================
// 2. Procedural Texture Generators
// ============================================================================

async function createPaperTexture(): Promise<Texture> {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 724; // A4 ratio (1 : 1.414)
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("[showcase14] Failed to get canvas 2D context");
  }

  // Paper background
  ctx.fillStyle = "#faf8f5";
  ctx.fillRect(0, 0, 512, 724);

  // Subtle border
  ctx.strokeStyle = "#e8e5e0";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 508, 720);

  // Header / Title
  ctx.fillStyle = "#111111";
  ctx.font = "bold 24px Courier New, monospace";
  ctx.fillText("POLICE DEPT - CASE FILE", 40, 50);

  ctx.strokeStyle = "#222222";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(40, 65);
  ctx.lineTo(472, 65);
  ctx.stroke();

  // Unrecognizable Picture 1: Suspect portrait (top right)
  ctx.fillStyle = "#dddddd";
  ctx.fillRect(320, 90, 150, 180);
  ctx.strokeStyle = "#444444";
  ctx.lineWidth = 2;
  ctx.strokeRect(320, 90, 150, 180);

  // Draw silhouette
  ctx.fillStyle = "#444444";
  ctx.beginPath();
  ctx.arc(395, 160, 32, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(395, 230, 52, 38, 0, 0, Math.PI * 2);
  ctx.fill();

  // Case metadata text
  ctx.fillStyle = "#111111";
  ctx.font = "bold 14px Courier New, monospace";
  ctx.fillText("SUBJECT: REDACTED", 40, 105);
  ctx.fillText("CASE ID: #8892-X", 40, 130);
  ctx.fillText("STATUS:  CONFIDENTIAL", 40, 155);

  // Redaction bars
  ctx.fillStyle = "#000000";
  ctx.fillRect(40, 180, 240, 15);
  ctx.fillRect(40, 205, 180, 15);

  // Rows of horizontal text lines
  ctx.fillStyle = "#666666";
  let y = 295;
  while (y < 480) {
    const width = 180 + Math.random() * 250;
    ctx.fillRect(40, y, width, 8);
    y += 20;
  }

  // Unrecognizable Picture 2: Fingerprint / Evidence (bottom left)
  ctx.fillStyle = "#eeeeee";
  ctx.fillRect(40, 510, 180, 160);
  ctx.strokeStyle = "#666666";
  ctx.strokeRect(40, 510, 180, 160);

  // Fingerprint swirls
  ctx.strokeStyle = "#222222";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let r = 20; r < 70; r += 10) {
    ctx.arc(130, 590, r, 0, Math.PI * 2);
  }
  ctx.stroke();

  // Bottom text details
  ctx.fillStyle = "#222222";
  ctx.font = "bold 14px Courier New, monospace";
  ctx.fillText("EVIDENCE EXHIBIT A", 240, 530);

  ctx.fillStyle = "#777777";
  ctx.fillRect(240, 550, 230, 7);
  ctx.fillRect(240, 565, 210, 7);
  ctx.fillRect(240, 580, 230, 7);
  ctx.fillRect(240, 595, 170, 7);

  // REDACTED stamp
  ctx.strokeStyle = "rgba(200, 30, 30, 0.75)";
  ctx.lineWidth = 4;
  ctx.strokeRect(260, 615, 190, 45);
  ctx.fillStyle = "rgba(200, 30, 30, 0.75)";
  ctx.font = "bold 26px Courier New, monospace";
  ctx.fillText("REDACTED", 285, 647);

  const bitmap = await createImageBitmap(canvas);
  return Texture.fromImage(bitmap);
}

async function createFloorTexture(): Promise<Texture> {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("[showcase14] Failed to get canvas 2D context");
  }

  // Dark stone gray color (changed from #60646c to #202226 for dramatic shadows)
  ctx.fillStyle = "#1e2024";
  ctx.fillRect(0, 0, 512, 512);

  // Noise / stone details
  for (let i = 0; i < 15000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const size = 1 + Math.random() * 2;
    const val = Math.random();
    ctx.fillStyle = val > 0.5 ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.08)";
    ctx.fillRect(x, y, size, size);
  }

  // Draw tile grid joints (darker lines)
  ctx.strokeStyle = "#0c0d0f";
  ctx.lineWidth = 5;
  const tileSize = 64; // 8x8 tiles grid
  for (let x = 0; x <= 512; x += tileSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }
  for (let y = 0; y <= 512; y += tileSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }

  const bitmap = await createImageBitmap(canvas);
  return Texture.fromImage(bitmap);
}

async function createWallTexture(): Promise<Texture> {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("[showcase14] Failed to get canvas 2D context");
  }

  // Dark concrete gray (changed from dirty white #dfdad2 to dark grunge #43454b)
  ctx.fillStyle = "#4a4c52";
  ctx.fillRect(0, 0, 512, 512);

  // Grungy stains (humidity, dust, etc. - darker color overlay)
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const radius = 25 + Math.random() * 95;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, "rgba(25, 20, 15, 0.25)");
    grad.addColorStop(1, "rgba(25, 20, 15, 0.0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Scratches and scuff marks (from chairs moving or suspect struggles)
  ctx.lineWidth = 2;
  for (let i = 0; i < 30; i++) {
    const x1 = Math.random() * 512;
    const y1 = Math.random() * 512;
    const length = 8 + Math.random() * 35;
    const angle = Math.random() * Math.PI * 2;
    const x2 = x1 + Math.cos(angle) * length;
    const y2 = y1 + Math.sin(angle) * length;
    ctx.strokeStyle = `rgba(15, 12, 10, ${0.2 + Math.random() * 0.35})`;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Impact points (cups thrown, bodies slammed against walls)
  for (let i = 0; i < 6; i++) {
    const cx = 80 + Math.random() * 352;
    const cy = 80 + Math.random() * 352;

    // Splatter rays
    ctx.strokeStyle = "rgba(35, 25, 20, 0.6)";
    ctx.lineWidth = 1.8;
    const raysCount = 8 + Math.floor(Math.random() * 6);
    for (let j = 0; j < raysCount; j++) {
      const a = (j / raysCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const len = 12 + Math.random() * 30;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    }

    // Impact center point
    ctx.fillStyle = "rgba(35, 25, 20, 0.55)";
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  const bitmap = await createImageBitmap(canvas);
  return Texture.fromImage(bitmap);
}

// ============================================================================
// 3. Interrogation Room Scene Builder
// ============================================================================

interface SceneLights {
  lightBulb: Object3D;
  swingLight: SpotLight;
  redBlueLight: PointLight;
}

function buildInterrogationRoom(
  scene: Scene,
  paperTex: Texture,
  floorTex: Texture,
  wallTex: Texture,
): SceneLights {
  // Tile coordinates repeat on floor
  floorTex.repeat = { x: 3, y: 3 };

  // Materials
  const floorMat = new StandardMaterial({
    diffuseMap: floorTex,
    roughness: 0.6, // Slightly glossier for tile reflections
    metallic: 0.15,
  });

  const wallMat = new StandardMaterial({
    diffuseMap: wallTex,
    roughness: 0.95,
    metallic: 0.0,
  });

  const mirrorMat = new FrostglassMaterial({
    color: new Color(0.15, 0.2, 0.25),
    roughness: 0.1, // Semi-frosted one-way observation mirror
    metallic: 0.8,
    blurRadius: 0.02,
    transmission: 0.3,
  });

  const deskTopMat = new GlassMaterial({
    color: new Color(0.6, 0.85, 0.72, 0.35),
    roughness: 0.05, // Highly reflective glass top
    metallic: 0.2,
    ior: 1.55,
    thickness: 0.15,
    transmission: 0.85,
  });

  const steelMat = new StandardMaterial({
    color: new Color(0.65, 0.67, 0.7),
    roughness: 0.2,
    metallic: 0.95, // Shiny metal legs
  });

  const plasticMat = new StandardMaterial({
    color: new Color(0.1, 0.12, 0.15),
    roughness: 0.75,
    metallic: 0.05,
  });

  const emissiveMat = new StandardMaterial({
    color: new Color(1.0, 1.0, 1.0),
    emissiveColor: new Color(1.0, 0.95, 0.8),
    emissiveIntensity: 10.0, // High light emission for bloom
    roughness: 0.1,
    metallic: 0.0,
  });

  const paperMat = new StandardMaterial({
    diffuseMap: paperTex,
    roughness: 0.9,
    metallic: 0.0,
  });

  // Geometry
  const cubeGeo = new Cube({ size: 1.0 }).getGeometryData();

  // Floor (Half size: 8.0x8.0)
  const floor = new Object3D("floor");
  floor.geometry = cubeGeo;
  floor.material = floorMat;
  floor.scale.set(8.0, 0.1, 8.0);
  floor.position.set(0, -0.05, 0);
  scene.add(floor);

  // Ceiling (Half size)
  const ceiling = new Object3D("ceiling");
  ceiling.geometry = cubeGeo;
  ceiling.material = wallMat;
  ceiling.scale.set(8.0, 0.1, 8.0);
  ceiling.position.set(0, 5.05, 0);
  scene.add(ceiling);

  // Back Wall
  const backWall = new Object3D("backWall");
  backWall.geometry = cubeGeo;
  backWall.material = wallMat;
  backWall.scale.set(8.0, 5.0, 0.2);
  backWall.position.set(0, 2.5, -4.0);
  scene.add(backWall);

  // One-Way Mirror on Back Wall
  const mirror = new Object3D("mirror");
  mirror.geometry = cubeGeo;
  mirror.material = mirrorMat;
  mirror.scale.set(3.0, 1.8, 0.05);
  mirror.position.set(0, 2.2, -3.88);
  scene.add(mirror);

  // Left Wall
  const leftWall = new Object3D("leftWall");
  leftWall.geometry = cubeGeo;
  leftWall.material = wallMat;
  leftWall.scale.set(0.2, 5.0, 8.0);
  leftWall.position.set(-4.0, 2.5, 0);
  scene.add(leftWall);

  // Right Wall
  const rightWall = new Object3D("rightWall");
  rightWall.geometry = cubeGeo;
  rightWall.material = wallMat;
  rightWall.scale.set(0.2, 5.0, 8.0);
  rightWall.position.set(4.0, 2.5, 0);
  scene.add(rightWall);

  // Front Wall (Z = 4)
  const frontWall = new Object3D("frontWall");
  frontWall.geometry = cubeGeo;
  frontWall.material = wallMat;
  frontWall.scale.set(8.0, 5.0, 0.2);
  frontWall.position.set(0, 2.5, 4.0);
  scene.add(frontWall);

  // Furniture: Table
  const table = new Object3D("table");
  table.position.set(0, 0.75, 0);

  const tableTop = new Object3D("tableTop");
  tableTop.geometry = cubeGeo;
  tableTop.material = deskTopMat;
  tableTop.scale.set(2.2, 0.06, 1.2);
  tableTop.position.set(0, 0.03, 0); // Tabletop world Y surface is 0.81
  table.add(tableTop);

  // Legs touch tableTop bottom (0.0) and floor exactly (height 0.75, pos -0.375)
  const legPositions: [number, number, number][] = [
    [-1.0, -0.375, -0.5],
    [1.0, -0.375, -0.5],
    [-1.0, -0.375, 0.5],
    [1.0, -0.375, 0.5],
  ];
  legPositions.forEach(([lx, ly, lz], i) => {
    const leg = new Object3D(`tableLeg_${i}`);
    leg.geometry = cubeGeo;
    leg.material = steelMat;
    leg.scale.set(0.08, 0.75, 0.08);
    leg.position.set(lx, ly, lz);
    table.add(leg);
  });
  scene.add(table);

  // TABLE SURFACE IS AT WORLD Y = 0.81.
  // Placement coordinates for items resting on the table: Y = 0.81 + scaleY/2.

  // Dossier folder on table (placed on interrogator's left side)
  const folder = new Object3D("dossier");
  folder.geometry = cubeGeo;
  folder.material = new StandardMaterial({
    color: new Color(0.76, 0.65, 0.45),
    roughness: 0.9,
  });
  folder.scale.set(0.3, 0.01, 0.22);
  folder.position.set(-0.35, 0.815, 0.2); // Rest on table surface (0.81 + 0.005)
  folder.rotation.y = 0.2;
  scene.add(folder);

  // Cup Geometries: Round Cylinder body + Torus handle
  const cupBodyGeo = new Cylinder({
    radiusTop: 0.045,
    radiusBottom: 0.038,
    height: 0.11,
    radialSegments: 24,
  }).getGeometryData();

  const cupHandleGeo = new Torus({
    radius: 0.028,
    tube: 0.007,
    radialSegments: 12,
    tubularSegments: 20,
  }).getGeometryData();

  // Cup 1: White ceramic (Interrogator's side - Left)
  const cup1 = new Object3D("cup1");
  cup1.geometry = cupBodyGeo;
  cup1.material = new StandardMaterial({
    color: new Color(0.92, 0.92, 0.92),
    roughness: 0.2,
  });
  cup1.position.set(-0.6, 0.865, -0.3); // Rest on table surface (0.81 + 0.055)

  const cup1Handle = new Object3D("cup1_handle");
  cup1Handle.geometry = cupHandleGeo;
  cup1Handle.material = cup1.material;
  cup1Handle.position.set(-0.045, 0.0, 0.0);
  cup1Handle.rotation.z = Math.PI / 2;
  cup1.add(cup1Handle);
  scene.add(cup1);

  // Cup 2: Dark green ceramic (Suspect's side - Right)
  const cup2 = new Object3D("cup2");
  cup2.geometry = cupBodyGeo;
  cup2.material = new StandardMaterial({
    color: new Color(0.12, 0.38, 0.22),
    roughness: 0.3,
  });
  cup2.position.set(0.6, 0.865, 0.3); // Rest on table surface (0.81 + 0.055)

  const cup2Handle = new Object3D("cup2_handle");
  cup2Handle.geometry = cupHandleGeo;
  cup2Handle.material = cup2.material;
  cup2Handle.position.set(0.045, 0.0, 0.0);
  cup2Handle.rotation.z = Math.PI / 2;
  cup2.add(cup2Handle);
  scene.add(cup2);

  // Case files / DIN A4 pages on table (placed in the middle-left area where interrogator reads them)
  const paperGeo = new Cube({ size: 1.0 }).getGeometryData();

  const paper1 = new Object3D("paper1");
  paper1.geometry = paperGeo;
  paper1.material = paperMat;
  paper1.scale.set(0.36, 0.002, 0.25);
  paper1.position.set(-0.25, 0.811, 0.15); // Rest on table surface (0.81 + 0.001)
  paper1.rotation.y = -0.12;
  scene.add(paper1);

  const paper2 = new Object3D("paper2");
  paper2.geometry = paperGeo;
  paper2.material = paperMat;
  paper2.scale.set(0.36, 0.002, 0.25);
  paper2.position.set(-0.15, 0.812, -0.1); // Stacked slightly above paper1 to avoid z-fight
  paper2.rotation.y = 0.08;
  scene.add(paper2);

  const paper3 = new Object3D("paper3");
  paper3.geometry = paperGeo;
  paper3.material = paperMat;
  paper3.scale.set(0.36, 0.002, 0.25);
  paper3.position.set(-0.08, 0.813, 0.1); // Stacked slightly above paper2
  paper3.rotation.y = -0.04;
  scene.add(paper3);

  // Interrogator Chair (facing right, towards table)
  const chair1 = new Object3D("chair1");
  chair1.position.set(-1.5, 0.45, 0);
  chair1.rotation.y = -Math.PI / 2.0;

  const seat1 = new Object3D("chairSeat1");
  seat1.geometry = cubeGeo;
  seat1.material = plasticMat;
  seat1.scale.set(0.55, 0.04, 0.55);
  chair1.add(seat1);

  const back1 = new Object3D("chairBack1");
  back1.geometry = cubeGeo;
  back1.material = plasticMat;
  back1.scale.set(0.55, 0.45, 0.04);
  back1.position.set(0, 0.245, 0.255);
  chair1.add(back1);

  // Chair legs touch seat bottom (-0.02) and floor (-0.45) exactly (height 0.43, pos -0.235)
  const chairLegOffsets: [number, number, number][] = [
    [-0.23, -0.235, -0.23],
    [0.23, -0.235, -0.23],
    [-0.23, -0.235, 0.23],
    [0.23, -0.235, 0.23],
  ];
  chairLegOffsets.forEach(([cx, cy, cz], i) => {
    const leg = new Object3D(`chairLeg1_${i}`);
    leg.geometry = cubeGeo;
    leg.material = steelMat;
    leg.scale.set(0.04, 0.43, 0.04);
    leg.position.set(cx, cy, cz);
    chair1.add(leg);
  });
  scene.add(chair1);

  // Suspect Chair (facing left, towards table)
  const chair2 = new Object3D("chair2");
  chair2.position.set(1.5, 0.45, 0);
  chair2.rotation.y = Math.PI / 2.0;

  const seat2 = new Object3D("chairSeat2");
  seat2.geometry = cubeGeo;
  seat2.material = plasticMat;
  seat2.scale.set(0.55, 0.04, 0.55);
  chair2.add(seat2);

  const back2 = new Object3D("chairBack2");
  back2.geometry = cubeGeo;
  back2.material = plasticMat;
  back2.scale.set(0.55, 0.45, 0.04);
  back2.position.set(0, 0.245, 0.255);
  chair2.add(back2);

  chairLegOffsets.forEach(([cx, cy, cz], i) => {
    const leg = new Object3D(`chairLeg2_${i}`);
    leg.geometry = cubeGeo;
    leg.material = steelMat;
    leg.scale.set(0.04, 0.43, 0.04);
    leg.position.set(cx, cy, cz);
    chair2.add(leg);
  });
  scene.add(chair2);

  // Ceiling Light Bulb
  const lightBulb = new Object3D("lightBulb");
  lightBulb.geometry = cubeGeo;
  lightBulb.material = emissiveMat;
  lightBulb.scale.set(0.12, 0.12, 0.12);
  lightBulb.position.set(0, 4.0, 0);
  scene.add(lightBulb);

  const swingLight = new SpotLight({
    name: "interrogationSpot",
    color: new Color(1.0, 0.97, 0.88), // Warm lightbulb filament glow
    intensity: 15.0, // Increased from 8.0 for dramatic shadows
    distance: 12.0,
    angle: Math.PI / 5.0, // Narrower light cone (from PI/3 to PI/5) for high contrast spot
    penumbra: 0.5,
    decay: 1.2,
  });
  swingLight.position.copyFrom(lightBulb.position);
  swingLight.direction.set(0, -1, 0);
  scene.add(swingLight);

  // Ambient Light (Dropped from 0.4 to 0.06 to create deep shadows and mystery)
  const ambientLight = new AmbientLight({
    color: new Color(0.15, 0.17, 0.22), // Cold blue ambient fill
    intensity: 0.06,
  });
  scene.add(ambientLight);

  // Police Sirens Point Light (relative to new wall size X = -3.5)
  const redBlueLight = new PointLight({
    name: "policeFlasher",
    color: new Color(0.0, 0.0, 0.0),
    intensity: 0.0,
    distance: 15.0,
    decay: 1.5,
  });
  redBlueLight.position.set(-3.5, 3.5, 0.0);
  scene.add(redBlueLight);

  return { lightBulb, swingLight, redBlueLight };
}

// ============================================================================
// 4. Monitor View Application
// ============================================================================

class Showcase14 extends AbstractShowcase {
  private _lightBulb?: Object3D;
  private _swingLight?: SpotLight;
  private _redBlueLight?: PointLight;

  private _presetName: string;
  private _time: number = 0.0;

  constructor(canvasId: string, presetName: string) {
    super({
      canvasId,
      fullscreen: false,
      rendererType: RendererType.BEST,
    });
    this._presetName = presetName;
  }

  protected override async setupScene(): Promise<void> {
    // Setup Camera Aspect
    if (ProjectionType.PERSPECTIVE === this.camera.projection.type) {
      const aspect: number = this.canvas.clientWidth / this.canvas.clientHeight;
      this.camera.projection = new PerspectiveProjection({
        fov: (60 * Math.PI) / 180,
        aspect,
        near: 0.1,
        far: 1000,
      });
      this.camera.updateProjectionMatrix();
    }
    this.camera.setStrategy(CameraStrategyType.MANUAL);

    // Setup Shared Textures
    if (!SharedState.paperTexture) {
      SharedState.paperTexture = await createPaperTexture();
    }
    if (!SharedState.floorTexture) {
      SharedState.floorTexture = await createFloorTexture();
    }
    if (!SharedState.wallTexture) {
      SharedState.wallTexture = await createWallTexture();
    }

    // Build the room structure in this app's scene
    const lights = buildInterrogationRoom(
      this.scene,
      SharedState.paperTexture,
      SharedState.floorTexture,
      SharedState.wallTexture,
    );
    this._lightBulb = lights.lightBulb;
    this._swingLight = lights.swingLight;
    this._redBlueLight = lights.redBlueLight;

    // Apply Noir (grayscale) conversions to the scene objects if this is the Noir monitor
    if (this._presetName === "noir") {
      this.scene.objects.forEach((obj) => {
        const applyGrayscale = (node: Object3D): void => {
          if (node.material) {
            const mat = node.material;
            const gray = 0.299 * mat.color.r + 0.587 * mat.color.g + 0.114 * mat.color.b;
            mat.color.set(gray, gray, gray);

            if (mat instanceof StandardMaterial) {
              const stdMat = mat;
              const eGray =
                0.299 * stdMat.emissiveColor.r +
                0.587 * stdMat.emissiveColor.g +
                0.114 * stdMat.emissiveColor.b;
              stdMat.emissiveColor.set(eGray, eGray, eGray);
            }
          }
          if (node instanceof AbstractLight) {
            const gray = 0.299 * node.color.r + 0.587 * node.color.g + 0.114 * node.color.b;
            node.color.set(gray, gray, gray);
          }
          node.children.forEach(applyGrayscale);
        };
        applyGrayscale(obj);
      });
    }

    // Configure Post Processing
    this.renderer.postProcessing.enabled = true;

    const toneMapping = this.renderer.postProcessing.get<ToneMappingElement>(
      PostProcessingEffectType.TONE_MAPPING,
    );
    const vignette = this.renderer.postProcessing.get<VignetteElement>(
      PostProcessingEffectType.VIGNETTE,
    );
    const grain = this.renderer.postProcessing.get<GrainElement>(PostProcessingEffectType.GRAIN);
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);

    if (vignette) vignette.enabled = false;
    if (grain) grain.enabled = false;
    if (bloom) bloom.enabled = false;

    switch (this._presetName) {
      case "clean":
        this.renderer.postProcessing.filterMode = 0;
        if (toneMapping) {
          toneMapping.enabled = true;
          toneMapping.mode = ToneMappingMode.ACES_FILMIC;
          toneMapping.exposure = 1.0;
        }
        break;

      case "nightvision":
        this.renderer.postProcessing.filterMode = 1;
        if (toneMapping) {
          toneMapping.enabled = true;
          toneMapping.mode = ToneMappingMode.ACES_FILMIC;
          toneMapping.exposure = 2.4; // Boost exposure for night vision details in shadows
        }
        if (vignette) {
          vignette.enabled = true;
          vignette.darkness = 0.9;
          vignette.offset = 0.65;
          vignette.roundness = 2.0;
        }
        if (grain) {
          grain.enabled = true;
          grain.intensity = 0.24; // Highly noisy sensor grain
        }
        if (bloom) {
          bloom.enabled = true;
          bloom.intensity = 3.5;
          bloom.threshold = 0.25;
          bloom.radius = 1.4;
          bloom.color = new Color(0.05, 1.8, 0.15); // Vibrant glowing phosphor green
        }
        break;

      case "noir":
        this.renderer.postProcessing.filterMode = 2;
        if (toneMapping) {
          toneMapping.enabled = true;
          toneMapping.mode = ToneMappingMode.CINEON;
          toneMapping.exposure = 1.2; // High contrast
        }
        if (vignette) {
          vignette.enabled = true;
          vignette.darkness = 0.85;
          vignette.offset = 0.68;
        }
        if (grain) {
          grain.enabled = true;
          grain.intensity = 0.16;
        }
        if (bloom) {
          bloom.enabled = true;
          bloom.intensity = 0.8;
          bloom.color = new Color(1.0, 1.0, 1.0);
        }
        break;

      case "cyber":
        this.renderer.postProcessing.filterMode = 3;
        if (toneMapping) {
          toneMapping.enabled = true;
          toneMapping.mode = ToneMappingMode.ACES_FILMIC;
          toneMapping.exposure = 1.4;
        }
        if (bloom) {
          bloom.enabled = true;
          bloom.intensity = 4.5; // Extreme bleed bloom
          bloom.threshold = 0.2;
          bloom.radius = 1.6;
          bloom.color = new Color(2.0, 0.05, 1.5); // Rich glowing hot magenta
        }
        if (grain) {
          grain.enabled = true;
          grain.intensity = 0.08;
        }
        break;

      case "tape":
        this.renderer.postProcessing.filterMode = 4;
        if (toneMapping) {
          toneMapping.enabled = true;
          toneMapping.mode = ToneMappingMode.REINHARD;
          toneMapping.exposure = 0.75; // Gritty, dark tape feed
        }
        if (vignette) {
          vignette.enabled = true;
          vignette.darkness = 0.98; // Very heavy CRT vignette
          vignette.offset = 0.55;
          vignette.roundness = 5.0;
        }
        if (grain) {
          grain.enabled = true;
          grain.intensity = 0.35; // Heavy analog tape static noise
        }
        break;

      case "underworld":
        this.renderer.postProcessing.filterMode = 5;
        if (toneMapping) {
          toneMapping.enabled = true;
          toneMapping.mode = ToneMappingMode.ACES_FILMIC;
          toneMapping.exposure = 1.25;
        }
        if (vignette) {
          vignette.enabled = true;
          vignette.darkness = 0.7;
          vignette.offset = 0.75;
        }
        if (grain) {
          grain.enabled = true;
          grain.intensity = 0.05;
        }
        if (bloom) {
          bloom.enabled = true;
          bloom.intensity = 2.4;
          bloom.threshold = 0.45;
          bloom.radius = 1.2;
          bloom.color = new Color(1.8, 0.8, 0.05); // Hot glowing amber orange
        }
        break;

      case "projector":
        this.renderer.postProcessing.filterMode = 6;
        if (toneMapping) {
          toneMapping.enabled = true;
          toneMapping.mode = ToneMappingMode.ACES_FILMIC;
          toneMapping.exposure = 1.35;
        }
        if (vignette) {
          vignette.enabled = true;
          vignette.darkness = 0.95;
          vignette.offset = 0.52;
          vignette.roundness = 2.2;
        }
        if (grain) {
          grain.enabled = true;
          grain.intensity = 0.3; // heavy vintage grain
        }
        break;

      case "thermal":
        this.renderer.postProcessing.filterMode = 7;
        if (toneMapping) {
          toneMapping.enabled = true;
          toneMapping.mode = ToneMappingMode.ACES_FILMIC;
          toneMapping.exposure = 1.1;
        }
        if (vignette) {
          vignette.enabled = true;
          vignette.darkness = 0.8;
          vignette.offset = 0.65;
        }
        break;

      case "comic":
        this.renderer.postProcessing.filterMode = 0;
        if (toneMapping) {
          toneMapping.enabled = true;
          toneMapping.mode = ToneMappingMode.ACES_FILMIC;
          toneMapping.exposure = 1.2;
        }
        {
          const quantize = this.renderer.postProcessing.get<QuantizeElement>(
            PostProcessingEffectType.QUANTIZE,
          );
          if (quantize) {
            quantize.enabled = true;
            quantize.steps = 6.0; // 6 color bands for graphic novel look
          }
        }
        {
          const outline = this.renderer.postProcessing.get<OutlineElement>(
            PostProcessingEffectType.OUTLINE,
          );
          if (outline) {
            outline.enabled = true;
            outline.thickness = 1.5;
            outline.sensitivity = 1.2;
            outline.color = Color.BLACK;
          }
        }
        if (vignette) {
          vignette.enabled = true;
          vignette.darkness = 0.5;
          vignette.offset = 0.75;
        }
        break;
    }
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);
    this._time += deltaTime;

    // 1. Camera Angle Positioning & Sweep Animation
    const speed = SharedState.sweepSpeed;
    const timeFactor = this._time * 0.4 * speed;

    if (SharedState.cameraAngle === "high") {
      // Security camera sweeping from above corner (slightly closer because room is half size)
      const sweepX = SharedState.sweepActive ? 1.8 * Math.sin(timeFactor) : 0.0;
      this.camera.position.set(sweepX, 3.8, 3.2);
      this.camera.target.set(0, 0.4, -0.2);
    } else if (SharedState.cameraAngle === "desk") {
      // Lower angle looking directly down table center
      const sweepX = SharedState.sweepActive ? 0.4 * Math.sin(timeFactor * 0.8) : 0.0;
      this.camera.position.set(sweepX, 1.25, 1.8);
      this.camera.target.set(0, 0.75, 0.0);
    } else if (SharedState.cameraAngle === "door") {
      // Corner view near the "door" (adjusted for smaller room)
      const sweepY = SharedState.sweepActive ? 0.25 * Math.sin(timeFactor * 0.6) : 0.0;
      this.camera.position.set(-2.6, 1.5 + sweepY, 2.6);
      this.camera.target.set(0.1, 0.6, -0.3);
    }

    // 2. Ceiling Light Animation
    if (this._lightBulb && this._swingLight) {
      if (SharedState.lightMode === "swing") {
        // Swinging Ceiling Spotlight
        const angle = Math.sin(this._time * 1.5);
        this._lightBulb.position.set(1.0 * angle, 4.0, 0.4 * Math.cos(this._time * 1.5));
        this._swingLight.position.copyFrom(this._lightBulb.position);
        this._swingLight.direction
          .set(-this._lightBulb.position.x * 0.15, -1.0, -this._lightBulb.position.z * 0.15)
          .normalize();

        // Stable light intensity
        this._swingLight.intensity = 15.0;
        const bulbMat = this._lightBulb.material;
        if (bulbMat && bulbMat instanceof StandardMaterial) {
          bulbMat.emissiveIntensity = 10.0;
        }
      } else {
        // Flickering Spotlight
        this._lightBulb.position.set(0.0, 4.0, 0.0);
        this._swingLight.position.copyFrom(this._lightBulb.position);
        this._swingLight.direction.set(0.0, -1.0, 0.0);

        const flicker = Math.random() > 0.96 ? 0.0 : 1.0; // Drops to 0.0 for complete blackout flashes
        const subFlicker = Math.random() > 0.85 ? 0.4 : 1.0;
        const currentMult = flicker * subFlicker;

        this._swingLight.intensity = 15.0 * currentMult;
        const bulbMat = this._lightBulb.material;
        if (bulbMat && bulbMat instanceof StandardMaterial) {
          bulbMat.emissiveIntensity = 10.0 * currentMult;
        }
      }
    }

    // 3. Police Sirens outside (flashing red and blue)
    if (this._redBlueLight) {
      if (SharedState.sirensActive) {
        const cycle = Math.floor(this._time * 4.0) % 2;
        if (cycle === 0) {
          // Red Flash
          if (this._presetName === "noir") {
            this._redBlueLight.color.set(6.0, 6.0, 6.0); // Boosted grayscale intensity
          } else {
            this._redBlueLight.color.set(8.0, 0.1, 0.1); // Stark red flash
          }
        } else {
          // Blue Flash
          if (this._presetName === "noir") {
            this._redBlueLight.color.set(0.1, 0.1, 0.1);
          } else {
            this._redBlueLight.color.set(0.1, 0.1, 8.0); // Stark blue flash
          }
        }
        // Pulsing intensity
        this._redBlueLight.intensity = 4.0 + 4.0 * Math.sin(this._time * 15.0);
      } else {
        this._redBlueLight.intensity = 0.0;
      }
    }

    // Trigger matrix updates
    this.scene.objects.forEach((obj) => obj.updateMatrixWorld());
  }
}

// ============================================================================
// 5. Bootstrapping
// ============================================================================

const cleanApp = new Showcase14("SmallWorldMachine-1", "clean");
const nvApp = new Showcase14("SmallWorldMachine-2", "nightvision");
const noirApp = new Showcase14("SmallWorldMachine-3", "noir");
const cyberApp = new Showcase14("SmallWorldMachine-4", "cyber");
const tapeApp = new Showcase14("SmallWorldMachine-5", "tape");
const amberApp = new Showcase14("SmallWorldMachine-6", "underworld");
const projectorApp = new Showcase14("SmallWorldMachine-7", "projector");
const thermalApp = new Showcase14("SmallWorldMachine-8", "thermal");
const comicApp = new Showcase14("SmallWorldMachine-9", "comic");

const apps: Showcase14[] = [
  cleanApp,
  nvApp,
  noirApp,
  cyberApp,
  tapeApp,
  amberApp,
  projectorApp,
  thermalApp,
  comicApp,
];

Promise.all([
  cleanApp.start(),
  nvApp.start(),
  noirApp.start(),
  cyberApp.start(),
  tapeApp.start(),
  amberApp.start(),
  projectorApp.start(),
  thermalApp.start(),
  comicApp.start(),
])
  .then(() => setupUIControls())
  .catch((err: unknown) => console.error("[Showcase14] Failed to start:", err));

// ============================================================================
// 6. UI Control Event Binding
// ============================================================================

function setupUIControls(): void {
  // Play/Pause sweep
  const playPauseBtn = document.getElementById("btn-play-pause");
  if (playPauseBtn) {
    playPauseBtn.addEventListener("click", () => {
      SharedState.sweepActive = !SharedState.sweepActive;
      if (SharedState.sweepActive) {
        playPauseBtn.textContent = "ACTIVE";
        playPauseBtn.classList.add("active");
      } else {
        playPauseBtn.textContent = "PAUSED";
        playPauseBtn.classList.remove("active");
      }
    });
  }

  // Sweep speed slider
  const speedSlider = document.getElementById("slider-speed") as HTMLInputElement;
  if (speedSlider) {
    speedSlider.addEventListener("input", () => {
      SharedState.sweepSpeed = parseFloat(speedSlider.value) / 100.0;
    });
  }

  // Camera angle triggers
  const angleHighBtn = document.getElementById("btn-angle-high");
  const angleDeskBtn = document.getElementById("btn-angle-desk");
  const angleDoorBtn = document.getElementById("btn-angle-door");

  const setAngleActive = (activeBtn: HTMLElement, angle: "high" | "desk" | "door"): void => {
    [angleHighBtn, angleDeskBtn, angleDoorBtn].forEach((btn) => {
      if (btn) btn.classList.remove("active");
    });
    activeBtn.classList.add("active");
    SharedState.cameraAngle = angle;
  };

  if (angleHighBtn) {
    angleHighBtn.addEventListener("click", () => setAngleActive(angleHighBtn, "high"));
  }
  if (angleDeskBtn) {
    angleDeskBtn.addEventListener("click", () => setAngleActive(angleDeskBtn, "desk"));
  }
  if (angleDoorBtn) {
    angleDoorBtn.addEventListener("click", () => setAngleActive(angleDoorBtn, "door"));
  }

  // Light swing vs flicker toggles
  const lightSwingBtn = document.getElementById("btn-light-swing");
  const lightFlickerBtn = document.getElementById("btn-light-flicker");

  const setLightModeActive = (activeBtn: HTMLElement, mode: "swing" | "flicker"): void => {
    [lightSwingBtn, lightFlickerBtn].forEach((btn) => {
      if (btn) btn.classList.remove("active");
    });
    activeBtn.classList.add("active");
    SharedState.lightMode = mode;
  };

  if (lightSwingBtn) {
    lightSwingBtn.addEventListener("click", () => setLightModeActive(lightSwingBtn, "swing"));
  }
  if (lightFlickerBtn) {
    lightFlickerBtn.addEventListener("click", () => setLightModeActive(lightFlickerBtn, "flicker"));
  }

  // Sirens toggle
  const sirensToggleBtn = document.getElementById("btn-sirens-toggle");
  if (sirensToggleBtn) {
    sirensToggleBtn.addEventListener("click", () => {
      SharedState.sirensActive = !SharedState.sirensActive;
      if (SharedState.sirensActive) {
        sirensToggleBtn.textContent = "ON";
        sirensToggleBtn.classList.add("active");
      } else {
        sirensToggleBtn.textContent = "OFF";
        sirensToggleBtn.classList.remove("active");
      }
    });
  }

  // Toggle monitor power via LED
  const leds = document.querySelectorAll(".power-led");
  leds.forEach((led) => {
    led.addEventListener("click", (e) => {
      e.stopPropagation(); // Don't trigger monitor zoom when clicking power LED
      const idxStr = led.getAttribute("data-monitor");
      if (idxStr !== null) {
        const idx = parseInt(idxStr);
        const app = apps[idx];
        const container = led.closest(".monitor-container");
        if (app && container) {
          const isOff = container.classList.toggle("off");
          led.classList.toggle("off", isOff);
          if (isOff) {
            app.stop();
          } else {
            void app.start();
          }
        }
      }
    });
  });

  // Toggle fullscreen zoom on monitor click
  const containers = document.querySelectorAll(".monitor-container");
  containers.forEach((container) => {
    container.addEventListener("click", () => {
      const isFullscreen = container.classList.contains("fullscreen");
      // Remove fullscreen from all other monitors
      containers.forEach((c) => c.classList.remove("fullscreen"));
      if (!isFullscreen) {
        container.classList.add("fullscreen");
      }
    });
  });

  // ESC key to exit fullscreen zoom
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      containers.forEach((c) => c.classList.remove("fullscreen"));
    }
  });
}
