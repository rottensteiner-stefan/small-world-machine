import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cube,
  CubeLayout,
  CubeTexture,
  DirectionalLight,
  DynamicReflectionProbe,
  Ground,
  InstancedMesh,
  Matrix4,
  Object3D,
  PerspectiveProjection,
  PlanarReflectionNode,
  PointLight,
  ProjectionType,
  RendererType,
  SkyboxMaterial,
  Sphere,
  StandardMaterial,
  StateMachine,
  Texture,
  TextureFilter,
  Vector3D,
} from "@small-world-machine/engine";

interface Ball {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  radius: number;
  stateMachine: StateMachine<"active" | "falling" | "exploding", BallContext>;
  timeOnFloor: number;
  lifeTime: number;
  scale: number;
  alpha: number;
}

interface BallContext {
  ball: Ball;
  example: Showcase15;
}

export class Showcase15 extends AbstractShowcase {
  protected _balls: Ball[] = [];
  protected _largeSpheres: { object: Object3D; radius: number; x: number; y: number; z: number }[] =
    [];
  protected _orbitingLight!: PointLight;
  protected _time: number = 0;

  /** Max supported balls = 5 color groups × 2000 slots. */
  public static readonly MAX_BALLS = 1000;
  public static readonly MAX_PER_GROUP = Math.floor(1000 / 5); // MAX_BALLS / 5 color groups

  /** How many balls are currently active (controlled by inspector slider). */
  protected _activeBallCount: number = 250;

  // Instanced Meshes (split into 5 color groups to maintain multi-colored aesthetic)
  protected _mainBallsMeshes: InstancedMesh[] = [];

  // Dynamic Reflection Probes
  protected _probes: DynamicReflectionProbe[] = [];

  // Moons orbiting the spheres
  protected _moonPivots: Object3D[] = [];

  protected _reflectionNode!: PlanarReflectionNode;

  // Scratch variables to avoid per-frame allocations
  protected _scratchPos: Vector3D = new Vector3D();
  protected _scratchRot: Vector3D = new Vector3D();
  protected _scratchScale: Vector3D = new Vector3D();
  protected _tempMatrix: Matrix4 = new Matrix4();

