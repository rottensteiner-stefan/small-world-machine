import SHADERTOY_STAR_NEST from "./assets/shadertoy_star_nest.glsl?raw";
import GLSLSANDBOX_PLASMA from "./assets/glslsandbox_plasma.glsl?raw";
import SHADERTOY_FRACTAL from "./assets/shadertoy_fractal.glsl?raw";
import SHADERTOY_TOON_CREATURE from "./assets/shadertoy_toon_creature.glsl?raw";
import SHADERTOY_VORONOI_STAINED_GLASS from "./assets/shadertoy_voronoi_stained_glass.glsl?raw";
import GLSLSANDBOX_RETRO_ASCII from "./assets/glslsandbox_retro_ascii.glsl?raw";
import SHADERTOY_SIN_CITY from "./assets/shadertoy_sin_city.glsl?raw";
import SHADERTOY_CODE_TUNNEL from "./assets/shadertoy_code_tunnel.glsl?raw";
import COMPUTETOYS_SYNTHWAVE from "./assets/computetoys_synthwave.wgsl?raw";
import COMPUTETOYS_KISHIMISU from "./assets/computetoys_kishimisu.wgsl?raw";
import COMPUTETOYS_RAYMARCH from "./assets/computetoys_raymarch.wgsl?raw";
import COMPUTETOYS_TOON_SHAPE from "./assets/computetoys_toon_shape.wgsl?raw";
import COMPUTETOYS_HEX_HOLOGRAM from "./assets/computetoys_hex_hologram.wgsl?raw";
import COMPUTETOYS_MATRIX_RAIN from "./assets/computetoys_matrix_rain.wgsl?raw";
import COMPUTETOYS_SIN_CITY from "./assets/computetoys_sin_city.wgsl?raw";
import COMPUTETOYS_CODE_TUNNEL from "./assets/computetoys_code_tunnel.wgsl?raw";
import {
  AbstractShowcase,
  AmbientLight,
  Behavior,
  CameraInterfaceData,
  CameraStrategyType,
  Color,
  ComputeToysImporter,
  CullMode,
  CustomShaderMaterial,
  DirectionalLight,
  ExternalShaderUniformBehavior,
  FPSController,
  GLSLSandboxImporter,
  Object3D,
  Plane,
  Raycaster,
  RendererType,
  ShadertoyImporter,
  Sphere,
  Vector2D,
  Vector3D,
  WireframeMaterial,
} from "@small-world-machine/engine";

class BobbingBehavior extends Behavior {
  private _timeOffset: number = Math.random() * Math.PI * 2;
  private _initialY: number = 0;
  private _speed: number = 1.0 + Math.random() * 0.5;

  public override onAttach(target: Object3D): void {
    super.onAttach(target);
    this._initialY = target.position.y;
  }

  public update(deltaTime: number): void {
    if (!this.target) return;
    this._timeOffset += deltaTime * this._speed;
    (this.target as Object3D).position.y = this._initialY + Math.sin(this._timeOffset) * 0.15;
  }
}

class CameraZoomBehavior extends Behavior {
  public basePosition: Vector3D;
  public targetPosition: Vector3D | null = null;
  public targetLook: Vector3D | null = null;
  public isFocused: boolean = false;
  public fpsController: FPSController;

  constructor(basePos: Vector3D, fps: FPSController) {
    super();
    this.basePosition = basePos.clone();
    this.fpsController = fps;
  }

