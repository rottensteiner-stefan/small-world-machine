import type { GeometryDataInterface } from "@small-world-machine/engine";
import {
  AbstractShowcase,
  AmbientLight,
  Arch,
  Barrel,
  CameraStrategyType,
  Capsule,
  Color,
  Cone,
  Cube,
  Cylinder,
  DirectionalLight,
  Gear,
  Ground,
  LambertMaterial,
  LShape,
  Object3D,
  Octahedron,
  OrbitController,
  PhongMaterial,
  Pyramid,
  Sphere,
  Torus,
  TriStar,
  WireframeMaterial,
} from "@small-world-machine/engine";

interface GeometryEntry {
  id: string;
  name: string;
  icon: string;
  create: () => GeometryDataInterface;
}

const GEOMETRY_REGISTRY: GeometryEntry[] = [
  {
    id: "cube",
    name: "Cube (Würfel)",
    icon: "🧊",
    create: () => new Cube({ size: 2 }).getGeometryData(),
  },
  {
    id: "sphere",
    name: "Sphere (Kugel)",
    icon: "🔮",
    create: () =>
      new Sphere({ radius: 1.25, widthSegments: 32, heightSegments: 24 }).getGeometryData(),
  },
  {
    id: "cylinder",
    name: "Cylinder (Zylinder)",
    icon: "🥫",
    create: () =>
      new Cylinder({
        radiusTop: 0.9,
        radiusBottom: 0.9,
        height: 2.2,
        radialSegments: 32,
      }).getGeometryData(),
  },
  {
    id: "torus",
    name: "Torus (Donut)",
    icon: "🍩",
    create: () =>
      new Torus({
        radius: 1.1,
        tube: 0.45,
        radialSegments: 24,
        tubularSegments: 40,
      }).getGeometryData(),
  },
  {
    id: "cone",
    name: "Cone (Kegel)",
    icon: "🍦",
    create: () => new Cone({ radius: 1.2, height: 2.2, radialSegments: 32 }).getGeometryData(),
  },
  {
    id: "capsule",
    name: "Capsule (Kapsel)",
    icon: "💊",
    create: () =>
      new Capsule({
        radius: 0.65,
        length: 1.2,
        capSegments: 16,
        radialSegments: 24,
      }).getGeometryData(),
  },
  {
    id: "pyramid",
    name: "Pyramid (Pyramide)",
    icon: "🔺",
    create: () => new Pyramid({ base: 2.0, height: 2.2, radialSegments: 4 }).getGeometryData(),
  },
  {
    id: "octahedron",
    name: "Octahedron (Oktaeder)",
    icon: "💎",
    create: () => new Octahedron({ radius: 1.4 }).getGeometryData(),
  },
  {
    id: "gear",
    name: "Gear (Zahnrad)",
    icon: "⚙️",
    create: () =>
      new Gear({ teeth: 8, innerRadius: 0.9, toothHeight: 0.4, thickness: 0.5 }).getGeometryData(),
  },
  {
    id: "barrel",
    name: "Barrel (Fass)",
    icon: "🛢️",
    create: () =>
      new Barrel({
        radiusMiddle: 1.1,
        radiusEnds: 0.8,
        height: 2.0,
        radialSegments: 32,
      }).getGeometryData(),
  },
  {
    id: "arch",
    name: "Arch (Rundbogen)",
    icon: "🏛️",
    create: () => new Arch({ length: 2.6, height: 2.0, depth: 0.8, radius: 0.9 }).getGeometryData(),
  },
  {
    id: "tristar",
    name: "TriStar (Dreistern)",
    icon: "⭐",
    create: () =>
      new TriStar({ armLength: 1.2, innerAngle: Math.PI / 6, depth: 0.6 }).getGeometryData(),
  },
  {
    id: "lshape",
    name: "L-Shape (Winkelprofil)",
    icon: "📐",
    create: () =>
      new LShape({ width: 2.0, height: 2.0, thickness: 0.6, depth: 0.8 }).getGeometryData(),
  },
];

const COLOR_SWATCHES = [
  { name: "Dodger Blue", hex: "#1e90ff" },
  { name: "Showcase Purple", hex: "#b000ff" },
  { name: "Emerald Green", hex: "#10b981" },
  { name: "Amber Gold", hex: "#f59e0b" },
  { name: "Crimson Red", hex: "#e11d48" },
  { name: "Cyan Aqua", hex: "#06b6d4" },
  { name: "Magenta Pink", hex: "#d946ef" },
  { name: "Pure White", hex: "#ffffff" },
];

