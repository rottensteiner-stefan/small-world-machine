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
import type { CameraInterfaceData } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Behavior,
  CameraStrategyType,
  Color,
  ComputeToysImporter,
  CullMode,
  CustomShaderMaterial,
  DirectionalLight,
  ExternalShaderUniformBehavior,
  FPSController,
  GLSLSandboxImporter,
  Matrix4,
  Object3D,
  Plane,
  Quaternion,
  Raycaster,
  RendererType,
  ShadertoyImporter,
  Sphere,
  Vector2D,
  Vector3D,
  WireframeMaterial,
} from "@small-world-machine/engine";

/**
 * Radius of the gallery sphere. Every shader "monitor" is mounted on its INNER surface and
 * physically bent along this exact sphere: at full curvature the screen vertices lie ON the
 * wireframe sphere (see `ScreenCurvatureBehavior`). The sphere is deliberately kept small --
 * a smaller radius means each monitor spans a larger arc of the sphere, so the curvature is
 * clearly readable to a human eye. Together with the observer pressed against the inner wall
 * (not at the center) this is the "optical trick" of the showcase -- see docs/log.md.
 */
const GALLERY_RADIUS = 5.5;

/**
 * Small outward offset for the wireframe reference sphere: the screens at full curvature sit
 * EXACTLY on the GALLERY_RADIUS sphere, so the wireframe must be a hair outside (≈ 3 cm on a
 * 5.5 m sphere) to avoid z-fighting where screen edges coincide with wireframe lines. Visually
 * this keeps the "screens follow the wireframe line" effect intact.
 */
const WIREFRAME_RADIUS = GALLERY_RADIUS + 0.03;

/**
 * The fixed vantage of the observer: pressed with the back close to the inner wall on the +Z
 * side (R*0.78 ≈ 1.2 units off the wall), slightly below the equator. This is the "optical
 * trick" -- standing off-center inside the sphere makes the curvature of the surrounding
 * monitors readable. Returned to on every zoom-out (empty click / Esc).
 */
const OBSERVER_BASE = new Vector3D(0, -GALLERY_RADIUS * 0.44, GALLERY_RADIUS * 0.78);

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
 * Bends a screen's Plane geometry along the gallery sphere so it becomes a TRUE spherical
 * patch: at rest (`curvature = 1`) every vertex lies EXACTLY on the sphere (radius = gallery
 * radius), and the patch is aligned with the sphere's coordinate grid --
 *   • the LEFT and RIGHT edges run along LONGITUDE lines (meridians: constant yaw, pitch varies)
 *   • the TOP and BOTTOM edges run along LATITUDE lines (parallels: constant pitch, yaw varies)
 * This is the genuine, non-developable double curvature the concept demands -- "not just a
 * simple bending" -- and it is what makes a screen visibly hug the wireframe of the sphere
 * instead of merely bowing. On click-to-zoom the screen interpolates to `curvature = 0`, the
 * flat tangent plane (reading mode).
 *
 * The math mirrors the exact basis built in `_createScreen` (local +X = parallel tangent,
 * local +Y = meridian tangent, local +Z = -radial toward the center), so the computed
 * container-local targets land precisely on the meridians/parallels.
 */
class ScreenCurvatureBehavior extends Behavior {
  public targetCurvature: number = 1.0;
  private _curvature: number = 1.0;
  private _flatVertices: Float32Array = new Float32Array(0);
  /** Container-local coordinates of the exact on-sphere grid targets, one per flat vertex. */
  private _sphereVertices: Float32Array = new Float32Array(0);
  private readonly _radius: number;

  constructor(radius: number) {
    super();
    this._radius = radius;
  }

  public override onAttach(target: Object3D): void {
    super.onAttach(target);
    this._ensureReady();
  }