  public update(deltaTime: number): void {
    if (!this.target) return;
    const cam = this.target as unknown as CameraInterfaceData;

    let goalPos = this.basePosition;

    if (this.targetPosition) {
      goalPos = this.targetPosition;

      if (this.fpsController.enabled) {
        this.fpsController.enabled = false;
        this.isFocused = true;
      }
    } else if (this.isFocused) {
      // Zooming out
      const dist =
        Math.abs(goalPos.x - cam.position.x) +
        Math.abs(goalPos.y - cam.position.y) +
        Math.abs(goalPos.z - cam.position.z);
      if (dist < 0.2) {
        this.isFocused = false;
        this.fpsController.enabled = true;
      }
    }

    // Smooth damp camera position
    cam.position.x += (goalPos.x - cam.position.x) * deltaTime * 5.0;
    cam.position.y += (goalPos.y - cam.position.y) * deltaTime * 5.0;
    cam.position.z += (goalPos.z - cam.position.z) * deltaTime * 5.0;

    // Smooth damp camera target angles
    if (this.targetLook) {
      const lookDirX = this.targetLook.x - cam.position.x;
      const lookDirY = this.targetLook.y - cam.position.y;
      const lookDirZ = this.targetLook.z - cam.position.z;

      const dist = Math.sqrt(lookDirX * lookDirX + lookDirY * lookDirY + lookDirZ * lookDirZ);
      if (dist > 0.001) {
        const targetTheta = Math.atan2(lookDirX / dist, -lookDirZ / dist);
        const targetPhi = Math.asin(lookDirY / dist);

        let dTheta = targetTheta - cam.theta;
        while (dTheta > Math.PI) dTheta -= Math.PI * 2;
        while (dTheta < -Math.PI) dTheta += Math.PI * 2;

        cam.theta += dTheta * deltaTime * 5.0;
        cam.phi += (targetPhi - cam.phi) * deltaTime * 5.0;
      }
    }
  }
}

/**
 * Bends a screen's Plane geometry so it hugs the inside of the gallery sphere
 * (curvature = 1) or lies perfectly flat (curvature = 0), animating between
 * the two whenever `targetCurvature` changes (e.g. on click-to-zoom).
 */
class ScreenCurvatureBehavior extends Behavior {
  public targetCurvature: number = 1.0;
  private _curvature: number = 1.0;
  private _flatVertices: Float32Array = new Float32Array(0);
  private readonly _radius: number;

  constructor(radius: number) {
    super();
    this._radius = radius;
  }

  public override onAttach(target: Object3D): void {
    super.onAttach(target);
    if (target.geometry) {
      this._flatVertices = target.geometry.vertices.slice();
    }
    this._bend();
  }

  public update(deltaTime: number): void {
    const diff = this.targetCurvature - this._curvature;
    if (Math.abs(diff) < 0.001) return;

    this._curvature += diff * Math.min(1, deltaTime * 6.0);
    if (Math.abs(this.targetCurvature - this._curvature) < 0.001) {
      this._curvature = this.targetCurvature;
    }
    this._bend();
  }

  private _bend(): void {
    const target = this.target as Object3D;
    const geometry = target.geometry;
    if (!geometry) return;

    const flat = this._flatVertices;
    const out = geometry.vertices;
    const radius = this._radius;

    for (let i = 0; i < flat.length; i += 3) {
      const x = flat[i]!;
      const y = flat[i + 1]!;
      const rho = Math.sqrt(x * x + y * y);

      let bx = 0;
      let by = 0;
      let bz = 0;
      if (rho > 1e-6) {
        // Treat (x, y) as an arc-length offset on the sphere: bend it along
        // the great-circle direction so it curves toward the sphere's center
        // (local +Z, since the container already faces the center).
        const theta = rho / radius;
        const s = Math.sin(theta);
        bx = (radius * s * x) / rho;
        by = (radius * s * y) / rho;
        bz = radius * (1 - Math.cos(theta));
      }

      out[i] = x + (bx - x) * this._curvature;
      out[i + 1] = y + (by - y) * this._curvature;
      out[i + 2] = bz * this._curvature;
    }

    geometry.needsUpdate = true;
  }
}

class Showcase24 extends AbstractShowcase {
  private _api: "webgl2" | "webgpu";

  constructor(container: HTMLElement) {
    super({ canvasId: container.id, rendererType: RendererType.BEST });
    // Read back the *resolved* type -- AbstractShowcase may have overridden the default from a
    // `?rendererType=` URL param, and the gallery content must match what's actually rendering,
    // not just the pre-override default we passed in above.
    this._api = this.config.rendererType === RendererType.WEB_GPU ? "webgpu" : "webgl2";
  }