class Showcase1 extends AbstractShowcase {
  private _activeMesh!: Object3D;
  private _phongMaterial!: PhongMaterial;
  private _wireframeMaterial!: WireframeMaterial;
  private _sun!: DirectionalLight;
  private _shadowResolution: number = 4096;

  private _selectedGeometryId: string = "cube";
  private _selectedColorHex: string = "#1e90ff";
  private _shininess: number = 60;
  private _autoRotate: boolean = true;
  private _rotateSpeed: number = 1.0;
  private _isWireframe: boolean = false;
  private _wireframeCastsShadow: boolean = true;

  private _hudElement: HTMLElement | null = null;
  private _inspectorBtn: HTMLButtonElement | null = null;

  protected override async setupScene(): Promise<void> {
    this.defaultFov = (75 * Math.PI) / 180;
    this.configureCamera();

    // 1. Lighting: Directional Sun + Ambient fill
    const sun = new DirectionalLight({ color: Color.WHITE, intensity: 1.0 });
    sun.direction.set(-1, -1, -1);
    sun.castShadow = true;
    sun.shadowResolution = this._shadowResolution;
    sun.shadowBias = 0.005;
    this._sun = sun;
    this.scene.add(sun);

    this.scene.add(new AmbientLight({ color: Color.WHITE, intensity: 0.25 }));

    // 2. Materials
    this._phongMaterial = new PhongMaterial({
      color: Color.fromHex(this._selectedColorHex),
      shininess: this._shininess,
    });

    this._wireframeMaterial = new WireframeMaterial({
      color: Color.fromHex(this._selectedColorHex),
    });

    // 3. Central Interactive Mesh
    this._activeMesh = new Object3D("InteractiveMesh").setPosition(0, 0, 0).setScale(1);
    this._activeMesh.geometry = GEOMETRY_REGISTRY[0]!.create();
    this._activeMesh.material = this._phongMaterial;
    this._activeMesh.castShadow = true;
    this._activeMesh.receiveShadow = true;
    this.scene.add(this._activeMesh);

    // 4. Ground floor
    const floor = new Object3D("Floor").setPosition(0, -2, 0);
    floor.geometry = new Ground({ width: 10, depth: 10 }).getGeometryData();
    floor.material = new LambertMaterial({ color: Color.WHITE });
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 5. Camera & Orbit Controller
    this.camera.setStrategy(CameraStrategyType.SMOOTH);
    this.camera.position.set(0, 3, 6);
    this.camera.target.set(0, 0, 0);
    this.camera.addBehavior(new OrbitController({ input: this.input }));
    this.camera.updateViewMatrix();

    // 6. UI Controls
    this._createInspectorUI();
  }

  protected override update(deltaTime: number): void {
    if (this._autoRotate && this._activeMesh) {
      this._activeMesh.rotation.x += deltaTime * this._rotateSpeed;
      this._activeMesh.rotation.y += 1.5 * deltaTime * this._rotateSpeed;
    }
  }

  private _setGeometry(id: string): void {
    const entry = GEOMETRY_REGISTRY.find((g) => g.id === id);
    if (!entry) return;
    this._selectedGeometryId = id;
    this._activeMesh.geometry = entry.create();
  }

  private _setColor(hex: string): void {
    this._selectedColorHex = hex;
    const color = Color.fromHex(hex);
    this._phongMaterial.color.copyFrom(color);
    this._wireframeMaterial.color.copyFrom(color);

    const picker = document.getElementById("pickerColor") as HTMLInputElement | null;
    if (picker && picker.value.toLowerCase() !== hex.toLowerCase()) {
      picker.value = hex;
    }

    const hexLabel = document.getElementById("valHex");
    if (hexLabel) {
      hexLabel.textContent = hex.toUpperCase();
    }

    // Update active swatch indicator
    document.querySelectorAll(".btn-swatch").forEach((btn) => {
      const bHex = btn.getAttribute("data-hex");
      btn.classList.toggle("active", bHex?.toLowerCase() === hex.toLowerCase());
    });
  }

  private _setShadowResolution(val: number): void {
    this._shadowResolution = val;
    this._sun.shadowResolution = val;
    const label = document.getElementById("valShadowRes");
    if (label) {
      label.textContent = `${val} px`;
    }
  }

  private _setShininess(val: number): void {
    this._shininess = val;
    this._phongMaterial.shininess = val;
    const label = document.getElementById("valShininess");
    if (label) {
      label.textContent = val.toString();
    }
  }

  private _setWireframe(active: boolean): void {
    this._isWireframe = active;
    this._activeMesh.material = active ? this._wireframeMaterial : this._phongMaterial;
    this._applyCastShadow();
  }

