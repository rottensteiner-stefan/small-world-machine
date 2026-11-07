import type { EngineOptions, BloomElement } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  BoundingBox,
  CameraStrategyType,
  Color,
  Cube,
  DirectionalLight,
  DraggableBehavior,
  FlyController,
  HoverBehavior,
  Object3D,
  OrbitController,
  PostProcessingEffectType,
  RendererType,
  StandardMaterial,
  Texture,
  Vector3D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";
import type { ColorPalette, GlowColorName, PickingLabSettings } from "./Hud.js";
import { PickingLabHud, defaultPickingLabSettings } from "./Hud.js";

export class Showcase extends AbstractShowcase {
  protected override defaultCameraController = "none" as const;

  private _hud: PickingLabHud | undefined;
  private _settings: PickingLabSettings = defaultPickingLabSettings();
  private _cubes: Object3D[] = [];
  private _homePositions: Map<Object3D, Vector3D> = new Map();
  private _hoverBehaviors: Map<Object3D, HoverBehavior> = new Map();
  private _dragBehaviors: Map<Object3D, DraggableBehavior> = new Map();
  private _sharedMaterial: StandardMaterial | undefined;
  private _hexTexture: Texture | undefined;
  private _dirLight: DirectionalLight | undefined;
  private _bloom: BloomElement | undefined;
  private _orbitController: OrbitController | undefined;
  private _flyController: FlyController | undefined;

  // Wave impulse animation
  private _waveActive: boolean = false;
  private _waveTime: number = 0;
  private _waveOrigin: Vector3D = new Vector3D(0, 0, 0);