  protected async setupScene(): Promise<void> {
    // Setup Camera (center of the sphere)
    this.camera.position.set(0, 0, 0);
    this.camera.setStrategy(CameraStrategyType.FPS);

    const fps = new FPSController({
      input: this.input,
      audio: this.audio,
      enableMovement: false,
      enableVertical: false,
      enableCollision: false,
    });
    this.camera.addBehavior(fps);

    const zoomBehavior = new CameraZoomBehavior(new Vector3D(0, 0, 0), fps);
    this.camera.addBehavior(zoomBehavior);

    // Basic Light
    const dirLight = new DirectionalLight({ color: new Color(1, 1, 1), intensity: 1.0 });
    dirLight.direction.set(-1, -1, -1);
    this.scene.add(dirLight);

    // Fill Light for the right side
    const dirLight2 = new DirectionalLight({ color: new Color(0.8, 0.8, 1.0), intensity: 0.5 });
    dirLight2.direction.set(1, -0.5, -1);
    this.scene.add(dirLight2);

    // Ambient Light to illuminate dark metallic surfaces
    const ambLight = new AmbientLight({ color: new Color(1, 1, 1), intensity: 0.3 });
    this.scene.add(ambLight);

    // Wireframe sphere: the "structure" the curved screens are glued to
    const wireSphere = new Object3D("wireSphere");
    wireSphere.geometry = new Sphere({
      radius: 10,
      widthSegments: 32,
      heightSegments: 24,
    }).getGeometryData();
    wireSphere.material = new WireframeMaterial(new Color(0.3, 0.6, 1.0));
    this.scene.add(wireSphere);

    // Build the Gallery Billboards based on API
    this._api = this.renderer.type === RendererType.WEB_GPU ? "webgpu" : "webgl2";
    if (this._api === "webgl2") {
      this._buildWebGL2Gallery();
    } else {
      this._buildWebGPUGallery();
    }

    // Setup Interaction
    const raycaster = new Raycaster();
    const mouseCoords = new Vector2D();
    const canvas = document.getElementById("canvas23") as HTMLCanvasElement;

    window.addEventListener("mousedown", (e) => {
      try {
        // Don't intercept clicks on the UI
        const targetElement = e.target as HTMLElement;
        if (
          targetElement.tagName === "INPUT" ||
          targetElement.tagName === "A" ||
          targetElement.tagName === "LABEL"
        ) {
          return;
        }

        const rect = canvas.getBoundingClientRect();
        mouseCoords.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseCoords.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouseCoords, this.camera);

        // Flatten scene to find screens
        const interactables: Object3D[] = [];
        for (const container of this.scene.objects) {
          if (container.name.startsWith("container_")) {
            const screen = container.children.find((c) => c.name.startsWith("screen_"));
            if (screen) {
              screen.computeBounds(); // Update bounds to current world matrix!
              interactables.push(screen);
            }
          }
        }

        const intersects = raycaster.intersectObjects(interactables, true);
        const firstHit = intersects[0];

        if (firstHit) {
          const hit = firstHit.object;
          const container = hit.parent; // container_x_y

          if (container) {
            const zoomBehavior = this.camera.behaviors.find(
              (b) => b instanceof CameraZoomBehavior,
            ) as CameraZoomBehavior;
            if (zoomBehavior) {
              // Zoom into the screen specifically
              const screen = container.children.find((c) => c.name.startsWith("screen_"));
              if (screen) {
                // Calculate position slightly in front of the screen
                const screenWorldPos = container.position.clone();
                const zoomDist = 2.5; // distance from screen

                // For a sphere layout, the normal pointing towards the center is -container.position.normalize()
                // The vector from center to screen is just the normalized position.
                const dir = container.position.clone().normalize();

                zoomBehavior.targetPosition = new Vector3D(
                  screenWorldPos.x - dir.x * zoomDist,
                  screenWorldPos.y - dir.y * zoomDist,
                  screenWorldPos.z - dir.z * zoomDist,
                );
                // Look directly at the screen's center
                zoomBehavior.targetLook = screenWorldPos;
                this._setFocusedScreen(screen);
              }
            }
          }
        } else {
          // Clicked on nothing, zoom out
          const zoomBehavior = this.camera.behaviors.find(
            (b) => b instanceof CameraZoomBehavior,
          ) as CameraZoomBehavior;
          if (zoomBehavior) {
            zoomBehavior.targetPosition = null;
            zoomBehavior.targetLook = null;
          }
          this._setFocusedScreen(null);
        }
      } catch (err) {
        console.error("ERROR in mousedown handler:", err);
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const zoomBehavior = this.camera.behaviors.find(
          (b) => b instanceof CameraZoomBehavior,
        ) as CameraZoomBehavior;
        if (zoomBehavior) {
          zoomBehavior.targetPosition = null;
          zoomBehavior.targetLook = null;
        }
        this._setFocusedScreen(null);
      }
    });
  }

  private _focusedScreen: Object3D | null = null;

  private _setFocusedScreen(screen: Object3D | null): void {
    if (this._focusedScreen === screen) return;

    if (this._focusedScreen) {
      const behavior = this._focusedScreen.behaviors.find(
        (b) => b instanceof ScreenCurvatureBehavior,
      ) as ScreenCurvatureBehavior | undefined;
      if (behavior) behavior.targetCurvature = 1.0;
    }

    this._focusedScreen = screen;

    if (screen) {
      const behavior = screen.behaviors.find((b) => b instanceof ScreenCurvatureBehavior) as
        ScreenCurvatureBehavior | undefined;
      if (behavior) behavior.targetCurvature = 0.0;
    }
  }

  private _buildWebGL2Gallery(): void {
    const shadertoyMat1 = new CustomShaderMaterial(
      new ShadertoyImporter().parse(SHADERTOY_STAR_NEST),
    );
    const sandboxMat = new CustomShaderMaterial(
      new GLSLSandboxImporter().parse(GLSLSANDBOX_PLASMA),
    );
    const shadertoyMat2 = new CustomShaderMaterial(
      new ShadertoyImporter().parse(SHADERTOY_FRACTAL),
    );
    const toonMat = new CustomShaderMaterial(
      new ShadertoyImporter().parse(SHADERTOY_TOON_CREATURE),
    );
    const voronoiMat = new CustomShaderMaterial(
      new ShadertoyImporter().parse(SHADERTOY_VORONOI_STAINED_GLASS),
    );
    const asciiMat = new CustomShaderMaterial(
      new GLSLSandboxImporter().parse(GLSLSANDBOX_RETRO_ASCII),
    );
    const sinCityMat = new CustomShaderMaterial(new ShadertoyImporter().parse(SHADERTOY_SIN_CITY));
    const codeTunnelMat = new CustomShaderMaterial(
      new ShadertoyImporter().parse(SHADERTOY_CODE_TUNNEL),
    );

    for (const mat of [
      shadertoyMat1,
      sandboxMat,
      shadertoyMat2,
      toonMat,
      voronoiMat,
      asciiMat,
      sinCityMat,
      codeTunnelMat,
    ]) {
      mat.cullMode = CullMode.NONE;
    }

    // Top row
    this._createScreen(-Math.PI / 6, Math.PI / 6, shadertoyMat1);
    this._createScreen(0, Math.PI / 6, shadertoyMat2);
    this._createScreen(Math.PI / 6, Math.PI / 6, sandboxMat);

    // Middle row
    this._createScreen(-Math.PI / 6, 0, toonMat);
    this._createScreen(0, 0, asciiMat);
    this._createScreen(Math.PI / 6, 0, voronoiMat);

    // Bottom row
    this._createScreen(-Math.PI / 12, -Math.PI / 6, sinCityMat);
    this._createScreen(Math.PI / 12, -Math.PI / 6, codeTunnelMat);
  }

  private _buildWebGPUGallery(): void {
    const wMat1 = new CustomShaderMaterial(new ComputeToysImporter().parse(COMPUTETOYS_SYNTHWAVE));
    const wMat2 = new CustomShaderMaterial(new ComputeToysImporter().parse(COMPUTETOYS_KISHIMISU));
    const wMat3 = new CustomShaderMaterial(new ComputeToysImporter().parse(COMPUTETOYS_RAYMARCH));
    const toonMat = new CustomShaderMaterial(
      new ComputeToysImporter().parse(COMPUTETOYS_TOON_SHAPE),
    );
    const hexMat = new CustomShaderMaterial(
      new ComputeToysImporter().parse(COMPUTETOYS_HEX_HOLOGRAM),
    );
    const matrixMat = new CustomShaderMaterial(
      new ComputeToysImporter().parse(COMPUTETOYS_MATRIX_RAIN),
    );
    const sinCityMat = new CustomShaderMaterial(
      new ComputeToysImporter().parse(COMPUTETOYS_SIN_CITY),
    );
    const codeTunnelMat = new CustomShaderMaterial(
      new ComputeToysImporter().parse(COMPUTETOYS_CODE_TUNNEL),
    );

    for (const mat of [
      wMat1,
      wMat2,
      wMat3,
      toonMat,
      hexMat,
      matrixMat,
      sinCityMat,
      codeTunnelMat,
    ]) {
      mat.cullMode = CullMode.NONE;
    }

    // Top row
    this._createScreen(-Math.PI / 6, Math.PI / 6, wMat1);
    this._createScreen(0, Math.PI / 6, wMat2);
    this._createScreen(Math.PI / 6, Math.PI / 6, wMat3);

    // Middle row
    this._createScreen(-Math.PI / 6, 0, toonMat);
    this._createScreen(0, 0, hexMat);
    this._createScreen(Math.PI / 6, 0, matrixMat);

    // Bottom row
    this._createScreen(-Math.PI / 12, -Math.PI / 6, sinCityMat);
    this._createScreen(Math.PI / 12, -Math.PI / 6, codeTunnelMat);
  }

  private _createScreen(yaw: number, pitch: number, material: CustomShaderMaterial): void {
    const radius = 10;
    // Parent container for the screen, anchored on the gallery sphere
    const container = new Object3D(`container_${yaw.toFixed(2)}_${pitch.toFixed(2)}`);

    // Position it in a spherical layout
    const x = radius * Math.cos(pitch) * Math.sin(yaw);
    const y = radius * Math.sin(pitch);
    const z = -radius * Math.cos(pitch) * Math.cos(yaw);

    container.position.set(x, y, z);
    container.rotation.set(pitch, -yaw, 0);

    // Add Bobbing Animation
    container.addBehavior(new BobbingBehavior());

    // Screen: glued to the sphere's curvature at rest, flattens on click
    const screen = new Object3D(`screen_${yaw.toFixed(2)}_${pitch.toFixed(2)}`);
    screen.geometry = new Plane({
      width: 4,
      height: 3,
      widthSegments: 16,
      heightSegments: 12,
    }).getGeometryData();
    screen.material = material;
    screen.addBehavior(new ExternalShaderUniformBehavior(800, 600));
    screen.addBehavior(new ScreenCurvatureBehavior(radius));
    container.add(screen);

    this.scene.add(container);
  }

  protected override update(): void {
    // Engine base update takes care of scene and behaviors
  }
}

function init(): void {
  const container = document.getElementById("container") as HTMLElement;
  container.innerHTML = '<canvas id="canvas23"></canvas>';

  const engine = new Showcase24(document.getElementById("canvas23") as HTMLElement);
  engine.start().catch((err: unknown) => console.error("[Showcase24] Failed to start:", err));
}

init();
