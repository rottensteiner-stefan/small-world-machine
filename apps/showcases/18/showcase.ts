import {
  AbstractShowcase,
  Color,
  Cube,
  DirectionalLight,
  EngineOptions,
  ModelGeometry,
  Object3D,
  RendererType,
  StandardMaterial,
  ThreadPool,
  Vector3D,
} from "@small-world-machine/engine";

class Showcase18 extends AbstractShowcase {
  private _threadPool: ThreadPool;
  private _calculating: boolean = false;
  private _terrainMesh: Object3D | null = null;
  private _cubes: Object3D[] = [];

  constructor(options: EngineOptions = {}) {
    super(options);
    this._threadPool = new ThreadPool();
  }

  protected async setupScene(): Promise<void> {
    // 1. Setup Camera and Lighting
    this.camera.position.set(0, 30, 60);
    this.camera.target.set(0, 0, 0);

    const sun = new DirectionalLight({ color: Color.WHITE, intensity: 1.0 });
    sun.position.set(20, 50, 20);
    sun.lookAt(new Vector3D(0, 0, 0));
    this.scene.add(sun);

    // 2. Add some animated background cubes to visualize stuttering
    const cubeGeo = new Cube({ size: 1.0 }).getGeometryData();
    const cubeMat = new StandardMaterial({ color: Color.fromName("dodgerblue")! });

    for (let i = 0; i < 20; i++) {
      const c = new Object3D(`VisualizerCube_${i}`);
      c.geometry = cubeGeo;
      c.material = cubeMat;
      const angle = (i / 20) * Math.PI * 2;
      const radius = 25;
      c.position.set(Math.cos(angle) * radius, 10, Math.sin(angle) * radius);
      this.scene.add(c);
      this._cubes.push(c);
    }

    // 3. Register UI Events
    const btnMain = document.getElementById("btnMainThread");
    const btnWorker = document.getElementById("btnWorkerThread");
    const btnClear = document.getElementById("btnClear");

    if (btnMain) btnMain.addEventListener("click", () => this._generate(false));
    if (btnWorker) btnWorker.addEventListener("click", () => this._generate(true));
    if (btnClear) {
      btnClear.addEventListener("click", () => {
        if (this._terrainMesh) {
          this.scene.remove(this._terrainMesh);
          this._terrainMesh = null;
          this._setUiResult("Terrain cleared.");
        }
      });
    }
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);

    // Rotate background cubes to show if main thread is blocked
    for (const c of this._cubes) {
      c.rotation.y += 2.0 * deltaTime;
      c.rotation.x += 1.5 * deltaTime;
    }

    this.scene.update(deltaTime);
  }

  /**
   * Extremely heavy procedural generation logic using Fractal Brownian Motion (fBm) with pure sine waves.
   * Runs self-contained (no external imports) so it can be safely transferred to a worker.
   */
  private static _generateTerrainChunk(data: {
    width: number;
    depth: number;
    resolution: number;
  }): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
    const { width, depth, resolution } = data;
    const sizeX = width * resolution;
    const sizeZ = depth * resolution;
    const numVertices = (sizeX + 1) * (sizeZ + 1);
    const numFaces = sizeX * sizeZ * 2;

    const positions = new Float32Array(numVertices * 3);
    const normals = new Float32Array(numVertices * 3);
    const indices = new Uint32Array(numFaces * 3);

    let vIdx = 0;
    for (let z = 0; z <= sizeZ; z++) {
      for (let x = 0; x <= sizeX; x++) {
        const px = x / resolution - width / 2;
        const pz = z / resolution - depth / 2;

        let py = 0;
        // Heavy fractal math to burn CPU
        for (let octave = 1; octave <= 16; octave++) {
          const freq = Math.pow(1.5, octave) * 0.1;
          const amp = Math.pow(0.6, octave) * 15;

          // Extra useless iterations to make it artificially heavy for showcasesnstration
          for (let k = 0; k < 50; k++) {
            const noiseX = Math.sin(px * freq + k * 0.001);
            const noiseZ = Math.cos(pz * freq - k * 0.001);
            py += (noiseX * noiseZ * amp) / 50;
          }
        }

        positions[vIdx * 3] = px;
        positions[vIdx * 3 + 1] = py;
        positions[vIdx * 3 + 2] = pz;

        // Simple up-vector normal for now (real normal calculation would need neighboring vertices)
        normals[vIdx * 3] = 0;
        normals[vIdx * 3 + 1] = 1;
        normals[vIdx * 3 + 2] = 0;

        vIdx++;
      }
    }

    let iIdx = 0;
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        const topLeft = z * (sizeX + 1) + x;
        const topRight = topLeft + 1;
        const bottomLeft = (z + 1) * (sizeX + 1) + x;
        const bottomRight = bottomLeft + 1;

        indices[iIdx++] = topLeft;
        indices[iIdx++] = bottomLeft;
        indices[iIdx++] = topRight;

        indices[iIdx++] = topRight;
        indices[iIdx++] = bottomLeft;
        indices[iIdx++] = bottomRight;
      }
    }

    return { positions, normals, indices };
  }

  private async _generate(useWorker: boolean): Promise<void> {
    if (this._calculating) return;
    this._setUiState(true);

    if (this._terrainMesh) {
      this.scene.remove(this._terrainMesh);
      this._terrainMesh = null;
    }

    const terrainSettings = { width: 40, depth: 40, resolution: 8 };
    const startTime = performance.now();
    let result: { positions: Float32Array; normals: Float32Array; indices: Uint32Array };

    try {
      if (useWorker) {
        // Run on background thread. Arrays are passed back via zero-copy transferables.
        result = await this._threadPool.execute(Showcase18._generateTerrainChunk, terrainSettings);
      } else {
        // Block main thread!
        result = Showcase18._generateTerrainChunk(terrainSettings);
      }

      const elapsed = performance.now() - startTime;
      this._setUiResult(
        `${useWorker ? "Worker" : "Main"} Thread finished in ${elapsed.toFixed(0)}ms.`,
      );

      const geometry = new ModelGeometry(
        result.positions,
        new Float32Array(0), // uvs
        result.normals,
        result.indices,
      ).getGeometryData();

      const material = new StandardMaterial({ color: Color.GREEN, roughness: 0.8, metallic: 0.1 });
      this._terrainMesh = new Object3D("ProceduralTerrain");
      this._terrainMesh.geometry = geometry;
      this._terrainMesh.material = material;

      if (this._terrainMesh) {
        this.scene.add(this._terrainMesh);
      }
    } catch (err: unknown) {
      this._setUiResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    this._setUiState(false);
  }

  private _setUiState(calculating: boolean): void {
    this._calculating = calculating;
    const btnMain = document.getElementById("btnMainThread") as HTMLButtonElement;
    const btnWorker = document.getElementById("btnWorkerThread") as HTMLButtonElement;
    const btnClear = document.getElementById("btnClear") as HTMLButtonElement;

    if (btnMain) btnMain.disabled = calculating;
    if (btnWorker) btnWorker.disabled = calculating;
    if (btnClear) btnClear.disabled = calculating;

    if (calculating) {
      this._setUiResult("Generating High-Poly Terrain... (Look at the cubes!)");
    }
  }

  private _setUiResult(text: string): void {
    const resultDiv = document.getElementById("resultText");
    if (resultDiv) {
      resultDiv.innerText = text;
    }
  }
}

const app = new Showcase18({
  rendererType: RendererType.BEST,
});
app.start().catch((err: unknown) => console.error("[Showcase18] Failed to start:", err));