  private _applyCastShadow(): void {
    this._activeMesh.castShadow = !this._isWireframe || this._wireframeCastsShadow;
  }

  private _toggleInspector(force?: boolean): void {
    if (!this._hudElement) return;
    const isCurrentlyOpen = this._hudElement.classList.contains("open");
    const open = undefined !== force ? force : !isCurrentlyOpen;
    if (open) {
      this._hudElement.classList.add("open");
      this._inspectorBtn?.classList.add("active");
    } else {
      this._hudElement.classList.remove("open");
      this._inspectorBtn?.classList.remove("active");
    }
  }

  private _createInspectorUI(): void {
    const existingHud = document.getElementById("showcase1-inspector");
    if (existingHud) existingHud.remove();
    const existingBtn = document.getElementById("showcase1InspectorBtn");
    if (existingBtn) existingBtn.remove();

    const hud = document.createElement("aside");
    hud.id = "showcase1-inspector";
    hud.className = "swm-inspector-drawer";
    document.body.appendChild(hud);
    this._hudElement = hud;

    // Prevent camera rotation when interacting with the panel
    const stopEvents = [
      "mousedown",
      "mouseup",
      "mousemove",
      "pointerdown",
      "pointerup",
      "pointermove",
      "wheel",
      "touchstart",
      "touchmove",
      "touchend",
      "click",
      "dblclick",
      "contextmenu",
    ];
    for (const ev of stopEvents) {
      hud.addEventListener(
        ev,
        (e) => {
          e.stopPropagation();
        },
        { passive: "wheel" === ev || "touchstart" === ev || "touchmove" === ev },
      );
    }

    // Footer Gear Button
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "showcase1InspectorBtn";
    toggleBtn.className = "swm-inspector-btn";
    toggleBtn.innerHTML = "<span>⚙</span>";
    toggleBtn.title = "Settings & Geometry (Toggle)";
    toggleBtn.setAttribute("aria-label", "Toggle Inspector");
    toggleBtn.onclick = (): void => {
      this._toggleInspector();
    };
    this._inspectorBtn = toggleBtn;

    const footer = document.querySelector(".app-footer");
    if (footer) {
      footer.appendChild(toggleBtn);
    } else {
      document.body.appendChild(toggleBtn);
      setTimeout(() => {
        const f = document.querySelector(".app-footer");
        if (f && toggleBtn.parentNode !== f) {
          f.appendChild(toggleBtn);
        }
      }, 100);
    }

    this._renderInspectorContent();
  }

