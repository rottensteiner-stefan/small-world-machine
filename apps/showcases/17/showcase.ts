import {
  AbstractShowcase,
  Color,
  Cube,
  DirectionalLight,
  EngineOptions,
  Object3D,
  RendererType,
  StandardMaterial,
  ThreadPool,
  Vector3D,
} from "@small-world-machine/engine";

class Showcase17 extends AbstractShowcase {
  private _cubes: Object3D[] = [];
  private _threadPool: ThreadPool;
  private _calculating: boolean = false;

  constructor(options: EngineOptions = {}) {
    super(options);
    this._threadPool = new ThreadPool();
  }

  protected async setupScene(): Promise<void> {
    // 1. Setup Camera and Lighting
    this.camera.position.set(0, 10, 20);
    this.camera.target.set(0, 0, 0);

    const sun = new DirectionalLight({ color: Color.WHITE, intensity: 1.0 });
    sun.position.set(10, 20, 10);
    sun.lookAt(new Vector3D(0, 0, 0));
    this.scene.add(sun);

    // 2. Create a ring of cubes to visualize framerate stutter
    const geometry = new Cube({ size: 1.0 }).getGeometryData();
    const material = new StandardMaterial({
      color: Color.fromName("dodgerblue")!,
      roughness: 0.2,
      metallic: 0.8,
    });

    const numCubes = 36;
    for (let i = 0; i < numCubes; i++) {
      const cube = new Object3D(`Cube_${i}`);
      cube.geometry = geometry;
      cube.material = material;

      const angle = (i / numCubes) * Math.PI * 2;
      const radius = 8;
      cube.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);

      this.scene.add(cube);
      this._cubes.push(cube);
    }

    // 3. Register UI Events
    const btnMain = document.getElementById("btnMainThread");
    const btnWorker = document.getElementById("btnWorkerThread");

    if (btnMain) {
      btnMain.addEventListener("click", () => this._runOnMainThread());
    }
    if (btnWorker) {
      btnWorker.addEventListener("click", () => this._runOnWorkerThread());
    }
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);

    // Rotate all cubes to visualize the framerate
    for (const cube of this._cubes) {
      cube.rotation.y += 2.0 * deltaTime;
      cube.rotation.x += 1.0 * deltaTime;
    }
  }

  // --- HEAVY CALCULATION LOGIC ---

  /**
   * The heavy math function.
   * WARNING: For ThreadPool, this will be serialized to a string!
   * It cannot access outer variables (like `this`).
   */
  private static _heavyMathLogic(data: { limit: number }): number {
    let primeCount = 0;
    // Extremely inefficient prime number calculator to purposely burn CPU cycles
    for (let i = 2; i < data.limit; i++) {
      let isPrime = true;
      for (let j = 2; j <= Math.sqrt(i); j++) {
        if (i % j === 0) {
          isPrime = false;
          break;
        }
      }
      if (isPrime) primeCount++;
    }
    return primeCount;
  }

  private _runOnMainThread(): void {
    if (this._calculating) return;
    this._setUiState(true);

    const startTime = performance.now();
    // Blocking the main thread!
    // The browser will freeze, the cubes will stop spinning.
    const result = Showcase17._heavyMathLogic({ limit: 5000000 });
    const elapsed = performance.now() - startTime;

    this._setUiResult(`Main Thread finished in ${elapsed.toFixed(0)}ms. Primes found: ${result}`);
    this._setUiState(false);
  }

  private async _runOnWorkerThread(): Promise<void> {
    if (this._calculating) return;
    this._setUiState(true);

    const startTime = performance.now();

    // Non-blocking! Handing off to the ThreadPool.
    // The cubes will continue spinning smoothly.
    try {
      const result = await this._threadPool.execute(Showcase17._heavyMathLogic, { limit: 5000000 });
      const elapsed = performance.now() - startTime;
      this._setUiResult(
        `Worker Thread finished in ${elapsed.toFixed(0)}ms. Primes found: ${result}`,
      );
    } catch (err: unknown) {
      this._setUiResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    this._setUiState(false);
  }

  private _setUiState(calculating: boolean): void {
    this._calculating = calculating;
    const btnMain = document.getElementById("btnMainThread") as HTMLButtonElement;
    const btnWorker = document.getElementById("btnWorkerThread") as HTMLButtonElement;

    if (btnMain) btnMain.disabled = calculating;
    if (btnWorker) btnWorker.disabled = calculating;

    if (calculating) {
      this._setUiResult("Calculating... (Notice the cubes!)");
    }
  }

  private _setUiResult(text: string): void {
    const resultDiv = document.getElementById("resultText");
    if (resultDiv) {
      resultDiv.innerText = text;
    }
  }
}

const app = new Showcase17({
  rendererType: RendererType.BEST,
});
app.start().catch((err: unknown) => console.error("[Showcase17] Failed to start:", err));
