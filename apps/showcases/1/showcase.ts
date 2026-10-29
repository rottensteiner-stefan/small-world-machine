import type { GeometryDataInterface } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Arch,
  Barrel,
  CameraStrategyType,
  Capsule,
  Color,
  Cone,
  Cube,
  Cylinder,
  DirectionalLight,
  Gear,
  Ground,
  LambertMaterial,
  LShape,
  Object3D,
  Octahedron,
  OrbitController,
  PhongMaterial,
  Pyramid,
  Sphere,
  Torus,
  TriStar,
  WireframeMaterial,
} from "@small-world-machine/engine";
import { ShapeMaterialHud, type GeometryOption } from "./Hud.js";

interface GeometryEntry extends GeometryOption {
  create: () => GeometryDataInterface;
}

const GEOMETRY_REGISTRY: GeometryEntry[] = [
  {
    id: "cube",
    name: "Cube (Würfel)",
    icon: "🧊",
    create: () => new Cube({ size: 2 }).getGeometryData(),
  },
  {
    id: "sphere",
    name: "Sphere (Kugel)",
    icon: "🔮",
    create: () =>
      new Sphere({ radius: 1.25, widthSegments: 32, heightSegments: 24 }).getGeometryData(),
  },
  {
    id: "cylinder",
    name: "Cylinder (Zylinder)",
    icon: "🥫",
    create: () =>
      new Cylinder({
        radiusTop: 0.9,
        radiusBottom: 0.9,
        height: 2.2,
        radialSegments: 32,
      }).getGeometryData(),
  },
  {
    id: "torus",
    name: "Torus (Donut)",
    icon: "🍩",
    create: () =>
      new Torus({
        radius: 1.1,
        tube: 0.45,
        radialSegments: 24,
        tubularSegments: 40,
      }).getGeometryData(),
  },
  {
    id: "cone",
    name: "Cone (Kegel)",
    icon: "🍦",
    create: () => new Cone({ radius: 1.2, height: 2.2, radialSegments: 32 }).getGeometryData(),
  },
  {
    id: "capsule",
    name: "Capsule (Kapsel)",
    icon: "💊",
    create: () =>
      new Capsule({
        radius: 0.65,
        length: 1.2,
        capSegments: 16,
        radialSegments: 24,
      }).getGeometryData(),
  },
  {
    id: "pyramid",
    name: "Pyramid (Pyramide)",
    icon: "🔺",
    create: () => new Pyramid({ base: 2.0, height: 2.2, radialSegments: 4 }).getGeometryData(),
  },
  {
    id: "octahedron",
    name: "Octahedron (Oktaeder)",
    icon: "💎",
    create: () => new Octahedron({ radius: 1.4 }).getGeometryData(),
  },
  {
    id: "gear",
    name: "Gear (Zahnrad)",
    icon: "⚙️",
    create: () =>
      new Gear({ teeth: 8, innerRadius: 0.9, toothHeight: 0.4, thickness: 0.5 }).getGeometryData(),
  },
  {
    id: "barrel",
    name: "Barrel (Fass)",
    icon: "🛢️",
    create: () =>
      new Barrel({
        radiusMiddle: 1.1,
        radiusEnds: 0.8,
        height: 2.0,
        radialSegments: 32,
      }).getGeometryData(),
  },
  {
    id: "arch",
    name: "Arch (Rundbogen)",
    icon: "🏛️",
    create: () => new Arch({ length: 2.6, height: 2.0, depth: 0.8, radius: 0.9 }).getGeometryData(),
  },
  {
    id: "tristar",
    name: "TriStar (Dreistern)",
    icon: "⭐",
    create: () =>
      new TriStar({ armLength: 1.2, innerAngle: Math.PI / 6, depth: 0.6 }).getGeometryData(),
  },
  {
    id: "lshape",
    name: "L-Shape (Winkelprofil)",
    icon: "📐",
    create: () =>
      new LShape({ width: 2.0, height: 2.0, thickness: 0.6, depth: 0.8 }).getGeometryData(),
  },
];

const COLOR_SWATCHES = [
  { name: "Dodger Blue", hex: "#1e90ff" },
  { name: "Showcase Purple", hex: "#b000ff" },
  { name: "Emerald Green", hex: "#10b981" },
  { name: "Amber Gold", hex: "#f59e0b" },
  { name: "Crimson Red", hex: "#e11d48" },
  { name: "Cyan Aqua", hex: "#06b6d4" },
  { name: "Magenta Pink", hex: "#d946ef" },
  { name: "Pure White", hex: "#ffffff" },
];

export class Showcase extends AbstractShowcase {
  private _activeMesh!: Object3D;
  private _phongMaterial!: PhongMaterial;
  private _wireframeMaterial!: WireframeMaterial;
  private _sun!: DirectionalLight;
  private _shadowResolution: number = 4096;

  private _selectedGeometryId: string = "cube";
  private _selectedColorHex: string = "#1e90ff";
  private _shininess: number = 60;
  private _autoRotate: boolean = true;
  private _rotateSpeed: number = 1.0;
  private _isWireframe: boolean = false;
  private _wireframeCastsShadow: boolean = true;
  /** World width (m) of the wire shadow; 0 = 1-texel line (ADR 0045). */
  private _wireShadowWidth: number = 0.02;