  private _renderInspectorContent(): void {
    if (!this._hudElement) return;

    this._hudElement.innerHTML = `
      <div class="bottom-sheet-grabber"></div>
      <div class="hud-header">
        <div class="hud-title">
          <span>🔷</span> Shape & Material
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="hud-badge">Showcase 01</span>
          <button id="showcase1HudClose" class="hud-close-btn" title="Close Inspector">✕</button>
        </div>
      </div>
      <div class="hud-body">
        <!-- Section 1: Geometry -->
        <div class="hud-section">
          <div class="section-title">🔷 3D Geometry Primitive</div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;">
            <label for="selGeometry">Active Primitive</label>
            <select id="selGeometry" style="width:100%;font-size:12px;padding:6px 8px;">
              ${GEOMETRY_REGISTRY.map(
                (g) => `
                <option value="${g.id}" ${g.id === this._selectedGeometryId ? "selected" : ""}>
                  ${g.icon} ${g.name}
                </option>
              `,
              ).join("")}
            </select>
          </div>
        </div>

        <!-- Section 2: Material & Color -->
        <div class="hud-section">
          <div class="section-title">🎨 Color & Material Palette</div>
          
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;margin-bottom:10px;">
            ${COLOR_SWATCHES.map(
              (s) => `
              <button 
                class="btn-preset btn-swatch ${s.hex.toLowerCase() === this._selectedColorHex.toLowerCase() ? "active" : ""}" 
                data-hex="${s.hex}"
                style="display:flex;align-items:center;gap:5px;padding:5px 6px;justify-content:flex-start;"
                title="${s.name}"
              >
                <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${s.hex};border:1px solid rgba(255,255,255,0.4);flex-shrink:0;"></span>
                <span style="font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name.split(" ")[0]}</span>
              </button>
            `,
            ).join("")}
          </div>

          <div class="hud-row">
            <label for="pickerColor">Custom Color</label>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="val-label" id="valHex">${this._selectedColorHex.toUpperCase()}</span>
              <input type="color" id="pickerColor" value="${this._selectedColorHex}" style="width:34px;height:24px;border:none;border-radius:4px;cursor:pointer;background:transparent;" />
            </div>
          </div>

          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;margin-top:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <label for="sliderShininess">Phong Specular Shininess</label>
              <span class="val-label" id="valShininess">${this._shininess}</span>
            </div>
            <input type="range" id="sliderShininess" min="10" max="150" step="5" value="${this._shininess}" />
          </div>
        </div>

        <!-- Section 3: Motion & Wireframe -->
        <div class="hud-section">
          <div class="section-title">🔄 Motion & Display Mode</div>
          <div class="hud-row">
            <label for="swAutoRotate">Auto-Rotate</label>
            <label class="hud-switch">
              <input type="checkbox" id="swAutoRotate" ${this._autoRotate ? "checked" : ""}>
              <span class="hud-switch-slider"></span>
            </label>
          </div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <label for="sliderSpeed">Rotation Speed</label>
              <span class="val-label" id="valSpeed">${this._rotateSpeed.toFixed(1)}x</span>
            </div>
            <input type="range" id="sliderSpeed" min="0.2" max="3.0" step="0.1" value="${this._rotateSpeed}" />
          </div>
          <div class="hud-row" style="margin-top:4px;">
            <label for="swWireframe">Wireframe Mode</label>
            <label class="hud-switch">
              <input type="checkbox" id="swWireframe" ${this._isWireframe ? "checked" : ""}>
              <span class="hud-switch-slider"></span>
            </label>
          </div>
          <div class="hud-row">
            <label for="swWireShadow">Wireframe casts shadow</label>
            <label class="hud-switch">
              <input type="checkbox" id="swWireShadow" ${this._wireframeCastsShadow ? "checked" : ""}>
              <span class="hud-switch-slider"></span>
            </label>
          </div>
          <div class="hud-row" style="flex-direction:column;align-items:stretch;gap:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <label for="sliderShadowRes">Shadow Map Resolution</label>
              <span class="val-label" id="valShadowRes">${this._shadowResolution} px</span>
            </div>
            <input type="range" id="sliderShadowRes" min="8" max="13" step="1" value="${Math.log2(this._shadowResolution)}" />
          </div>
        </div>
      </div>
    `;

    // Event listeners
    document.getElementById("showcase1HudClose")?.addEventListener("click", () => {
      this._toggleInspector(false);
    });

    document.getElementById("selGeometry")?.addEventListener("change", (e) => {
      const val = (e.target as HTMLSelectElement).value;
      this._setGeometry(val);
    });

    this._hudElement.querySelectorAll<HTMLButtonElement>(".btn-swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        const hex = btn.getAttribute("data-hex");
        if (hex) this._setColor(hex);
      });
    });

    document.getElementById("pickerColor")?.addEventListener("input", (e) => {
      const hex = (e.target as HTMLInputElement).value;
      this._setColor(hex);
    });

    document.getElementById("sliderShininess")?.addEventListener("input", (e) => {
      const val = parseInt((e.target as HTMLInputElement).value, 10);
      this._setShininess(val);
    });

    document.getElementById("swAutoRotate")?.addEventListener("change", (e) => {
      this._autoRotate = (e.target as HTMLInputElement).checked;
    });

    document.getElementById("sliderSpeed")?.addEventListener("input", (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this._rotateSpeed = val;
      const label = document.getElementById("valSpeed");
      if (label) label.textContent = `${val.toFixed(1)}x`;
    });

    document.getElementById("swWireframe")?.addEventListener("change", (e) => {
      this._setWireframe((e.target as HTMLInputElement).checked);
    });

    document.getElementById("swWireShadow")?.addEventListener("change", (e) => {
      this._wireframeCastsShadow = (e.target as HTMLInputElement).checked;
      this._applyCastShadow();
    });

    document.getElementById("sliderShadowRes")?.addEventListener("input", (e) => {
      const exp = parseInt((e.target as HTMLInputElement).value, 10);
      this._setShadowResolution(2 ** exp);
    });
  }

  public override destroy(): void {
    if (this._hudElement && this._hudElement.parentNode) {
      this._hudElement.parentNode.removeChild(this._hudElement);
    }
    if (this._inspectorBtn && this._inspectorBtn.parentNode) {
      this._inspectorBtn.parentNode.removeChild(this._inspectorBtn);
    }
    super.destroy();
  }
}

// === START THE ENGINE ===
const app = new Showcase1();
app.start().catch((err: unknown) => console.error("[Showcase1] Failed to start:", err));
