import { AmbientLight, DirectionalLight } from "@small-world-machine/engine/core/lights/index.js";
import {
  CameraStrategyType,
  RendererType,
  PostProcessingEffectType,
} from "@small-world-machine/engine/enums/index.js";
import { Color } from "@small-world-machine/engine/core/colors/index.js";
import { FPSController } from "@small-world-machine/engine/core/controllers/index.js";
import type { Object3D } from "@small-world-machine/engine/core/index.js";
import { AbstractShowcase } from "@small-world-machine/engine/core/showcase/index.js";
import { GltfLoader } from "@small-world-machine/engine/loaders/index.js";
import type { BloomElement } from "@small-world-machine/engine/renderers/post/elements/index.js";
// ============================================================================
// 2. Interactive 3D App for Slide 5
// ============================================================================

class PresentationDemoApp extends AbstractShowcase {
  private _helmet?: Object3D;
  private _isDragging = false;
  private _lastMouseX = 0;
  private _lastMouseY = 0;

  constructor() {
    // Disable fullscreen to fit inside the cinematic container card,
    // and specify canvasId matching public/presentation.html
    super({
      canvasId: "SmallWorldMachineCanvas",
      fullscreen: false,
      rendererType: RendererType.DEFAULT,
    });
  }

  protected override async setupScene(): Promise<void> {
    // Enable Bloom post-processing for PBR visor glow
    this.renderer.postProcessing.enabled = true;
    const bloom = this.renderer.postProcessing.get<BloomElement>(PostProcessingEffectType.BLOOM);
    if (bloom) {
      bloom.enabled = true;
      bloom.intensity = 1.5;
      bloom.threshold = 0.5;
      bloom.radius = 1.0;
      bloom.color = new Color(1.086, 0.904, 1.238);
    }

    // Explicit projection setup (built by AbstractShowcase.configureCamera)
    this.defaultFov = (60 * Math.PI) / 180;
    this.configureCamera();

    this.camera.setStrategy(CameraStrategyType.FPS);
    this.camera.position.set(0, 0, 3);

    const fpsController = new FPSController({
      input: this.input,
      moveSpeed: 5.0,
      enableCollision: false,
      scene: this.scene,
    });
    this.camera.addBehavior(fpsController);

    // Setup PBR Lights
    const ambientLight = new AmbientLight({
      color: new Color(1.0, 1.0, 1.0),
      intensity: 0.25,
    });
    this.scene.add(ambientLight);

    const mainLight = new DirectionalLight({
      color: new Color(1, 0.977, 0.953),
      intensity: 2.0,
    });
    mainLight.position.set(5, 5, 5);
    mainLight.direction.set(-1, -1, -1);
    this.scene.add(mainLight);

    const fillLight = new DirectionalLight({
      color: new Color(0.73, 0.793, 1),
      intensity: 0.8,
    });
    fillLight.position.set(-5, 0, 0);
    fillLight.direction.set(1, 0, 0);
    this.scene.add(fillLight);

    // Load Environment Map (skybox) -- fail fast; envTexture is reused as the helmet's envMap.
    const envTexture = await this.loadSkybox("/apps/showcases/13/assets/skybox.webp");

    // Load GLTF Model (Damaged Helmet)
    try {
      const gltfLoader = new GltfLoader({ basePath: "/apps/showcases/13/assets/" });
      const helmet = await gltfLoader.load("DamagedHelmet.glb");
      helmet.position.set(0, 0, 0);

      if (envTexture) {
        const applyEnvMap = (node: Object3D): void => {
          if (node.material && "envMap" in node.material) {
            (
              node.material as import("@small-world-machine/engine/core/materials/index.js").StandardMaterial
            ).envMap = envTexture;
          }
          node.children.forEach(applyEnvMap);
        };
        applyEnvMap(helmet);
      }

      this._helmet = helmet;
      this.scene.add(helmet);
    } catch (e) {
      console.error("Failed to load DamagedHelmet in presentation showcases:", e);
    }

    // Hide loader overlay once ready
    const loader = document.getElementById("canvasLoader");
    if (loader) {
      loader.style.opacity = "0";
      setTimeout((): void => {
        loader.style.display = "none";
      }, 500);
    }

    // Bind mouse drag interaction for helmet orbit rotation (pointer-lock free)
    this.canvas.addEventListener("mousedown", (e: MouseEvent): void => {
      this._isDragging = true;
      this._lastMouseX = e.clientX;
      this._lastMouseY = e.clientY;
    });

    window.addEventListener("mousemove", (e: MouseEvent): void => {
      if (!this._isDragging || !this._helmet) {
        return;
      }
      const dx = e.clientX - this._lastMouseX;
      const dy = e.clientY - this._lastMouseY;
      this._lastMouseX = e.clientX;
      this._lastMouseY = e.clientY;

      // Spin around Y axis (horizontal drag) and rotate on X axis (vertical drag)
      this._helmet.rotation.y += dx * 0.007;
      this._helmet.rotation.x += dy * 0.007;

      // Clamp vertical rotation to avoid flipping upside down (max 60 deg)
      const maxPitch = Math.PI / 3;
      this._helmet.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, this._helmet.rotation.x));

      this._helmet.updateMatrixWorld();
    });

    window.addEventListener("mouseup", (): void => {
      this._isDragging = false;
    });
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);

    // Auto-resize check: dynamically adapt canvas WebGPU swapchain if container dimensions change
    const container = this.canvas.parentElement;
    if (container) {
      const maxRatio = this.renderer?.quality.maxPixelRatio ?? 2;
      const d = Math.min(window.devicePixelRatio || 1, maxRatio);
      const targetW = container.clientWidth;
      const targetH = container.clientHeight;
      if (
        targetW > 0 &&
        targetH > 0 &&
        (Math.abs(this.canvas.width - targetW * d) > 2 ||
          Math.abs(this.canvas.height - targetH * d) > 2)
      ) {
        this.resizeToContainer();
      }
    }

    // Auto-rotate the helmet slowly, but only when not actively dragging
    if (this._helmet && !this._isDragging) {
      this._helmet.rotation.y += deltaTime * 0.15;
      this._helmet.updateMatrixWorld();
    }
  }

  /** Resizes canvas matching its cinematic frame parent client sizes. */
  public resizeToContainer(): void {
    if (!this.canvas || !this.renderer) {
      return;
    }
    const container = this.canvas.parentElement;
    if (container) {
      let width = container.clientWidth;
      let height = container.clientHeight;
      // Fallback: If container width/height are zero because it is not laid out yet
      if (width <= 0 || height <= 0) {
        width = Math.floor(window.innerWidth * 0.9);
        height = Math.floor(window.innerHeight * 0.75);
      }
      this.canvas.width = width;
      this.canvas.height = height;
      this.renderer.setSize(width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }
}

// ============================================================================
// 2. Slide Navigation HUD & Controller Logic
// ============================================================================

class PresentationController {
  private _currentSlideIndex: number = 0;
  private _totalSlides: number = 5;
  private _app?: PresentationDemoApp;

  // DOM Elements
  private _slidesContainer!: HTMLDivElement;
  private _progressBar!: HTMLDivElement;
  private _slideCounter!: HTMLDivElement;
  private _slideTimer!: HTMLDivElement;
  private _prevBtn!: HTMLDivElement;
  private _nextBtn!: HTMLDivElement;

  private _slideSecondsElapsed: number = 0;
  private _timerIntervalId: number | null = null;

  constructor() {
    this._initDOMElements();
    if (!this._slidesContainer) return;
    this._setupEvents();
    this._updateUI();
    this._startTimer();

    // Start Slide 5 Demo App in background to preload model
    this._app = new PresentationDemoApp();
    this._app
      .start()
      .then((): void => {
        this._app?.resizeToContainer();
        // Pause loop immediately because we start on slide 1 (index 0)
        if (4 !== this._currentSlideIndex) {
          this._app?.stop();
        }
      })
      .catch((err: unknown): void => {
        console.error("Failed to start presentation 3D app:", err);
      });

    // Resize canvas on window resize depending on active slide
    window.addEventListener("resize", (): void => {
      if (4 === this._currentSlideIndex) {
        this._app?.resizeToContainer();
      }
    });
  }

  private _initDOMElements(): void {
    this._slidesContainer = document.getElementById("slidesContainer") as HTMLDivElement;
    this._progressBar = document.getElementById("progressBar") as HTMLDivElement;
    this._slideCounter = document.getElementById("slideCounter") as HTMLDivElement;
    this._slideTimer = document.getElementById("slideTimer") as HTMLDivElement;
    this._prevBtn = document.getElementById("prevBtn") as HTMLDivElement;
    this._nextBtn = document.getElementById("nextBtn") as HTMLDivElement;
  }

  private _setupEvents(): void {
    // Keyboard navigation
    window.addEventListener("keydown", (event: KeyboardEvent): void => {
      // UX refinement: If cursor pointer is locked to 3D canvas on slide 5,
      // prevent slide navigation so WASD and look controls don't skip slides.
      if (document.pointerLockElement) {
        return;
      }

      if ("ArrowRight" === event.code || "Space" === event.code || "PageDown" === event.code) {
        event.preventDefault();
        this.nextSlide();
      } else if ("ArrowLeft" === event.code || "PageUp" === event.code) {
        event.preventDefault();
        this.prevSlide();
      }
    });

    // Navigation buttons
    if (this._prevBtn && this._nextBtn) {
      this._prevBtn.addEventListener("click", (): void => this.prevSlide());
      this._nextBtn.addEventListener("click", (): void => this.nextSlide());
    }
  }

  public goToSlide(index: number): void {
    const targetIndex = Math.max(0, Math.min(index, this._totalSlides - 1));
    if (this._currentSlideIndex === targetIndex) {
      return;
    }

    const prevIndex = this._currentSlideIndex;
    this._currentSlideIndex = targetIndex;

    this._updateUI();
    this._startTimer();

    // Demo App Loop Control (Slide 5, index 4)
    if (4 === targetIndex) {
      // Entering slide 5: start loop and ensure canvas matches container dimensions
      setTimeout((): void => {
        if (this._app) {
          this._app.resizeToContainer();
          this._app.start().catch((err): void => console.error("Error resuming app loop:", err));
        }
      }, 50);
    } else if (4 === prevIndex) {
      // Leaving slide 5: pause loop to save GPU compute power
      this._app?.stop();
    }
  }

  public nextSlide(): void {
    if (this._currentSlideIndex < this._totalSlides - 1) {
      this.goToSlide(this._currentSlideIndex + 1);
    }
  }

  public prevSlide(): void {
    if (this._currentSlideIndex > 0) {
      this.goToSlide(this._currentSlideIndex - 1);
    }
  }

  private _updateUI(): void {
    // 1. Shift slides container via horizontal translate
    const percentage = -(this._currentSlideIndex * 20); // 20% per slide (5 slides total)
    this._slidesContainer.style.transform = `translateX(${percentage}%)`;

    // 2. Update navigation button disabled states
    if (0 === this._currentSlideIndex) {
      this._prevBtn.classList.add("disabled");
    } else {
      this._prevBtn.classList.remove("disabled");
    }

    if (this._currentSlideIndex === this._totalSlides - 1) {
      this._nextBtn.classList.add("disabled");
    } else {
      this._nextBtn.classList.remove("disabled");
    }

    // 3. Update top progress bar
    const progressPercentage = (this._currentSlideIndex / (this._totalSlides - 1)) * 100;
    this._progressBar.style.width = `${progressPercentage}%`;

    // 5. Update slide counter text
    this._slideCounter.textContent = `${this._currentSlideIndex + 1} / ${this._totalSlides}`;

    // 6. Update body class to toggle styling cues (e.g. cinema bars slide-in)
    document.body.className = `slide-active-${this._currentSlideIndex + 1}`;
  }

  private _startTimer(): void {
    this._slideSecondsElapsed = 0;
    this._updateTimerDisplay();
    if (this._timerIntervalId !== null) {
      clearInterval(this._timerIntervalId);
    }
    this._timerIntervalId = window.setInterval((): void => {
      this._slideSecondsElapsed++;
      this._updateTimerDisplay();
    }, 1000);
  }

  private _updateTimerDisplay(): void {
    if (!this._slideTimer) {
      return;
    }
    const mins = Math.floor(this._slideSecondsElapsed / 60);
    const secs = this._slideSecondsElapsed % 60;
    const minsStr = mins.toString().padStart(2, "0");
    const secsStr = secs.toString().padStart(2, "0");
    this._slideTimer.textContent = `${minsStr}:${secsStr}`;
  }
}

// Bootstrap presentation viewer on content load
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", (): void => {
    new PresentationController();
  });
}