  public update(deltaTime: number): void {
    // Configure lazily so the per-screen grid targets are ready even if this behavior is attached
    // before its host is parented (which would previously silently leave screens flat).
    this._ensureReady();
    if (!this._ready) return;

    const diff = this.targetCurvature - this._curvature;
    if (Math.abs(diff) < 0.001) return;

    this._curvature += diff * Math.min(1, deltaTime * 6.0);
    if (Math.abs(this.targetCurvature - this._curvature) < 0.001) {
      this._curvature = this.targetCurvature;
    }
    this._bend();
  }

  private _ready: boolean = false;

  private _ensureReady(): void {
    if (this._ready) return;
    const target = this.target;
    // `target` is Behavior's union (camera | Object3D); only Object3D has geometry/parent.
    if (!target || !("geometry" in target)) return;
    const geometry = target.geometry;
    const container = target.parent;
    if (!geometry || !container) return;

    const R = this._radius;
    const mount = container.position;
    // Guard: the mount must sit on (or very close to) the gallery sphere for the math to be exact.
    const mountLen = Math.hypot(mount.x, mount.y, mount.z);
    if (Math.abs(mountLen - R) > 0.25) {
      console.warn(
        `[ScreenCurvature] ${container.name} mount is off the gallery sphere (|P|=${mountLen.toFixed(3)}, R=${R}); skipping bend.`,
      );
      return;
    }
    this._flatVertices = geometry.vertices.slice();

    // Derive the sphere's coordinate frame at the mount (the screen's parent container is
    // anchored on the inner wall at radius R, oriented in `_createScreen` from this same basis).
    const theta0 = Math.atan2(mount.x, -mount.z);
    const phi0 = Math.asin(mount.y / R);

    // Parallel tangent (direction of increasing yaw at constant pitch)
    const pTx = Math.cos(theta0);
    const pTz = Math.sin(theta0);
    // Meridian tangent (direction of increasing pitch at constant yaw)
    const mTx = -Math.sin(phi0) * Math.sin(theta0);
    const mTy = Math.cos(phi0);
    const mTz = Math.sin(phi0) * Math.cos(theta0);
    // Outward radial
    const rTx = mount.x / R;
    const rTy = mount.y / R;
    const rTz = mount.z / R;

    // The parallel contracts toward the poles (circumference R·cosφ), the meridian does not.
    // Using the world-proportional angular offsets keeps the screen's on-sphere footprint
    // equal to its flat size while its edges stay on meridians/parallels.
    const cosPhi0 = Math.cos(phi0);

    const flat = geometry.vertices;
    const sphere = new Float32Array(flat.length);
    for (let i = 0; i < flat.length; i += 3) {
      const u = flat[i]!; // lateral (width) offset in local space -> along the parallel
      const v = flat[i + 1]!; // vertical (height) offset in local space -> along the meridian

      const dTheta = cosPhi0 > 1e-6 ? u / (R * cosPhi0) : 0;
      const dPhi = v / R;

      const wct = Math.cos(theta0 + dTheta);
      const wst = Math.sin(theta0 + dTheta);
      const wcp = Math.cos(phi0 + dPhi);
      const wsp = Math.sin(phi0 + dPhi);
      // World point on the sphere at the grid offset from the mount
      const wx = R * wcp * wst;
      const wy = R * wsp;
      const wz = -R * wcp * wct;

      // Relative to the mount, projected onto the container-local axes (parallel, meridian, -radial).
      const dx = wx - mount.x;
      const dy = wy - mount.y;
      const dz = wz - mount.z;
      sphere[i] = dx * pTx + dz * pTz; // local +X (parallel)
      sphere[i + 1] = dx * mTx + dy * mTy + dz * mTz; // local +Y (meridian)
      sphere[i + 2] = -(dx * rTx + dy * rTy + dz * rTz); // local +Z = -radial (toward center)
    }
    this._sphereVertices = sphere;
    this._ready = true;
    this._bend();
  }

