import type { EngineOptions } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Color,
  Cube,
  DirectionalLight,
  ModelGeometry,
  Object3D,
  RendererType,
  StandardMaterial,
  ThreadPool,
  Vector3D,
} from "@small-world-machine/engine";

interface TerrainChunkPayload {
  positions: Float32Array;
  uvs: Float32Array;
  normals: Float32Array;
  tangents: Float32Array;
  indices: Uint32Array;
  wireframeIndices: Uint32Array;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

export class Showcase extends AbstractShowcase {
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
    this.setInitialCamera(new Vector3D(0, 30, 60), new Vector3D(0, 0, 0));

    const ambient = new AmbientLight({ color: Color.WHITE, intensity: 0.35 });
    this.scene.add(ambient);

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

    if (btnMain) {
      btnMain.addEventListener("click", () => {
        void this._generate(false);
      });
    }
    if (btnWorker) {
      btnWorker.addEventListener("click", () => {
        void this._generate(true);
      });
    }
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

  public override destroy(): void {
    this._threadPool.destroy();
    super.destroy();
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);

    // Rotate background cubes to show if main thread is blocked
    for (const c of this._cubes) {
      c.rotation.y += 2.0 * deltaTime;
      c.rotation.x += 1.5 * deltaTime;
    }
  }

  /**
   * Extremely heavy procedural generation logic using Fractal Brownian Motion (fBm) with pure sine waves.
   * Runs self-contained (no external imports) so it can be safely transferred to a worker, including
   * smooth vertex normals, UVs, tangents, wireframe indices, and AABB bounds so main-thread assembly is O(1).
   */
  private static _generateTerrainChunk(data: {
    width: number;
    depth: number;
    resolution: number;
  }): TerrainChunkPayload {
    const { width, depth, resolution } = data;
    const sizeX = width * resolution;
    const sizeZ = depth * resolution;
    const cols = sizeX + 1;
    const rows = sizeZ + 1;
    const numVertices = cols * rows;
    const numFaces = sizeX * sizeZ * 2;

    const positions = new Float32Array(numVertices * 3);
    const uvs = new Float32Array(numVertices * 2);
    const normals = new Float32Array(numVertices * 3);
    const tangents = new Float32Array(numVertices * 4);
    const indices = new Uint32Array(numFaces * 3);
    const wireframeIndices = new Uint32Array(numFaces * 6);

    let minY = Infinity;
    let maxY = -Infinity;

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

          // Extra iterations to make it artificially heavy for demonstration
          for (let k = 0; k < 50; k++) {
            const noiseX = Math.sin(px * freq + k * 0.001);
            const noiseZ = Math.cos(pz * freq - k * 0.001);
            py += (noiseX * noiseZ * amp) / 50;
          }
        }

        if (py < minY) minY = py;
        if (py > maxY) maxY = py;

        positions[vIdx * 3] = px;
        positions[vIdx * 3 + 1] = py;
        positions[vIdx * 3 + 2] = pz;

        uvs[vIdx * 2] = x / sizeX;
        uvs[vIdx * 2 + 1] = z / sizeZ;

