import {
  AbstractShowcase,
  AmbientLight,
  BoundingBox,
  Color,
  Cube,
  DirectionalLight,
  DraggableBehavior,
  EngineOptions,
  HoverBehavior,
  Object3D,
  RendererType,
  StandardMaterial,
  Texture,
  Vector3D,
} from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

class Showcase19 extends AbstractShowcase {
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

    // A stylized symbol in the center
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

  protected async setupScene(): Promise<void> {
    this.camera.position.set(0, 12, 18);
    this.camera.target.set(0, 0, 0);

    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.3 }));

    const dirLight = new DirectionalLight({ color: Color.WHITE, intensity: 1.0 });
    dirLight.position.set(10, 20, 10);
    dirLight.direction.set(-0.5, -1, -0.5).normalize();
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    const texture = await this._generateHexTexture();

    // Initialize Octree with a higher maxObjects to prevent massive subdivision lag
    // for 1600 moving cubes every frame!
    const bounds = new BoundingBox(new Vector3D(-50, -5, -50), new Vector3D(50, 50, 50));
    this.scene.initOctrees(bounds, { maxObjects: 200 });

    const gridSize = 40; // 40x40 = 1600 cubes
    const spacing = 1.5;
    const offset = (gridSize * spacing) / 2 - spacing / 2;

    const cubeGeo = new Cube({ size: 1.0 }).getGeometryData();

    const sharedMaterial = new StandardMaterial({
      color: new Color(0.8, 0.8, 0.9),
      diffuseMap: texture,
      roughness: 0.4,
      metallic: 0.1,
    });

    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const mesh = new Object3D("Cube_" + x + "_" + z);
        mesh.geometry = cubeGeo;
        mesh.material = sharedMaterial;
        mesh.setPosition(x * spacing - offset, 0, z * spacing - offset);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Add Phase 1 Gamification (Hover scales up and glows)
        mesh.addBehavior(new HoverBehavior(1.4));

        // Add Phase 3 Gamification (Drag & Drop)
        mesh.addBehavior(new DraggableBehavior(this.camera));

        // Add click interaction (Changes color permanently)
        mesh.onPointerClick = (): void => {
          if (mesh.material === sharedMaterial) {
            mesh.material = new StandardMaterial({
              color: new Color(0.8, 0.8, 0.9),
              diffuseMap: texture,
              roughness: 0.4,
              metallic: 0.1,
            });
          }
          (mesh.material as StandardMaterial).color.set(
            Math.random(),
            Math.random(),
            Math.random(),
          );
        };

        this.scene.add(mesh);
      }
    }

    // Build the static octree once after adding static objects
    this.scene.updateStaticOctree();
  }

  protected override update(): void {
    // The InteractionManager and Behaviors handle the logic automatically!
  }
}

const app = new Showcase19();
attachDevTools(app);
app.start().catch((err: unknown) => console.error("[Showcase19] Failed to start:", err));
