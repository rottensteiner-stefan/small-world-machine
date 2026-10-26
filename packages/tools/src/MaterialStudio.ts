import type { ForgeToolOptions, GeometryDataInterface } from "@small-world-machine/engine";
import {
  ForgeTool,
  SmallWorldMachine,
  Object3D,
  Sphere,
  Cube,
  Torus,
  Ground,
  StandardMaterial,
  Texture,
  Color,
  DirectionalLight,
  AmbientLight,
  PerspectiveProjection,
  CameraStrategyType,
  Vector2D,
} from "@small-world-machine/engine";
import { MATERIAL_STUDIO_CSS } from "./material-studio/materialStudioStyles.js";
import { buildMaterialStudioUI } from "./material-studio/MaterialStudioUiBuilder.js";
import { MaterialStudioController } from "./material-studio/MaterialStudioController.js";

export class MaterialStudioApp extends SmallWorldMachine {
  private _previewObject!: Object3D;
  private _pbrMaterial!: StandardMaterial;
  private _time: number = 0;
  private _sphereGeometry!: GeometryDataInterface;
  private _cubeGeometry!: GeometryDataInterface;
  private _torusGeometry!: GeometryDataInterface;
  private _planeGeometry!: GeometryDataInterface;

  constructor(canvasId: string) {
    super({
      canvasId: canvasId,
      fullscreen: false,
    });
  }

  protected override async setupScene(): Promise<void> {
    const aspect = this.canvas.width / this.canvas.height;
    this.camera.projection = new PerspectiveProjection({
      fov: (50 * Math.PI) / 180,
      aspect,
      near: 0.1,
      far: 100,
    });
    this.camera.updateProjectionMatrix();

    this.camera.setStrategy(CameraStrategyType.FIXED);
    this.camera.position.set(0, 0, 4.5);
    this.camera.target.set(0, 0, 0);
    this.camera.updateViewMatrix();

    this.scene.add(new AmbientLight({ color: new Color(1, 1, 1), intensity: 0.15 }));

    const keyLight = new DirectionalLight({ color: new Color(1, 0.977, 0.953), intensity: 1.2 });
    keyLight.direction.set(1.5, 1, 1).normalize();
    this.scene.add(keyLight);

    const fillLight = new DirectionalLight({ color: new Color(0.793, 0.904, 1), intensity: 0.5 });
    fillLight.direction.set(-1.5, -0.5, -1).normalize();
    this.scene.add(fillLight);

    this._pbrMaterial = new StandardMaterial({
      color: Color.WHITE,
      roughness: 0.6,
      metallic: 0.0,
      normalScale: new Vector2D(1.0, 1.0),
    });

    this._sphereGeometry = new Sphere({
      radius: 1,
      widthSegments: 32,
      heightSegments: 24,
    }).getGeometryData();
    this._cubeGeometry = new Cube({ size: 1.5 }).getGeometryData();
    this._torusGeometry = new Torus({
      radius: 0.9,
      tube: 0.35,
      radialSegments: 24,
      tubularSegments: 32,
    }).getGeometryData();
    this._planeGeometry = new Ground({ width: 2, depth: 2 }).getGeometryData();

    this._previewObject = new Object3D("PreviewObject").setPosition(0, 0, 0);
    this._previewObject.geometry = this._sphereGeometry;
    this._previewObject.material = this._pbrMaterial;

    this.scene.add(this._previewObject);
  }