  private _hud: ShapeMaterialHud | null = null;

  protected override async setupScene(): Promise<void> {
    this.defaultFov = (75 * Math.PI) / 180;
    this.configureCamera();

    // 1. Lighting: Directional Sun + Ambient fill
    const sun = new DirectionalLight({ color: Color.WHITE, intensity: 1.0 });
    sun.direction.set(-1, -1, -1);
    sun.castShadow = true;
    sun.shadowResolution = this._shadowResolution;
    sun.shadowBias = 0.005;
    this._sun = sun;
    this.scene.add(sun);

    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.25 }));

    // 2. Materials
    this._phongMaterial = new PhongMaterial({
      color: Color.fromHex(this._selectedColorHex),
      shininess: this._shininess,
    });

    this._wireframeMaterial = new WireframeMaterial({
      color: Color.fromHex(this._selectedColorHex),
      shadowWidth: this._wireShadowWidth,
    });

    // 3. Central Interactive Mesh
    this._activeMesh = new Object3D("InteractiveMesh").setPosition(0, 0, 0).setScale(1);
    this._activeMesh.geometry = GEOMETRY_REGISTRY[0]!.create();
    this._activeMesh.material = this._phongMaterial;
    this._activeMesh.castShadow = true;
    this._activeMesh.receiveShadow = true;
    this.scene.add(this._activeMesh);

    // 4. Ground floor
    const floor = new Object3D("Floor").setPosition(0, -2, 0);
    floor.geometry = new Ground({ width: 10, depth: 10 }).getGeometryData();
    floor.material = new LambertMaterial({ color: Color.WHITE });
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 5. Camera & Orbit Controller
    this.camera.setStrategy(CameraStrategyType.SMOOTH);
    this.camera.position.set(0, 3, 6);
    this.camera.target.set(0, 0, 0);
    this.camera.addBehavior(new OrbitController({ input: this.input }));
    this.camera.updateViewMatrix();

    // 6. UI Controls
    this._createInspectorUI();
  }

  protected override update(deltaTime: number): void {
    if (this._autoRotate && this._activeMesh) {
      this._activeMesh.rotation.x += deltaTime * this._rotateSpeed;
      this._activeMesh.rotation.y += 1.5 * deltaTime * this._rotateSpeed;
    }
  }

  private _setGeometry(id: string): void {
    const entry = GEOMETRY_REGISTRY.find((g) => g.id === id);
    if (!entry) return;
    this._selectedGeometryId = id;
    this._activeMesh.geometry = entry.create();
  }

  private _setColor(hex: string): void {
    this._selectedColorHex = hex;
    const color = Color.fromHex(hex);
    this._phongMaterial.color.copyFrom(color);
    this._wireframeMaterial.color.copyFrom(color);
  }

  private _setShadowResolution(val: number): void {
    this._shadowResolution = val;
    this._sun.shadowResolution = val;
  }

  private _setWireShadowWidth(val: number): void {
    this._wireShadowWidth = val;
    this._wireframeMaterial.shadowWidth = val;
  }

  private _setShininess(val: number): void {
    this._shininess = val;
    this._phongMaterial.shininess = val;
  }

  private _setWireframe(active: boolean): void {
    this._isWireframe = active;
    this._activeMesh.material = active ? this._wireframeMaterial : this._phongMaterial;
    this._applyCastShadow();
  }

  private _applyCastShadow(): void {
    this._activeMesh.castShadow = !this._isWireframe || this._wireframeCastsShadow;
  }

  private _createInspectorUI(): void {
    this._hud = new ShapeMaterialHud(
      GEOMETRY_REGISTRY,
      COLOR_SWATCHES,
      {
        geometryId: this._selectedGeometryId,
        colorHex: this._selectedColorHex,
        shininess: this._shininess,
        autoRotate: this._autoRotate,
        rotateSpeed: this._rotateSpeed,
        wireframe: this._isWireframe,
        wireframeCastsShadow: this._wireframeCastsShadow,
        shadowResolution: this._shadowResolution,
        wireShadowWidth: this._wireShadowWidth,
      },
      {
        setGeometry: (id: string): void => this._setGeometry(id),
        setColor: (hex: string): void => this._setColor(hex),
        setShininess: (value: number): void => this._setShininess(value),
        setAutoRotate: (on: boolean): void => {
          this._autoRotate = on;
        },
        setRotateSpeed: (value: number): void => {
          this._rotateSpeed = value;
        },
        setWireframe: (on: boolean): void => this._setWireframe(on),
        setWireframeCastsShadow: (on: boolean): void => {
          this._wireframeCastsShadow = on;
          this._applyCastShadow();
        },
        setShadowResolution: (px: number): void => this._setShadowResolution(px),
        setWireShadowWidth: (meters: number): void => this._setWireShadowWidth(meters),
      },
    );
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    this._hud?.handleKey(event);
  }

  public override destroy(): void {
    this._hud?.dispose();
    super.destroy();
  }
}

// === START THE ENGINE ===
const app = new Showcase();
app.start().catch((err: unknown) => console.error("[Showcase1] Failed to start:", err));