        vIdx++;
      }
    }

    // Compute smooth vertex normals and tangents from height grid differences
    const step = 1.0 / resolution;
    for (let z = 0; z <= sizeZ; z++) {
      const zPrev = z > 0 ? z - 1 : z;
      const zNext = z < sizeZ ? z + 1 : z;
      const dz = (zNext - zPrev) * step;

      for (let x = 0; x <= sizeX; x++) {
        const xPrev = x > 0 ? x - 1 : x;
        const xNext = x < sizeX ? x + 1 : x;
        const dx = (xNext - xPrev) * step;

        const idx = z * cols + x;
        const hL = positions[(z * cols + xPrev) * 3 + 1]!;
        const hR = positions[(z * cols + xNext) * 3 + 1]!;
        const hD = positions[(zPrev * cols + x) * 3 + 1]!;
        const hU = positions[(zNext * cols + x) * 3 + 1]!;

        const dhdx = (hR - hL) / dx;
        const dhdz = (hU - hD) / dz;

        const nx = -dhdx;
        const ny = 1.0;
        const nz = -dhdz;
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const invN = 1.0 / nLen;

        normals[idx * 3] = nx * invN;
        normals[idx * 3 + 1] = ny * invN;
        normals[idx * 3 + 2] = nz * invN;

        // Tangent along +X slope: (1, dhdx, 0)
        const tLen = Math.sqrt(1.0 + dhdx * dhdx);
        tangents[idx * 4] = 1.0 / tLen;
        tangents[idx * 4 + 1] = dhdx / tLen;
        tangents[idx * 4 + 2] = 0.0;
        tangents[idx * 4 + 3] = 1.0;
      }
    }

    let iIdx = 0;
    let wIdx = 0;
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        const topLeft = z * cols + x;
        const topRight = topLeft + 1;
        const bottomLeft = (z + 1) * cols + x;
        const bottomRight = bottomLeft + 1;

        indices[iIdx++] = topLeft;
        indices[iIdx++] = bottomLeft;
        indices[iIdx++] = topRight;

        indices[iIdx++] = topRight;
        indices[iIdx++] = bottomLeft;
        indices[iIdx++] = bottomRight;

        wireframeIndices[wIdx++] = topLeft;
        wireframeIndices[wIdx++] = bottomLeft;
        wireframeIndices[wIdx++] = bottomLeft;
        wireframeIndices[wIdx++] = topRight;
        wireframeIndices[wIdx++] = topRight;
        wireframeIndices[wIdx++] = topLeft;

        wireframeIndices[wIdx++] = topRight;
        wireframeIndices[wIdx++] = bottomLeft;
        wireframeIndices[wIdx++] = bottomLeft;
        wireframeIndices[wIdx++] = bottomRight;
        wireframeIndices[wIdx++] = bottomRight;
        wireframeIndices[wIdx++] = topRight;
      }
    }

    return {
      positions,
      uvs,
      normals,
      tangents,
      indices,
      wireframeIndices,
      bounds: {
        min: [-width / 2, minY, -depth / 2],
        max: [width / 2, maxY, depth / 2],
      },
    };
  }

  private async _generate(useWorker: boolean): Promise<void> {
    if (this._calculating) return;
    this._setUiState(true);

    if (this._terrainMesh) {
      this.scene.remove(this._terrainMesh);
      this._terrainMesh = null;
    }

    if (!useWorker) {
      // Yield one painted frame so the UI renders "Generating High-Poly Terrain..." before main-thread freeze
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }

    const terrainSettings = { width: 40, depth: 40, resolution: 8 };
    const startTime = performance.now();
    let result: TerrainChunkPayload;

    try {
      if (useWorker) {
        // Run on background thread. Arrays are passed back via zero-copy transferables.
        result = await this._threadPool.execute(Showcase._generateTerrainChunk, terrainSettings);
      } else {
        // Block main thread!
        result = Showcase._generateTerrainChunk(terrainSettings);
      }

      const geometry = new ModelGeometry(
        result.positions,
        result.uvs,
        result.normals,
        result.indices,
        {
          tangents: result.tangents,
          wireframeIndices: result.wireframeIndices,
          headerBounds: result.bounds,
        },
      ).getGeometryData();

      const elapsed = performance.now() - startTime;
      this._setUiResult(
        `${useWorker ? "Worker" : "Main"} Thread finished in ${elapsed.toFixed(0)}ms.`,
      );

      const material = new StandardMaterial({ color: Color.GREEN, roughness: 0.8, metallic: 0.1 });
      this._terrainMesh = new Object3D("ProceduralTerrain");
      this._terrainMesh.geometry = geometry;
      this._terrainMesh.material = material;

      this.scene.add(this._terrainMesh);
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

const app = new Showcase({
  rendererType: RendererType.BEST,
});
app.start().catch((err: unknown) => console.error("[Showcase18] Failed to start:", err));
