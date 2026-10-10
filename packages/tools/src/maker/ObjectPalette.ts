import {
  Object3D,
  SpawnPoint,
  StandardMaterial,
  Color,
  Vector3D,
  PointLight,
  DirectionalLight,
  SpotLight,
  AmbientLight,
  Behavior,
  RotatorBehavior,
  HoverBehavior,
  BobbingBehavior,
  PulsatingBehavior,
  LookAtBehavior,
  FlickerBehavior,
  Cube,
  Sphere,
  Cylinder,
  Plane,
  Capsule,
  Cone,
  Torus,
  Pyramid,
} from "@small-world-machine/engine";

export interface PaletteCallbacks {
  /** Adds a freshly-built object as a child of the current scene root. */
  createObject(factory: () => Object3D): void;
  /** Attaches a freshly-built behavior to the currently selected object, if any. */
  attachBehavior(factory: () => Behavior): void;
}

interface PaletteTileItem {
  icon: string;
  label: string;
  tooltip: string;
  action: () => void;
}

/**
 * Modern categorized icon grid for Maker's object palette, surfacing all 3D primitives,
 * lights, structural helpers, and behaviors with zero vertical bloat.
 */
export class ObjectPalette {
  constructor(container: HTMLElement, callbacks: PaletteCallbacks) {
    container.classList.add("maker-palette");

    // 1. 3D Primitives Grid
    this._addSection(container, "3D Primitives");
    const matFactory = (): StandardMaterial =>
      new StandardMaterial({ color: Color.WHITE, metallic: 0, roughness: 0.6 });

    this._addGrid(container, [
      {
        icon: "🧊",
        label: "Cube",
        tooltip: "Add Cube (1×1×1m)",
        action: (): void =>
          callbacks.createObject(() => {
            const obj = new Object3D("Cube");
            obj.geometry = new Cube({ size: 1 }).getGeometryData();
            obj.material = matFactory();
            return obj;
          }),
      },
      {
        icon: "⚪",
        label: "Sphere",
        tooltip: "Add Sphere (Radius 0.5m)",
        action: (): void =>
          callbacks.createObject(() => {
            const obj = new Object3D("Sphere");
            obj.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
            obj.material = matFactory();
            return obj;
          }),
      },
      {
        icon: "🥫",
        label: "Cylinder",
        tooltip: "Add Cylinder (Radius 0.5m, Height 1m)",
        action: (): void =>
          callbacks.createObject(() => {
            const obj = new Object3D("Cylinder");
            obj.geometry = new Cylinder({
              radiusTop: 0.5,
              radiusBottom: 0.5,
              height: 1,
            }).getGeometryData();
            obj.material = matFactory();
            return obj;
          }),
      },
      {
        icon: "⏹️",
        label: "Plane",
        tooltip: "Add Flat Plane / Floor (1×1m)",
        action: (): void =>
          callbacks.createObject(() => {
            const obj = new Object3D("Plane");
            obj.geometry = new Plane({ width: 1, height: 1 }).getGeometryData();
            obj.material = matFactory();
            return obj;
          }),
      },
      {
        icon: "💊",
        label: "Capsule",
        tooltip: "Add Capsule (Radius 0.3m, Length 0.8m)",
        action: (): void =>
          callbacks.createObject(() => {
            const obj = new Object3D("Capsule");
            obj.geometry = new Capsule({ radius: 0.3, length: 0.8 }).getGeometryData();
            obj.material = matFactory();
            return obj;
          }),
      },
      {
        icon: "📐",
        label: "Cone",
        tooltip: "Add Cone (Radius 0.5m, Height 1m)",
        action: (): void =>
          callbacks.createObject(() => {
            const obj = new Object3D("Cone");
            obj.geometry = new Cone({ radius: 0.5, height: 1 }).getGeometryData();
            obj.material = matFactory();
            return obj;
          }),
      },
      {
        icon: "🍩",
        label: "Torus",
        tooltip: "Add Torus / Donut (Radius 0.5m, Tube 0.15m)",
        action: (): void =>
          callbacks.createObject(() => {
            const obj = new Object3D("Torus");
            obj.geometry = new Torus({ radius: 0.5, tube: 0.15 }).getGeometryData();
            obj.material = matFactory();
            return obj;
          }),
      },
      {
        icon: "🔺",
        label: "Pyramid",
        tooltip: "Add Pyramid (Base 1m, Height 1m)",
        action: (): void =>
          callbacks.createObject(() => {
            const obj = new Object3D("Pyramid");
            obj.geometry = new Pyramid({ base: 1, height: 1 }).getGeometryData();
            obj.material = matFactory();
            return obj;
          }),
      },
    ]);

    // 2. Lights Grid
    this._addSection(container, "Lights");
    this._addGrid(container, [
      {
        icon: "💡",
        label: "Point",
        tooltip: "Add Omni Point Light",
        action: (): void => callbacks.createObject(() => new PointLight({ name: "PointLight" })),
      },
      {
        icon: "☀️",
        label: "Sun",
        tooltip: "Add Directional Sun Light",
        action: (): void =>
          callbacks.createObject(() => new DirectionalLight({ name: "DirectionalLight" })),
      },
      {
        icon: "🔦",
        label: "Spot",
        tooltip: "Add Focused Spot Light",
        action: (): void => callbacks.createObject(() => new SpotLight({ name: "SpotLight" })),
      },
      {
        icon: "🌐",
        label: "Ambient",
        tooltip: "Add Ambient Sky Light",
        action: (): void =>
          callbacks.createObject(() => new AmbientLight({ name: "AmbientLight" })),
      },
    ]);

    // 3. Structure & Helpers Grid
    this._addSection(container, "Structure");
    this._addGrid(container, [
      {
        icon: "📁",
        label: "Group",
        tooltip: "Add Empty Group / Node",
        action: (): void => callbacks.createObject(() => new Object3D("Group")),
      },
      {
        icon: "📍",
        label: "Spawn",
        tooltip: "Add Player Spawn Point (1.8m Silhouette & Forward Direction)",
        action: (): void => callbacks.createObject(() => new SpawnPoint()),
      },
    ]);

    // 4. Behaviors Grid
    this._addSection(container, "Behaviors (Attach)");
    this._addGrid(container, [
      {
        icon: "🔄",
        label: "Rotator",
        tooltip: "Attach Continuous Rotation Behavior",
        action: (): void => callbacks.attachBehavior(() => new RotatorBehavior()),
      },
      {
        icon: "🛸",
        label: "Hover",
        tooltip: "Attach Gentle Hover Floating Behavior",
        action: (): void => callbacks.attachBehavior(() => new HoverBehavior()),
      },
      {
        icon: "🌊",
        label: "Bobbing",
        tooltip: "Attach Vertical Sine Bobbing Behavior",
        action: (): void => callbacks.attachBehavior(() => new BobbingBehavior()),
      },
      {
        icon: "💓",
        label: "Pulse",
        tooltip: "Attach Scale Pulsating Behavior",
        action: (): void =>
          callbacks.attachBehavior(
            () =>
              new PulsatingBehavior({
                min: 0.8,
                max: 1.2,
                onUpdate: (val: number, obj: Object3D): void => {
                  obj.scale.set(val, val, val);
                },
              }),
          ),
      },
      {
        icon: "👁️",
        label: "LookAt",
        tooltip: "Attach Target LookAt Tracking Behavior",
        action: (): void =>
          callbacks.attachBehavior(() => new LookAtBehavior(new Vector3D(0, 0, 0))),
      },
      {
        icon: "⚡",
        label: "Flicker",
        tooltip: "Attach Light / Emissive Flicker Behavior",
        action: (): void =>
          callbacks.attachBehavior(
            () =>
              new FlickerBehavior({
                minStableTime: 2.0,
                maxStableTime: 6.0,
                onUpdate: (multiplier: number, obj: Object3D): void => {
                  obj.isVisible = multiplier > 0.3;
                },
              }),
          ),
      },
    ]);
  }

  private _addSection(container: HTMLElement, title: string): void {
    const heading = document.createElement("h4");
    heading.className = "maker-palette-section";
    heading.textContent = title;
    container.appendChild(heading);
  }

  private _addGrid(container: HTMLElement, items: PaletteTileItem[]): void {
    const grid = document.createElement("div");
    grid.className = "maker-palette-grid";
    for (const item of items) {
      const btn = document.createElement("button");
      btn.className = "maker-palette-tile";
      btn.title = item.tooltip;

      const iconSpan = document.createElement("span");
      iconSpan.className = "maker-palette-icon";
      iconSpan.textContent = item.icon;

      const labelSpan = document.createElement("span");
      labelSpan.className = "maker-palette-label";
      labelSpan.textContent = item.label;

      btn.appendChild(iconSpan);
      btn.appendChild(labelSpan);
      btn.addEventListener("click", item.action);
      grid.appendChild(btn);
    }
    container.appendChild(grid);
  }
}