  protected override async setupScene(): Promise<void> {
    this.onCanvasRecreated();

    // Set up camera
    if (ProjectionType.PERSPECTIVE === this.camera.projection.type) {
      const aspect: number = window.innerWidth / window.innerHeight;
      this.camera.projection = new PerspectiveProjection({
        fov: (65 * Math.PI) / 180,
        aspect,
        near: 0.1,
        far: 1000,
      });
      this.camera.updateProjectionMatrix();
    }

    this.defaultMoveSpeed = 8.0;
    this.setInitialCamera(new Vector3D(0, 5, 15), new Vector3D(0, 2, 0));

    // 1. Lights
    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.15 }));

    const sun = new DirectionalLight({
      color: new Color(1.0, 0.95, 0.9),
      intensity: 1.2,
    });
    sun.position.set(10, 20, 10);
    sun.direction.set(-0.5, -1.0, -0.5).normalize();
    sun.castShadow = true;
    this.scene.add(sun);

    // Orbiting point light
    this._orbitingLight = new PointLight({
      color: new Color(1.0, 0.6, 0.3),
      intensity: 2.0,
      distance: 30,
    });
    this.scene.add(this._orbitingLight);

    // 2. Load environment texture for skybox & PBR reflections
    const envTexture = new CubeTexture();
    try {
      await envTexture.loadFrom("./assets/ibl/env.webp", CubeLayout.CROSS_HORIZONTAL);

      const skybox = new Object3D("Skybox");
      skybox.geometry = new Cube({ size: 1000 }).getGeometryData();
      skybox.material = new SkyboxMaterial({ cubeMap: envTexture });
      skybox.frustumCulled = false;
      this.scene.add(skybox);
    } catch (e) {
      console.warn("Skybox image not loaded:", e);
    }

    // 2b. Real IBL (irradiance/prefilter/BRDF LUT), baked via tools/ibl-gen.html from a
    // freshly-generated panorama matching this scene's own skybox -- gives the mirror spheres
    // and the checkered floor an actual environment to reflect instead of a flat ambient color.
    try {
      const brdfTexture = await Texture.fromUrl("./assets/ibl/brdf_lut.webp");
      const irradianceTexture = new CubeTexture();
      await irradianceTexture.loadFrom("./assets/ibl/irradiance.webp", CubeLayout.CROSS_HORIZONTAL);
      const prefilterTexture = new CubeTexture();
      await prefilterTexture.loadMipmapsFrom(
        [
          "./assets/ibl/prefilter/mip0.webp",
          "./assets/ibl/prefilter/mip1.webp",
          "./assets/ibl/prefilter/mip2.webp",
          "./assets/ibl/prefilter/mip3.webp",
          "./assets/ibl/prefilter/mip4.webp",
        ],
        CubeLayout.CROSS_HORIZONTAL,
      );

      this.scene.brdfLUT = brdfTexture;
      this.scene.irradianceMap = irradianceTexture;
      this.scene.prefilterMap = prefilterTexture;
      this.scene.environmentIntensity = 1.5;
    } catch (e) {
      console.warn("IBL maps not loaded:", e);
    }

    // 3. Generate Checkered and Roughness maps procedurally via canvas
    const checkCanvas = document.createElement("canvas");
    checkCanvas.width = 512;
    checkCanvas.height = 512;
    const ctx = checkCanvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = "#111111"; // Very dark gray for black tiles
    const tileSize = 64;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
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
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
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

    // 5. Create 3 Large Mirrored Spheres
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
    this._largeSpheres.push({ object: sphere1, radius: 2.0, x: -3.5, y: 2.0, z: -1.5 });

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
    this._largeSpheres.push({ object: sphere2, radius: 1.5, x: 3.5, y: 1.5, z: -2.0 });

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
    this._largeSpheres.push({ object: sphere3, radius: 1.0, x: 0.0, y: 1.0, z: 3.0 });

    // Large Spheres cast and receive shadows. Reflected fake spheres are removed.

    // 6. Setup Instanced Meshes for Small Bouncing Rubber Balls
    const ballGeom = new Sphere({
      radius: 0.2, // standard size
      widthSegments: 16,
      heightSegments: 12,
    }).getGeometryData();

    const ballColors = [
      new Color(1.0, 0.45, 0.35), // Neon peach
      new Color(0.4, 0.85, 0.4), // Lime
      new Color(1.0, 0.85, 0.2), // Neon yellow
      new Color(0.2, 0.8, 0.85), // Neon cyan
      new Color(0.9, 0.4, 0.75), // Magenta
    ];

    for (let c = 0; c < 5; c++) {
      const ballMat = new StandardMaterial({
        color: ballColors[c]!,
        metallic: 0.0,
        roughness: 0.95,
        transparent: false,
      });

      const mainMesh = new InstancedMesh(
        `MainBalls_${c}`,
        ballGeom,
        ballMat,
        Showcase15.MAX_PER_GROUP,
      );
      mainMesh.frustumCulled = false;
      this.scene.add(mainMesh);
      this._mainBallsMeshes.push(mainMesh);
    }

    // 7. Spawn Bouncing Ball Data (pre-allocate full capacity; only _activeBallCount are simulated)
    for (let i = 0; i < Showcase15.MAX_BALLS; i++) {
      const ball: Partial<Ball> = {
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        radius: 0.2,
        timeOnFloor: 0,
        lifeTime: 0,
        scale: 1.0,
        alpha: 1.0,
      };

      const stateMachine = this._createBallStateMachine(ball as Ball);
      ball.stateMachine = stateMachine;

      this._balls.push(ball as Ball);
    }
  }

  protected _createBallStateMachine(
    ball: Ball,
  ): StateMachine<"active" | "falling" | "exploding", BallContext> {
    const context: BallContext = {
      ball,
      example: this,
    };

    const fsm = new StateMachine<"active" | "falling" | "exploding", BallContext>(context);

    fsm.addState("active", {
      onEnter: (ctx) => {
        const b = ctx.ball;
        b.timeOnFloor = 0;
        b.lifeTime = 0;
        b.scale = 1.0;
        b.alpha = 1.0;

        // Reset position in cloud above
        const x = (Math.random() - 0.5) * 12;
        const y = 8.0 + Math.random() * 8.0;
        const z = (Math.random() - 0.5) * 12;
        b.position.x = x;
        b.position.y = y;
        b.position.z = z;

        // Reset velocity
        b.velocity.x = (Math.random() - 0.5) * 4.0;
        b.velocity.y = -1.0 - Math.random() * 2.0;
        b.velocity.z = (Math.random() - 0.5) * 4.0;
      },
      onUpdate: (ctx, deltaTime) => {
        const b = ctx.ball;
        const gravity = -9.81;

        b.velocity.y += gravity * deltaTime;

        b.position.x += b.velocity.x * deltaTime;
        b.position.y += b.velocity.y * deltaTime;
        b.position.z += b.velocity.z * deltaTime;

        const limit = 15.0;
        const isOverFloor = Math.abs(b.position.x) <= limit && Math.abs(b.position.z) <= limit;

        if (isOverFloor) {
          const floorRestitution = 0.82;
          const floorFriction = 0.98;
          if (b.position.y < b.radius) {
            b.position.y = b.radius;
            b.velocity.y = -b.velocity.y * floorRestitution;
            b.velocity.x *= floorFriction;
            b.velocity.z *= floorFriction;
          }

          if (b.position.y <= b.radius + 0.01) {
            b.timeOnFloor += deltaTime;
            if (b.timeOnFloor > 2.0) {
              b.stateMachine.transitionTo("exploding");
              return;
            }
          } else {
            b.timeOnFloor = 0;
          }
        } else {
          b.stateMachine.transitionTo("falling");
          return;
        }

        // Collision with 3 Large Spheres
        const sphereRestitution = 0.85;
        for (const large of ctx.example._largeSpheres) {
          const dx = b.position.x - large.x;
          const dy = b.position.y - large.y;
          const dz = b.position.z - large.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const minDist = large.radius + b.radius;

          if (dist < minDist) {
            const nx = dx / dist;
            const ny = dy / dist;
            const nz = dz / dist;

            b.position.x = large.x + nx * minDist;
            b.position.y = large.y + ny * minDist;
            b.position.z = large.z + nz * minDist;

            const dotProd = b.velocity.x * nx + b.velocity.y * ny + b.velocity.z * nz;
            b.velocity.x = (b.velocity.x - 2.0 * dotProd * nx) * sphereRestitution;
            b.velocity.y = (b.velocity.y - 2.0 * dotProd * ny) * sphereRestitution;
            b.velocity.z = (b.velocity.z - 2.0 * dotProd * nz) * sphereRestitution;

            b.timeOnFloor = 0;
          }
        }
      },
    });

    fsm.addState("falling", {
      onEnter: (ctx) => {
        ctx.ball.lifeTime = 0;
      },
      onUpdate: (ctx, deltaTime, stateDuration) => {
        const b = ctx.ball;
        const gravity = -9.81;

        b.velocity.y += gravity * deltaTime;
        b.position.x += b.velocity.x * deltaTime;
        b.position.y += b.velocity.y * deltaTime;
        b.position.z += b.velocity.z * deltaTime;

        b.lifeTime = stateDuration;
        const progress = Math.min(b.lifeTime / 1.0, 1.0);
        b.scale = 1.0 - progress;
        b.alpha = 1.0 - progress;

        if (progress >= 1.0 || b.position.y < -10.0) {
          b.stateMachine.transitionTo("active");
        }
      },
    });

    fsm.addState("exploding", {
      onEnter: (ctx) => {
        ctx.ball.lifeTime = 0;
        ctx.ball.velocity.x = 0;
        ctx.ball.velocity.y = 0;
        ctx.ball.velocity.z = 0;
      },
      onUpdate: (ctx, _deltaTime, stateDuration) => {
        const b = ctx.ball;
        b.lifeTime = stateDuration;
        const progress = Math.min(b.lifeTime / 0.5, 1.0);
        b.scale = 1.0 + progress * 3.0; // expand up to 4x
        b.alpha = 1.0 - progress;

        if (progress >= 1.0) {
          b.stateMachine.transitionTo("active");
        }
      },
    });

    fsm.transitionTo("active");

    return fsm;
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);
    this._time += deltaTime;

    // Orbit point light
    const orbitRadius = 8.0;
    const lightX = Math.cos(this._time * 0.8) * orbitRadius;
    const lightZ = Math.sin(this._time * 0.8) * orbitRadius;
    this._orbitingLight.position.set(lightX, 5.0, lightZ);

    const skybox = this.scene.objects.find((o) => o.name === "Skybox");
    if (skybox) {
      skybox.position.copyFrom(this.camera.position);
      skybox.updateMatrixWorld();
    }

    // 1. Tick state machine physics only for active balls
    const activeCount = this._activeBallCount;
    for (let i = 0; i < activeCount; i++) {
      this._balls[i]!.stateMachine.update(deltaTime);
    }

    // 2. Scene update (matrix calculations of normal static / non-instanced objects)
    this.scene.update(deltaTime);

    // 3. Construct and upload instance matrices
    const active = this._activeBallCount;
    for (let i = 0; i < Showcase15.MAX_BALLS; i++) {
      const ball = this._balls[i]!;
      const colorIdx = i % 5;
      const instanceIdx = Math.floor(i / 5);

      if (i >= active) {
        // Hide this slot: scale to zero, park far off-screen
        this._scratchPos.set(0, -9999, 0);
        this._scratchScale.set(0, 0, 0);
        this._tempMatrix.compose(this._scratchPos, this._scratchRot, this._scratchScale);
        this._mainBallsMeshes[colorIdx]!.setMatrixAt(instanceIdx, this._tempMatrix);
        continue;
      }

      // 3.1 Main Ball transform
      this._scratchPos.set(ball.position.x, ball.position.y, ball.position.z);
      this._scratchScale.set(ball.scale, ball.scale, ball.scale);
      this._tempMatrix.compose(this._scratchPos, this._scratchRot, this._scratchScale);
      this._mainBallsMeshes[colorIdx]!.setMatrixAt(instanceIdx, this._tempMatrix);
    }

    // 4. Update the planar reflection
    this._reflectionNode.updateReflection(this.scene, this.camera!, this.renderer);

    // 5. Update dynamic probes
    for (const probe of this._probes) {
      probe.updateReflection(this.scene, this.renderer);
    }
  }
}

// === START THE ENGINE ===
const app = new Showcase15({
  rendererType: RendererType.BEST,
});
app.start().catch((err: unknown) => console.error("[Showcase15] Failed to start:", err));