  // Position return animation
  private _resettingPositions: boolean = false;

  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      ...options,
    });
  }

  private async _generateHexTexture(): Promise<Texture> {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;

    // Background
    ctx.fillStyle = "#111122";
    ctx.fillRect(0, 0, 256, 256);

    // Grid lines
    ctx.strokeStyle = "#334466";
    ctx.lineWidth = 4;
    for (let i = 0; i <= 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }

    // Stylized emblem in the center
    ctx.fillStyle = "#ffaa00";
    ctx.beginPath();
    ctx.arc(128, 128, 64, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#111122";
    ctx.beginPath();
    ctx.arc(128, 128, 48, 0, Math.PI * 2);
    ctx.fill();

    const bitmap = await createImageBitmap(canvas);
    return Texture.fromImage(bitmap, { generateMipmaps: true });
  }

  private _getGlowColor(name: GlowColorName): Color {
    switch (name) {
      case "cyan":
        return new Color(0.1, 0.8, 1.0);
      case "purple":
        return new Color(0.85, 0.2, 1.0);
      case "amber":
        return new Color(1.0, 0.65, 0.1);
      case "lime":
        return new Color(0.4, 1.0, 0.2);
    }
  }

  private _getRandomColor(palette: ColorPalette): Color {
    switch (palette) {
      case "cyber": {
        const colors = [
          new Color(0.0, 0.95, 1.0),
          new Color(1.0, 0.05, 0.6),
          new Color(0.6, 0.1, 1.0),
          new Color(1.0, 0.9, 0.0),
        ];
        return colors[Math.floor(Math.random() * colors.length)]!;
      }
      case "sunset": {
        const colors = [
          new Color(0.96, 0.62, 0.04),
          new Color(0.92, 0.35, 0.05),
          new Color(0.88, 0.11, 0.28),
          new Color(0.99, 0.88, 0.28),
        ];
        return colors[Math.floor(Math.random() * colors.length)]!;
      }
      case "emerald": {
        const colors = [
          new Color(0.02, 0.59, 0.41),
          new Color(0.06, 0.72, 0.51),
          new Color(0.2, 0.83, 0.6),
          new Color(0.52, 0.8, 0.09),
        ];
        return colors[Math.floor(Math.random() * colors.length)]!;
      }
      case "minimal": {
        const shades = [
          new Color(0.95, 0.95, 0.98),
          new Color(0.7, 0.75, 0.82),
          new Color(0.45, 0.5, 0.6),
          new Color(0.25, 0.3, 0.4),
        ];
        return shades[Math.floor(Math.random() * shades.length)]!;
      }
      case "rainbow":
      default:
        return new Color(Math.random(), Math.random(), Math.random());
    }
  }

  protected async setupScene(): Promise<void> {
    this.setInitialCamera(new Vector3D(0, 16, 24), new Vector3D(0, 0, 0));

    // Post processing & Bloom
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = this._settings.bloom;
      bloom.intensity = this._settings.bloomIntensity;
      bloom.threshold = 0.7;
      bloom.radius = 1.2;
      this._bloom = bloom;
    }

    // Camera Controllers: Orbit with drag-protection + Fly fallback
    this._orbitController = new OrbitController({
      input: this.input,
      rotateButton: "both",
      canRotate: (): boolean => !this.interactionManager?.activeObject,
    });
    this.camera.addBehavior(this._orbitController);

    this._flyController = new FlyController({
      input: this.input,
      moveSpeed: 10.0,
    });
    this._flyController.enabled = false;
    this.camera.addBehavior(this._flyController);

    // Lights
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.35 }));

    const dirLight = new DirectionalLight({ color: Color.WHITE, intensity: 1.2 });
    dirLight.position.set(12, 24, 12);
    dirLight.direction.set(-0.5, -1, -0.5).normalize();
    dirLight.castShadow = this._settings.shadows;
    this.scene.add(dirLight);
    this._dirLight = dirLight;

    // Materials
    this._hexTexture = await this._generateHexTexture();
    this._sharedMaterial = new StandardMaterial({
      color: new Color(0.8, 0.8, 0.9),
      diffuseMap: this._hexTexture,
      roughness: 0.35,
      metallic: 0.15,
    });

    // Build playground grid
    this._buildGrid(this._settings.gridSize, this._settings.spacing);

    // Setup interactive HUD
    this._hud = new PickingLabHud(this._settings, {
      onSettingsChange: (newSettings): void => {
        this._settings = { ...newSettings };
        this._applySettings();
      },
      onTriggerWave: (): void => {
        const hovered = this.interactionManager?.hoveredObject;
        if (hovered) {
          this._waveOrigin.copyFrom(hovered.position);
          this._waveOrigin.y = 0;
        } else {
          this._waveOrigin.set(0, 0, 0);
        }
        this._waveTime = 0;
        this._waveActive = true;
      },
      onRandomizeAllColors: (): void => {
        for (const cube of this._cubes) {
          if (cube.material === this._sharedMaterial) {
            cube.material = new StandardMaterial({
              color: new Color(0.8, 0.8, 0.9),
              diffuseMap: this._hexTexture,
              roughness: 0.35,
              metallic: 0.15,
            });
          }
          if (cube.material instanceof StandardMaterial) {
            cube.material.color.copyFrom(this._getRandomColor(this._settings.palette));
          }
        }
      },
      onResetPositions: (): void => {
        this._resettingPositions = true;
      },
      onGridSizeChange: (size: number): void => {
        this._settings.gridSize = size;
        this._buildGrid(size, this._settings.spacing);
      },
    });
  }

  private _buildGrid(gridSize: number, spacing: number): void {
    // Clean up previous cubes
    for (const cube of this._cubes) {
      this.scene.remove(cube);
    }
    this._cubes = [];
    this._homePositions.clear();
    this._hoverBehaviors.clear();
    this._dragBehaviors.clear();

    const offset = (gridSize * spacing) / 2 - spacing / 2;
    const cubeGeo = new Cube({ size: 1.0 }).getGeometryData();
    const glowCol = this._getGlowColor(this._settings.glowColor);

    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const mesh = new Object3D(`Cube_${x}_${z}`);
        mesh.geometry = cubeGeo;
        mesh.material = this._sharedMaterial!;
        const posX = x * spacing - offset;
        const posY = 0;
        const posZ = z * spacing - offset;
        mesh.setPosition(posX, posY, posZ);
        mesh.castShadow = this._settings.shadows;
        mesh.receiveShadow = true;
        mesh.isPickable = true;

        this._homePositions.set(mesh, new Vector3D(posX, posY, posZ));

        // Hover Behavior
        const hover = new HoverBehavior(this._settings.hoverScale);
        hover.emissiveColor.copyFrom(glowCol);
        hover.emissiveIntensity = this._settings.glowIntensity;
        hover.enabled = this._settings.hoverEnabled;
        mesh.addBehavior(hover);
        this._hoverBehaviors.set(mesh, hover);

        // Draggable Behavior
        const draggable = new DraggableBehavior(this.camera);
        draggable.mode = this._settings.dragMode;
        draggable.enabled = this._settings.dragEnabled;
        mesh.addBehavior(draggable);
        this._dragBehaviors.set(mesh, draggable);

        // Click interaction: change color permanently
        mesh.onPointerClick = (): void => {
          if (!this._settings.clickRecolorEnabled) return;
          if (mesh.material === this._sharedMaterial) {
            mesh.material = new StandardMaterial({
              color: new Color(0.8, 0.8, 0.9),
              diffuseMap: this._hexTexture,
              roughness: 0.35,
              metallic: 0.15,
            });
          }
          if (mesh.material instanceof StandardMaterial) {
            mesh.material.color.copyFrom(this._getRandomColor(this._settings.palette));
          }
        };

        this.scene.add(mesh);
        this._cubes.push(mesh);
      }
    }

    // Dynamic Octree setup
    const extent = (gridSize * spacing) / 2 + 10;
    const bounds = new BoundingBox(
      new Vector3D(-extent, -10, -extent),
      new Vector3D(extent, 40, extent),
    );
    this.scene.initOctrees(bounds, { maxObjects: 200 });
  }

  private _applySettings(): void {
    // 1. Hover settings
    const glowCol = this._getGlowColor(this._settings.glowColor);
    for (const hover of this._hoverBehaviors.values()) {
      hover.enabled = this._settings.hoverEnabled;
      hover.hoverMultiplier = this._settings.hoverScale;
      hover.emissiveIntensity = this._settings.glowIntensity;
      hover.emissiveColor.copyFrom(glowCol);
    }

    // 2. Drag settings
    for (const drag of this._dragBehaviors.values()) {
      drag.enabled = this._settings.dragEnabled;
      drag.mode = this._settings.dragMode;
    }

    // 3. Camera mode
    if (this._orbitController && this._flyController) {
      if (this._settings.cameraMode === "orbit") {
        this.camera.setStrategy(CameraStrategyType.DEFAULT);
        this._orbitController.enabled = true;
        this._flyController.enabled = false;
      } else {
        this.camera.setStrategy(CameraStrategyType.FPS);
        this._orbitController.enabled = false;
        this._flyController.enabled = true;
      }
    }

    // 4. Shadows & Bloom
    if (this._dirLight) {
      this._dirLight.castShadow = this._settings.shadows;
    }
    if (this._bloom) {
      this._bloom.enabled = this._settings.bloom;
      this._bloom.intensity = this._settings.bloomIntensity;
    }
  }

  public override destroy(): void {
    this._hud?.dispose();
    super.destroy();
  }

  public override onKeyDown(event: KeyboardEvent): void {
    if (this._hud?.handleKey(event)) {
      return;
    }
    super.onKeyDown(event);
  }

  protected override update(deltaTime: number): void {
    // 1. Procedural wave impulse
    if (this._waveActive) {
      this._waveTime += deltaTime;
      const speed = 14.0;
      const waveRadius = this._waveTime * speed;
      const wavelength = 3.5;
      let hasActiveWave = false;

      for (let i = 0; i < this._cubes.length; i++) {
        const cube = this._cubes[i]!;
        // Do not disrupt currently dragged object
        if (this._dragBehaviors.get(cube)?.isDragging) continue;

        const home = this._homePositions.get(cube);
        if (!home) continue;

        const dx = cube.position.x - this._waveOrigin.x;
        const dz = cube.position.z - this._waveOrigin.z;
        const dist = Math.hypot(dx, dz);

        const deltaDist = dist - waveRadius;
        if (Math.abs(deltaDist) < wavelength * 1.5) {
          hasActiveWave = true;
          const envelope = Math.max(0, 1.0 - Math.abs(deltaDist) / (wavelength * 1.5));
          const waveHeight = Math.sin((deltaDist / wavelength) * Math.PI * 2) * envelope * 2.2;
          cube.position.y = home.y + Math.max(0, waveHeight);
        } else if (cube.position.y > home.y + 0.01) {
          cube.position.y += (home.y - cube.position.y) * Math.min(1.0, 10.0 * deltaTime);
        } else {
          cube.position.y = home.y;
        }
      }

      if (!hasActiveWave && this._waveTime > 1.5) {
        this._waveActive = false;
        for (const cube of this._cubes) {
          const home = this._homePositions.get(cube);
          if (home && !this._dragBehaviors.get(cube)?.isDragging) {
            cube.position.y = home.y;
          }
        }
      }
    }

    // 2. Smooth position return (spring back to grid)
    if (this._resettingPositions) {
      let maxDistSq = 0;
      for (const cube of this._cubes) {
        if (this._dragBehaviors.get(cube)?.isDragging) continue;
        const home = this._homePositions.get(cube);
        if (!home) continue;

        cube.position.lerp(home, Math.min(1.0, 12.0 * deltaTime));
        const dSq = cube.position.distanceToSq(home);
        if (dSq > maxDistSq) maxDistSq = dSq;
      }
      if (maxDistSq < 0.001) {
        for (const cube of this._cubes) {
          const home = this._homePositions.get(cube);
          if (home) cube.position.copyFrom(home);
        }
        this._resettingPositions = false;
      }
    }

    // 3. Telemetry sync to HUD
    if (this._hud) {
      const activeObj = this.interactionManager?.activeObject;
      const hoveredObj = this.interactionManager?.hoveredObject;
      this._hud.updateStats({
        cubeCount: this._cubes.length,
        hoveredObject: hoveredObj?.name ?? "-",
        draggingObject: activeObj ? activeObj.name : "Idle",
        queryHits: this.interactionManager?.lastQueryHitsCount ?? 0,
      });
    }
  }
}

const app = new Showcase();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase19] Failed to start:", err));
