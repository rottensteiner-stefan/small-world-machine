import {
  AbstractShowcase,
  AmbientLight,
  Color,
  DirectionalLight,
  DynamicReflectionProbe,
  Ground,
  Object3D,
  PlanarReflectionNode,
  PointLight,
  RendererType,
  Sphere,
  StandardMaterial,
  Texture,
  TextureFilter,
  Vector3D,
} from "@small-world-machine/engine";

export class Showcase extends AbstractShowcase {
  protected _orbitingLight!: PointLight;
  protected _time: number = 0;

  // Dynamic Reflection Probes
  protected _probes: DynamicReflectionProbe[] = [];

  // Moons orbiting the spheres
  protected _moonPivots: Object3D[] = [];

  protected _reflectionNode!: PlanarReflectionNode;

  protected override async setupScene(): Promise<void> {
    this.onCanvasRecreated();

    // Set up camera
    this.configureCamera();

    this.defaultMoveSpeed = 8.0;
    this.setInitialCamera(new Vector3D(0, 5, 15), new Vector3D(0, 2, 0));

    // 1. Lights
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.15 }));

    const sun = new DirectionalLight({
      color: new Color(1, 0.977, 0.953),
      intensity: 1.2,
    });
    sun.position.set(10, 20, 10);
    sun.direction.set(-0.5, -1.0, -0.5).normalize();
    sun.castShadow = true;
    this.scene.add(sun);

    // Orbiting point light
    this._orbitingLight = new PointLight({
      color: new Color(1, 0.793, 0.579),
      intensity: 2.0,
      distance: 30,
    });
    this.scene.add(this._orbitingLight);

    // 2. Skybox + real IBL (irradiance/prefilter/BRDF LUT), baked via tools/ibl-gen.html -- fail fast.
    const envTexture = await this.loadSkybox("./assets/ibl/env.webp");
    await this.loadIbl("./assets/ibl/", 3.0); // Boost ambient light from dark space IBL

    // 3. Generate Checkered and Roughness maps procedurally via canvas
    const checkCanvas = document.createElement("canvas");
    checkCanvas.width = 512;
    checkCanvas.height = 512;
    const ctx = checkCanvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = "#111111"; // Very dark gray for black tiles
    const tileSize = 128;
    const tileCount = 512 / tileSize;
    for (let y = 0; y < tileCount; y++) {
      for (let x = 0; x < tileCount; x++) {
        if ((x + y) % 2 === 0) {
          ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        }
      }
    }

    const roughCanvas = document.createElement("canvas");
    roughCanvas.width = 512;
    roughCanvas.height = 512;
    const rCtx = roughCanvas.getContext("2d")!;
    rCtx.fillStyle = "rgb(230, 230, 230)"; // White tiles are rough (0.9)
    rCtx.fillRect(0, 0, 512, 512);
    rCtx.fillStyle = "rgb(15, 15, 15)"; // Black tiles are smooth/shiny (0.06)
    for (let y = 0; y < tileCount; y++) {
      for (let x = 0; x < tileCount; x++) {
        if ((x + y) % 2 === 0) {
          rCtx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        }
      }
    }

    const diffuseBitmap = await createImageBitmap(checkCanvas);
    const roughBitmap = await createImageBitmap(roughCanvas);

    const checkTexture = Texture.fromImage(diffuseBitmap, {
      magFilter: TextureFilter.NEAREST,
      minFilter: TextureFilter.NEAREST,
    });
    const roughTexture = Texture.fromImage(roughBitmap, {
      magFilter: TextureFilter.NEAREST,
      minFilter: TextureFilter.NEAREST,
    });

    // We repeat the checkerboard pattern
    checkTexture.repeat.x = 6;
    checkTexture.repeat.y = 6;
    roughTexture.repeat.x = 6;
    roughTexture.repeat.y = 6;

    // 4. Create PlanarReflectionNode for the Floor
    this._reflectionNode = new PlanarReflectionNode("FloorReflection", 1024, 1024);
    // Move it to match floor position
    this._reflectionNode.position.set(0, 0, 0);
    this.scene.add(this._reflectionNode);

    // 5. Checkered Floor plane
    const floor = new Object3D("Floor").setPosition(0, 0, 0);
    floor.geometry = new Ground({ width: 30, depth: 30 }).getGeometryData();
    floor.material = new StandardMaterial({
      color: new Color(1.0, 1.0, 1.0),
      metallic: 0.1,
      roughness: 1.0, // Multiplied by roughnessMap
      diffuseMap: checkTexture,
      roughnessMap: roughTexture,
      envMap: envTexture,
      reflectionMap: this._reflectionNode.renderTarget,
      reflectivity: 0.6, // 60% Planar Reflection
      transparent: false,
    });
    floor.receiveShadow = true;
    this.scene.add(floor);
    // The floor samples `renderTarget` as its `reflectionMap` -- it must not be rendered while
    // that same texture is bound as the render target of its own reflection sub-render.
    this._reflectionNode.excludedObjects.push(floor);

    // 6. Create 3 Large Mirrored Spheres
    const sphereGeom = new Sphere({
      radius: 1,
      widthSegments: 32,
      heightSegments: 24,
    }).getGeometryData();

    // Large Sphere 1: Lavender
    const sphere1 = new Object3D("LargeSphere1").setPosition(-3.5, 2.0, -1.5);
    sphere1.geometry = sphereGeom;
    sphere1.setScale(2.0); // radius = 2.0
    sphere1.material = new StandardMaterial({
      color: new Color(0.9, 0.85, 0.95), // Lavender tint
      metallic: 1.0,
      roughness: 0.02,
      envMap: envTexture,
      transparent: false,
    });
    sphere1.castShadow = true;
    sphere1.receiveShadow = true;
    this.scene.add(sphere1);

    const probe1 = new DynamicReflectionProbe("Probe1", 256);
    probe1.facesPerFrame = 1;
    sphere1.add(probe1);
    this._probes.push(probe1);
    (sphere1.material as StandardMaterial).envMap = probe1.renderTarget;

    // Large Sphere 2: Pale Mint
    const sphere2 = new Object3D("LargeSphere2").setPosition(3.5, 1.5, -2.0);
    sphere2.geometry = sphereGeom;
    sphere2.setScale(1.5); // radius = 1.5
    sphere2.material = new StandardMaterial({
      color: new Color(0.85, 0.95, 0.9), // Mint tint
      metallic: 1.0,
      roughness: 0.02,
      envMap: envTexture,
      transparent: false,
    });
    sphere2.castShadow = true;
    sphere2.receiveShadow = true;
    this.scene.add(sphere2);

    const probe2 = new DynamicReflectionProbe("Probe2", 256);
    probe2.facesPerFrame = 1;
    sphere2.add(probe2);
    this._probes.push(probe2);
    (sphere2.material as StandardMaterial).envMap = probe2.renderTarget;

    // Large Sphere 3: Pale Rose
    const sphere3 = new Object3D("LargeSphere3").setPosition(0.0, 1.0, 3.0);
    sphere3.geometry = sphereGeom;
    sphere3.setScale(1.0); // radius = 1.0
    sphere3.material = new StandardMaterial({
      color: new Color(0.95, 0.85, 0.88), // Rose tint
      metallic: 1.0,
      roughness: 0.02,
      envMap: envTexture,
      transparent: false,
    });
    sphere3.castShadow = true;
    sphere3.receiveShadow = true;
    this.scene.add(sphere3);

    const probe3 = new DynamicReflectionProbe("Probe3", 256);
    probe3.facesPerFrame = 1;
    sphere3.add(probe3);
    this._probes.push(probe3);
    (sphere3.material as StandardMaterial).envMap = probe3.renderTarget;

    // 7. Setup Moons
    const moonColors = [
      new Color(1.0, 0.45, 0.35), // Neon peach
      new Color(0.4, 0.85, 0.4), // Lime
      new Color(1.0, 0.85, 0.2), // Neon yellow
    ];

    const moonGeom = new Sphere({
      radius: 0.4, // etwas größer
      widthSegments: 24,
      heightSegments: 16,
    }).getGeometryData();

    // Moon 1 (orbiting sphere1)
    const moonMat1 = new StandardMaterial({
      color: moonColors[0]!,
      metallic: 0.0,
      roughness: 0.95,
    });
    const moon1 = new Object3D("Moon1").setPosition(3.0, 0, 0); // orbit distance
    moon1.geometry = moonGeom;
    moon1.material = moonMat1;
    moon1.castShadow = true;
    moon1.receiveShadow = true;
    const pivot1 = new Object3D("Pivot1");
    pivot1.position.copyFrom(sphere1.position);
    pivot1.add(moon1);
    this.scene.add(pivot1);
    this._moonPivots.push(pivot1);

    // Moon 2 (orbiting sphere2)
    const moonMat2 = new StandardMaterial({
      color: moonColors[1]!,
      metallic: 0.0,
      roughness: 0.95,
    });
    const moon2 = new Object3D("Moon2").setPosition(2.2, 0, 0);
    moon2.geometry = moonGeom;
    moon2.material = moonMat2;
    moon2.castShadow = true;
    moon2.receiveShadow = true;
    const pivot2 = new Object3D("Pivot2");
    pivot2.position.copyFrom(sphere2.position);
    pivot2.add(moon2);
    this.scene.add(pivot2);
    this._moonPivots.push(pivot2);

    // Moon 3 (orbiting sphere3)
    const moonMat3 = new StandardMaterial({
      color: moonColors[2]!,
      metallic: 0.0,
      roughness: 0.95,
    });
    const moon3 = new Object3D("Moon3").setPosition(1.7, 0, 0);
    moon3.geometry = moonGeom;
    moon3.material = moonMat3;
    moon3.castShadow = true;
    moon3.receiveShadow = true;
    const pivot3 = new Object3D("Pivot3");
    pivot3.position.copyFrom(sphere3.position);
    pivot3.add(moon3);
    this.scene.add(pivot3);
    this._moonPivots.push(pivot3);
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);
    this._time += deltaTime;

    // Orbit point light
    const orbitRadius = 8.0;
    const lightX = Math.cos(this._time * 0.8) * orbitRadius;
    const lightZ = Math.sin(this._time * 0.8) * orbitRadius;
    this._orbitingLight.position.set(lightX, 5.0, lightZ);

    // Update moons
    for (let i = 0; i < this._moonPivots.length; i++) {
      // Rotation speed offsets so they don't look completely identical
      const speed = 1.0 + i * 0.2;
      this._moonPivots[i]!.setRotation(0, this._time * speed, 0);
    }

    // Update the planar reflection
    this._reflectionNode.updateReflection(this.scene, this.camera!, this.renderer);

    // Update dynamic probes
    for (const probe of this._probes) {
      probe.updateReflection(this.scene, this.renderer);
    }
  }
}

// === START THE ENGINE ===
const app = new Showcase({
  rendererType: RendererType.BEST,
});
app.start().catch((err: unknown) => console.error("[Showcase16] Failed to start:", err));