  private _bend(): void {
    const target = this.target as Object3D;
    const geometry = target.geometry;
    if (!geometry || this._sphereVertices.length === 0) return;

    const flat = this._flatVertices;
    const sphere = this._sphereVertices;
    const out = geometry.vertices;
    const c = this._curvature;

    for (let i = 0; i < flat.length; i++) {
      out[i] = flat[i]! + (sphere[i]! - flat[i]!) * c;
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

    // QA hook (browser-only, inert in Node): deterministic per-screen inspection for the
    // "go through every screen" audit -- orientation vs. the sphere grid and applied bend.
    if (typeof window !== "undefined") {
      (window as unknown as { __showcase24?: { report: () => Showcase24QAReport } }).__showcase24 =
        {
          report: (): Showcase24QAReport => this._qaReport(),
        };
    }
  }

  protected async setupScene(): Promise<void> {
    // Setup Camera -- the optical trick of this showcase: the observer does NOT stand at the
    // sphere's center, but is pressed with the back close to the inner wall (near +Z). From
    // that off-center vantage the monitors wrapping around the observer are seen at close range
    // under strong perspective, which is what makes their curvature (following the wireframe
    // sphere) actually readable. The FPS controller keeps the observer fixed in place but
    // allows free 360° Mouselook. The initial view (theta 0) points across the chamber (-Z).
    this.camera.position.copyFrom(OBSERVER_BASE);
    this.camera.setStrategy(CameraStrategyType.FPS);

    const fps = new FPSController({
      input: this.input,
      enableMovement: false,
      enableVertical: false,
      enableCollision: false,
    });
    this.camera.addBehavior(fps);

    const zoomBehavior = new CameraZoomBehavior(OBSERVER_BASE, fps);
    this.camera.addBehavior(zoomBehavior);

    // Basic Light
    const dirLight = new DirectionalLight({ color: new Color(1, 1, 1), intensity: 1.0 });
    dirLight.direction.set(-1, -1, -1);
    this.scene.add(dirLight);

    // Fill Light for the right side
    const dirLight2 = new DirectionalLight({ color: new Color(0.904, 0.904, 1), intensity: 0.5 });
    dirLight2.direction.set(1, -0.5, -1);
    this.scene.add(dirLight2);

    // Ambient Light to illuminate dark metallic surfaces
    const ambLight = new AmbientLight({ color: new Color(1, 1, 1), intensity: 0.3 });
    this.scene.add(ambLight);

    // Wireframe sphere: the "structure" the curved screens are glued to -- the screens bend
    // exactly along this sphere's lines, so it doubles as the curvature reference.
    const wireSphere = new Object3D("wireSphere");
    wireSphere.geometry = new Sphere({
      radius: WIREFRAME_RADIUS,
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

    this._buildSurrounding([
      shadertoyMat1,
      sandboxMat,
      shadertoyMat2,
      toonMat,
      voronoiMat,
      asciiMat,
      sinCityMat,
      codeTunnelMat,
    ]);
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

    this._buildSurrounding([
      wMat1,
      wMat2,
      wMat3,
      toonMat,
      hexMat,
      matrixMat,
      sinCityMat,
      codeTunnelMat,
    ]);
  }

  /**
   * Distributes the shader monitors over the FULL inner surface (3 rings × 8 monitors, 45° apart
   * around the sphere). A surrounding shell -- rather than a frontal cluster -- is essential for
   * the off-center observer stance: the monitors tearing around the observer are then seen at
   * close range and heavily foreshortened, so their curvature along the wireframe sphere becomes
   * unmistakable. The shader set is rotated per ring so adjacent monitors never repeat.
   */
  private _buildSurrounding(materials: CustomShaderMaterial[]): void {
    // Three concentric rings around the full 360° of the inner surface: upper (+35°), mid (0°) and
    // lower (-35°). 8 monitors per ring, 45° apart -- wide enough that no monitor overlaps the next.
    const ringPitches = [(Math.PI * 35) / 180, 0, (-Math.PI * 35) / 180];
    for (let ring = 0; ring < ringPitches.length; ring++) {
      const pitch = ringPitches[ring]!;
      for (let k = 0; k < 8; k++) {
        const yaw = (k / 8) * Math.PI * 2;
        this._createScreen(yaw, pitch, materials[(ring + k) % materials.length]!);
      }
    }
  }

  private _createScreen(yaw: number, pitch: number, material: CustomShaderMaterial): void {
    const radius = GALLERY_RADIUS;
    // Parent container for the screen, anchored on the gallery sphere
    const container = new Object3D(`container_${yaw.toFixed(2)}_${pitch.toFixed(2)}`);

    // Position it in a spherical layout on the inner surface
    const x = radius * Math.cos(pitch) * Math.sin(yaw);
    const y = radius * Math.sin(pitch);
    const z = -radius * Math.cos(pitch) * Math.cos(yaw);

    container.position.set(x, y, z);

    // Orient the screen EXPLICITLY so its local axes lie in the sphere's coordinate grid --
    // local +X along the PARALLEL (lat-constant) direction, local +Y along the MERIDIAN
    // (longitude-constant) direction, local +Z pointing at the sphere's center (the observer
    // stands inside). `ScreenCurvatureBehavior` bends the plane along exactly this basis, so
    // the screen's left/right edges follow LONGITUDE lines (meridians) and its top/bottom edges
    // LATITUDE lines (parallels) -- the genuine non-developable curvature of the inner surface,
    // not a simple single-axis bending.
    const theta0 = Math.atan2(x, -z);
    const phi0 = Math.asin(y / GALLERY_RADIUS);
    const pTx = Math.cos(theta0);
    const pTy = 0;
    const pTz = Math.sin(theta0); // parallel tangent (increasing yaw)
    const mTx = -Math.sin(phi0) * Math.sin(theta0);
    const mTy = Math.cos(phi0);
    const mTz = Math.sin(phi0) * Math.cos(theta0); // meridian tangent (increasing pitch)
    const rTx = x / GALLERY_RADIUS;
    const rTy = y / GALLERY_RADIUS;
    const rTz = z / GALLERY_RADIUS; // outward radial
    const basis = new Matrix4();
    basis.data[0] = pTx;
    basis.data[1] = pTy;
    basis.data[2] = pTz;
    basis.data[4] = mTx;
    basis.data[5] = mTy;
    basis.data[6] = mTz;
    basis.data[8] = -rTx;
    basis.data[9] = -rTy;
    basis.data[10] = -rTz;
    container.quaternion = new Quaternion().setFromRotationMatrix(basis);

    // Screen: glued to the sphere's curvature at rest, flattens on click
    const screen = new Object3D(`screen_${yaw.toFixed(2)}_${pitch.toFixed(2)}`);
    screen.geometry = new Plane({
      width: 3,
      height: 2.25,
      widthSegments: 16,
      heightSegments: 12,
    }).getGeometryData();
    screen.material = material;
    container.add(screen);
    screen.addBehavior(new ExternalShaderUniformBehavior(800, 600));
    screen.addBehavior(new ScreenCurvatureBehavior(radius));

    this.scene.add(container);
  }

  protected override update(): void {
    // Engine base update takes care of scene and behaviors
  }

  private _qaReport(): Showcase24QAReport {
    const screens: Showcase24ScreenQA[] = [];
    for (const container of this.scene.objects) {
      if (!container.name.startsWith("container_")) continue;
      const screen = container.children.find((c) => c.name.startsWith("screen_"));
      if (!screen || !screen.geometry) continue;

      // Actual local axes (rotation-only) of the container, read from its world matrix.
      const origin = new Vector3D();
      container.worldMatrix.transformVector(new Vector3D(0, 0, 0), origin);
      const eY = new Vector3D();
      container.worldMatrix
        .transformVector(new Vector3D(0, 1, 0), eY)
        .sub(origin)
        .normalize();
      const eZ = new Vector3D();
      container.worldMatrix
        .transformVector(new Vector3D(0, 0, 1), eZ)
        .sub(origin)
        .normalize();

      const R = GALLERY_RADIUS;
      const t0 = Math.atan2(container.position.x, -container.position.z);
      const p0 = Math.asin(container.position.y / R);
      const meridian = new Vector3D(
        -Math.sin(p0) * Math.sin(t0),
        Math.cos(p0),
        Math.sin(p0) * Math.cos(t0),
      ).normalize();
      const inward = new Vector3D(
        -container.position.x / R,
        -container.position.y / R,
        -container.position.z / R,
      );

      // One width-edge vertex: the vertex with the largest |local x| near the mid height. Its
      // live local coords prove the spherical bend is applied -- a flat panel keeps x = 1.5
      // with z = 0, a bent one moves to x ≈ 1.482 with z ≈ +0.20 (toward the sphere's center).
      let probe: [number, number, number] = [0, 0, 0];
      let bestX = 0;
      const v = screen.geometry.vertices;
      for (let i = 0; i < v.length; i += 3) {
        const ax = Math.abs(v[i]!);
        if (ax > bestX && Math.abs(v[i + 1]!) < 0.05) {
          bestX = ax;
          probe = [v[i]!, v[i + 1]!, v[i + 2]!];
        }
      }

      const dCenterWorld = container.position.clone().sub(OBSERVER_BASE).length();
      const probeWorld = new Vector3D(probe[0], probe[1], probe[2]);
      container.worldMatrix.transformVector(probeWorld, probeWorld);
      const dEdgeWorld = probeWorld.sub(OBSERVER_BASE).length();

      screens.push({
        name: container.name,
        mount: [container.position.x, container.position.y, container.position.z],
        yawDeg: (t0 * 180) / Math.PI,
        pitchDeg: (p0 * 180) / Math.PI,
        yDotMeridian: Number(eY.dot(meridian).toFixed(4)),
        zDotInward: Number(eZ.dot(inward).toFixed(4)),
        probeEdge: probe.map((n) => Number(n.toFixed(3))) as [number, number, number],
        distObserverToEdge: Number(dEdgeWorld.toFixed(3)),
        distObserverToCenter: Number(dCenterWorld.toFixed(3)),
      });
    }
    return {
      radius: GALLERY_RADIUS,
      observer: [OBSERVER_BASE.x, OBSERVER_BASE.y, OBSERVER_BASE.z],
      screens,
    };
  }
}

interface Showcase24ScreenQA {
  /** Container name, encoded "container_${yaw}_${pitch}" */
  name: string;
  mount: [number, number, number];
  yawDeg: number;
  pitchDeg: number;
  /** Container local +Y · meridian tangent — |≈1| proves the height axis runs along a longitude. */
  yDotMeridian: number;
  /** Container local +Z · (toward sphere center) — ≈ +1 proves the screen faces the center. */
  zDotInward: number;
  /** Live local coords of a width-edge vertex — z ≈ +0.20 at rest proves the spherical bend is applied. */
  probeEdge: [number, number, number];
  /** Distance from the observer to the (bent) screen edge in world units. */
  distObserverToEdge: number;
  /** Distance from the observer to the screen center (= its mount) in world units. */
  distObserverToCenter: number;
}

interface Showcase24QAReport {
  radius: number;
  observer: [number, number, number];
  screens: Showcase24ScreenQA[];
}

function init(): void {
  const container = document.getElementById("container") as HTMLElement;
  container.innerHTML = '<canvas id="canvas23"></canvas>';

  const engine = new Showcase24(document.getElementById("canvas23") as HTMLElement);
  engine.start().catch((err: unknown) => console.error("[Showcase24] Failed to start:", err));
}

init();
