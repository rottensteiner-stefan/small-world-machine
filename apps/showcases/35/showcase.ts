import type { EngineOptions } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  CameraStrategyType,
  Color,
  DirectionalLight,
  Object3D,
  OrbitController,
  PointLight,
  RendererType,
  Sphere,
  StandardMaterial,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

const GRID_SIZE = 7;
const SPHERE_RADIUS = 0.55;
const SPACING = 1.4;

/**
 * Showcase 35: "PBR Sphere Grid"
 *
 * The classic metallic-roughness reference test (as used by the Khronos glTF Sample Viewer's
 * "MetalRoughSpheres"): a grid of identical spheres where metallic increases left-to-right and
 * roughness increases bottom-to-top, all sharing one base color. Lets the same shading model be
 * compared visually across WebGL1/WebGL2/WebGPU via `?rendererType=`.
 */
class Showcase35 extends AbstractShowcase {
  constructor(options: EngineOptions = {}) {
    super({
      canvasId: "SmallWorldMachine",
      rendererType: RendererType.BEST,
      fullscreen: true,
      ...options,
    });
  }

  protected override async setupScene(): Promise<void> {
    this.defaultFov = (45 * Math.PI) / 180;
    this.defaultFar = 100;
    this.configureCamera();
    this.camera.setStrategy(CameraStrategyType.HYBRID_SYNC);
    const center = ((GRID_SIZE - 1) * SPACING) / 2;
    // Zoomed out further than a tight frame would need, so the grid sits well clear of the
    // showcase-layout's title/subtitle overlay at the top and the copyright bar at the bottom.
    this.camera.position.set(center, center, 20);
    this.camera.target.set(center, center, 0);
    this.camera.addBehavior(new OrbitController({ input: this.input }));

    this.renderer.setClearColor(new Color(0.05, 0.05, 0.07));

    // Deliberately dim ambient plus one directional key light so metallic/roughness differences
    // stay legible -- a bright ambient term would wash the whole grid to a flat grey.
    this.scene.add(new AmbientLight({ color: new Color(0.73, 0.73, 0.762), intensity: 0.25 }));

    const key = new DirectionalLight({ color: new Color(1, 0.986, 0.953), intensity: 2.2 });
    key.direction.set(-0.4, -0.6, -0.7);
    this.scene.add(key);

    // A second, cooler point light from the opposite side to give the rougher/dielectric
    // spheres a visible highlight too, not just the mirror-like top-right corner.
    const fill = new PointLight({ color: new Color(0.793, 0.877, 1), intensity: 12 });
    fill.position.set(center + 6, center + 3, 8);
    this.scene.add(fill);

    const sphereGeometry = new Sphere({
      radius: SPHERE_RADIUS,
      widthSegments: 32,
      heightSegments: 24,
    }).getGeometryData();

    for (let row = 0; row < GRID_SIZE; row++) {
      const roughness = row / (GRID_SIZE - 1);
      for (let col = 0; col < GRID_SIZE; col++) {
        const metallic = col / (GRID_SIZE - 1);

        const sphere = new Object3D(`Sphere_${row}_${col}`);
        sphere.geometry = sphereGeometry;
        sphere.material = new StandardMaterial({
          color: new Color(0.8, 0.1, 0.1),
          metallic,
          roughness: Math.max(roughness, 0.05),
        });
        sphere.position.set(col * SPACING, row * SPACING, 0);
        this.scene.add(sphere);
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Bootstrap the example
// ----------------------------------------------------------------------------
const app = new Showcase35();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase35] Failed to start:", err));