  public async updateTextures(
    diffuseCanvas: HTMLCanvasElement,
    normalCanvas: HTMLCanvasElement,
    roughnessCanvas: HTMLCanvasElement,
    normalStrength: number,
    metallicValue: number,
    roughnessValue: number,
  ): Promise<void> {
    if (!this._pbrMaterial) return;
    try {
      const diffuseBitmap = await createImageBitmap(diffuseCanvas);
      const normalBitmap = await createImageBitmap(normalCanvas);
      const roughnessBitmap = await createImageBitmap(roughnessCanvas);

      this._pbrMaterial.diffuseMap = Texture.fromImage(diffuseBitmap, { generateMipmaps: true });
      this._pbrMaterial.normalMap = Texture.fromImage(normalBitmap, { generateMipmaps: true });
      this._pbrMaterial.roughnessMap = Texture.fromImage(roughnessBitmap, {
        generateMipmaps: true,
      });

      this._pbrMaterial.normalScale.x = normalStrength;
      this._pbrMaterial.normalScale.y = normalStrength;
      this._pbrMaterial.metallic = metallicValue;
      this._pbrMaterial.roughness = roughnessValue;
    } catch (err) {
      console.error("Error updating 3D textures in SmallWorldMachine:", err);
    }
  }

  public updateGeometry(geomType: string): void {
    if (!this._previewObject) return;
    switch (geomType) {
      case "cube":
        this._previewObject.geometry = this._cubeGeometry;
        this._previewObject.rotation.set(0.4, 0.4, 0);
        break;
      case "torus":
        this._previewObject.geometry = this._torusGeometry;
        this._previewObject.rotation.set(0.5, 0, 0);
        break;
      case "plane":
        this._previewObject.geometry = this._planeGeometry;
        this._previewObject.rotation.set(Math.PI / 6, 0, 0);
        break;
      case "sphere":
      default:
        this._previewObject.geometry = this._sphereGeometry;
        this._previewObject.rotation.set(0, 0, 0);
        break;
    }
  }

  protected override update(deltaTime: number): void {
    this._time += deltaTime;
    if (this._previewObject) {
      if (this._previewObject.geometry !== this._planeGeometry) {
        this._previewObject.rotation.y += deltaTime * 0.45;
      } else {
        this._previewObject.rotation.y = Math.sin(this._time * 0.5) * 0.15;
      }
    }
    this.scene.update();
  }
}

export class MaterialStudio extends ForgeTool {
  private _app: MaterialStudioApp | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private readonly _controller = new MaterialStudioController();

  constructor(options: ForgeToolOptions = {}) {
    super(options);
    this._injectCSS();
    buildMaterialStudioUI(this._container);
    // delay bind logic to ensure DOM is ready
    setTimeout(() => this._controller.bind(), 100);
  }

  public getState(): unknown {
    return {};
  }

  public setState(_state: unknown): void {}

  private _injectCSS(): void {
    if (document.getElementById("material-studio-style")) return;
    const style = document.createElement("style");
    style.id = "material-studio-style";
    style.innerHTML = MATERIAL_STUDIO_CSS;
    document.head.appendChild(style);
  }

  public override mount(container: HTMLElement): void {
    super.mount(container);

    // Check if the canvas exists in our HTML
    this._canvas = this._container.querySelector("#SmallWorldMachinePreview") as HTMLCanvasElement;
    if (this._canvas) {
      this._app = new MaterialStudioApp("SmallWorldMachinePreview");
      this._controller.setApp(this._app);
      this._app.start().catch((err) => {
        console.error("Failed to start MaterialStudio engine:", err);
      });
    }
  }

  public override onPasteImage(base64: string): void {
    this._controller.onPasteImage(base64);
  }

  public override unmount(): void {
    super.unmount();
    if (this._app) {
      this._app.destroy();
      this._app = null;
      this._controller.setApp(null);
    }
    this._canvas = null;
  }

  public override resize(width: number, height: number): void {
    super.resize(width, height);
    if (this._app && this._app.renderer && this._app.camera && this._canvas) {
      if (this._canvas.clientWidth > 0 && this._canvas.clientHeight > 0) {
        this._canvas.width = this._canvas.clientWidth;
        this._canvas.height = this._canvas.clientHeight;
        this._app.camera.aspect = this._canvas.clientWidth / this._canvas.clientHeight;
        this._app.camera.updateProjectionMatrix();
        this._app.renderer.setSize(this._canvas.clientWidth, this._canvas.clientHeight);
      }
    }
  }
}
