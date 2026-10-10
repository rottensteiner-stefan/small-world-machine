import {
  Object3D,
  KitRegistry,
  Vector3D,
  StandardMaterial,
  Color,
  Cube,
  Sphere,
  Cylinder,
  Plane,
  Capsule,
  Cone,
  Torus,
  Pyramid,
  PointLight,
  DirectionalLight,
  SpotLight,
  AmbientLight,
  SpawnPoint,
} from "@small-world-machine/engine";

export type ContentAssetType = "prop" | "texture" | "decal" | "primitive" | "light" | "prefab";

export interface ContentRaycastHit {
  position: Vector3D;
  targetObject?: Object3D | undefined;
  normal?: Vector3D | undefined;
}

export interface ContentAssetItem {
  id: string;
  name: string;
  type: ContentAssetType;
  category?: string | undefined;
  kitId?: string | undefined;
  previewUrl?: string | undefined;
  icon?: string | undefined;
  folderPath: string; // e.g. "Kits/Flakturm/Props", "Primitives/3D", "Prefabs"
  factory?: (() => Object3D) | undefined;
  raw?: unknown;
}

export interface ContentDrawerCallbacks {
  /** Instantiate a Kit prop at world coordinates */
  loadKitProp(kitPropId: string, worldPos?: Vector3D): Promise<Object3D | undefined>;
  /** Add a primitive / light object at world coordinates */
  createPrimitive(factory: () => Object3D, worldPos?: Vector3D): Object3D;
  /** Apply a PBR texture to a target object or create preview */
  applyTexture(kitId: string, textureItem: unknown, targetObject?: Object3D): Promise<void>;
  /** Add a decal into the scene */
  createDecal(kitId: string, decalItem: unknown, worldPos?: Vector3D): Promise<void>;
  /** Instantiate a project prefab */
  instantiatePrefab(name: string, worldPos?: Vector3D): Promise<void>;
  /** Get current camera raycast hit against scene geometry or ground plane */
  getRaycastHit?(screenX: number, screenY: number): ContentRaycastHit;
  /** Get current camera raycast ground position (fallback) */
  getGroundPosition?(screenX: number, screenY: number): Vector3D;
}

export interface ContentDrawerOptions {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  kitRegistry?: KitRegistry;
  callbacks: ContentDrawerCallbacks;
}

/**
 * Unreal Engine 5 style Content Drawer & Asset Browser for Maker.
 * Features:
 * - Collapsible dockable bottom drawer with Ctrl+Space / Cmd+Space shortcut
 * - Resizable height with smooth transitions
 * - Two-pane navigation: Hierarchical folder tree + Live asset tile grid
 * - Instant live search & asset-type filter pills (Props, PBR Textures, Decals, Primitives, Prefabs)
 * - Native HTML5 Drag & Drop directly onto the 3D viewport canvas with ground-plane raycasting
 * - Double-click / context menu to place or inspect assets
 */
export class ContentDrawer {
  private readonly _rootEl: HTMLElement;
  private readonly _drawerEl: HTMLElement;
  private readonly _toggleBtn: HTMLButtonElement;
  private readonly _treeContainer: HTMLElement;
  private readonly _gridContainer: HTMLElement;
  private readonly _breadcrumbsEl: HTMLElement;
  private readonly _searchInput: HTMLInputElement;
  private readonly _countBadge: HTMLElement;
  private readonly _kitRegistry: KitRegistry;

  private _isOpen = false;
  private _isPinned = false;
  private _currentFolder = "All";
  private _activeFilter: "all" | ContentAssetType = "all";
  private _searchQuery = "";
  private _assets: ContentAssetItem[] = [];
  private _folders = new Set<string>();

  constructor(private readonly _options: ContentDrawerOptions) {
    this._kitRegistry = _options.kitRegistry ?? new KitRegistry();

    // 1. Build DOM structure
    this._rootEl = document.createElement("div");
    this._rootEl.className = "maker-content-drawer-wrapper";

    // Bottom Toggle Bar
    const toggleBar = document.createElement("div");
    toggleBar.className = "maker-content-toggle-bar";

    this._toggleBtn = document.createElement("button");
    this._toggleBtn.className = "maker-content-toggle-btn";
    this._toggleBtn.innerHTML = `<span class="drawer-icon">📁</span> <span class="drawer-label">Content Drawer</span> <span class="drawer-shortcut">Ctrl+Space</span>`;
    this._toggleBtn.addEventListener("click", () => this.toggle());

    this._countBadge = document.createElement("span");
    this._countBadge.className = "maker-content-badge";
    this._countBadge.textContent = "0 Assets";

    toggleBar.appendChild(this._toggleBtn);
    toggleBar.appendChild(this._countBadge);

    // Main Drawer Area
    this._drawerEl = document.createElement("div");
    this._drawerEl.className = "maker-content-drawer";

    // Resizer Bar
    const resizer = document.createElement("div");
    resizer.className = "maker-content-resizer";
    this._setupResizer(resizer);

    // Header Toolbar
    const toolbar = document.createElement("div");
    toolbar.className = "maker-content-toolbar";

    this._breadcrumbsEl = document.createElement("div");
    this._breadcrumbsEl.className = "maker-content-breadcrumbs";

    const filterRow = document.createElement("div");
    filterRow.className = "maker-content-filters";

    const filterPills: Array<{ label: string; filter: "all" | ContentAssetType }> = [
      { label: "All", filter: "all" },
      { label: "Props", filter: "prop" },
      { label: "PBR Materials", filter: "texture" },
      { label: "Decals", filter: "decal" },
      { label: "Primitives", filter: "primitive" },
      { label: "Lights", filter: "light" },
      { label: "Prefabs", filter: "prefab" },
    ];

    for (const pill of filterPills) {
      const pillBtn = document.createElement("button");
      pillBtn.className = `maker-filter-pill ${pill.filter === "all" ? "active" : ""}`;
      pillBtn.textContent = pill.label;
      pillBtn.addEventListener("click", () => {
        toolbar.querySelectorAll(".maker-filter-pill").forEach((p) => p.classList.remove("active"));
        pillBtn.classList.add("active");
        this._activeFilter = pill.filter;
        this._renderGrid();
      });
      filterRow.appendChild(pillBtn);
    }

    const searchWrapper = document.createElement("div");
    searchWrapper.className = "maker-content-search-box";
    this._searchInput = document.createElement("input");
    this._searchInput.type = "text";
    this._searchInput.placeholder = "Search assets (Ctrl+F)...";
    this._searchInput.className = "maker-content-search-input";
    this._searchInput.addEventListener("input", () => {
      this._searchQuery = this._searchInput.value.toLowerCase().trim();
      this._renderGrid();
    });
    searchWrapper.appendChild(this._searchInput);

    const pinBtn = document.createElement("button");
    pinBtn.className = "maker-content-action-btn pin-btn";
    pinBtn.title = "Dock / Pin Drawer";
    pinBtn.innerHTML = "📌";
    pinBtn.addEventListener("click", () => {
      this._isPinned = !this._isPinned;
      pinBtn.classList.toggle("pinned", this._isPinned);
      this._rootEl.classList.toggle("pinned", this._isPinned);
    });

    const closeBtn = document.createElement("button");
    closeBtn.className = "maker-content-action-btn close-btn";
    closeBtn.title = "Close Drawer (Ctrl+Space)";
    closeBtn.innerHTML = "✕";
    closeBtn.addEventListener("click", () => this.close());

    toolbar.appendChild(this._breadcrumbsEl);
    toolbar.appendChild(filterRow);
    toolbar.appendChild(searchWrapper);
    toolbar.appendChild(pinBtn);
    toolbar.appendChild(closeBtn);

    // Body: Split View (Tree + Grid)
    const body = document.createElement("div");
    body.className = "maker-content-body";

    this._treeContainer = document.createElement("aside");
    this._treeContainer.className = "maker-content-tree-pane";

    this._gridContainer = document.createElement("main");
    this._gridContainer.className = "maker-content-grid-pane";

    body.appendChild(this._treeContainer);
    body.appendChild(this._gridContainer);

    this._drawerEl.appendChild(resizer);
    this._drawerEl.appendChild(toolbar);
    this._drawerEl.appendChild(body);

    this._rootEl.appendChild(this._drawerEl);
    this._rootEl.appendChild(toggleBar);
    _options.container.appendChild(this._rootEl);

    // 2. Setup Drag & Drop on 3D Canvas
    this._setupCanvasDrop(_options.canvas);

    // 3. Setup Keyboard Shortcuts
    this._setupShortcuts();

    // 4. Initial Catalog Load
    this._loadBuiltInAssets();
    void this._loadKitAssets();
  }

  public get isOpen(): boolean {
    return this._isOpen;
  }

  public toggle(): void {
    if (this._isOpen) this.close();
    else this.open();
  }

  public open(): void {
    this._isOpen = true;
    this._rootEl.classList.add("open");
    this._toggleBtn.classList.add("active");
    this._renderBreadcrumbs();
    this._renderGrid();
  }

  public close(): void {
    if (this._isPinned) return;
    this._isOpen = false;
    this._rootEl.classList.remove("open");
    this._toggleBtn.classList.remove("active");
  }

  public refreshPrefabs(prefabs: Array<{ name: string; thumbnailDataUrl?: string }>): void {
    // Remove old prefabs
    this._assets = this._assets.filter((a) => a.type !== "prefab");
    for (const p of prefabs) {
      this._assets.push({
        id: `prefab/${p.name}`,
        name: p.name,
        type: "prefab",
        category: "Prefabs",
        folderPath: "Prefabs",
        previewUrl: p.thumbnailDataUrl,
        icon: "▣",
      });
    }
    this._folders.add("Prefabs");
    this._renderTree();
    this._renderGrid();
  }

  // --- Catalog Loaders ---

  private _loadBuiltInAssets(): void {
    const matFactory = (): StandardMaterial =>
      new StandardMaterial({ color: Color.WHITE, metallic: 0, roughness: 0.6 });

    // 3D Primitives
    const primitives: Array<{ name: string; icon: string; factory: () => Object3D }> = [
      {
        name: "Cube",
        icon: "🧊",
        factory: (): Object3D => {
          const obj = new Object3D("Cube");
          obj.geometry = new Cube({ size: 1 }).getGeometryData();
          obj.material = matFactory();
          return obj;
        },
      },
      {
        name: "Sphere",
        icon: "⚪",
        factory: (): Object3D => {
          const obj = new Object3D("Sphere");
          obj.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
          obj.material = matFactory();
          return obj;
        },
      },
      {
        name: "Cylinder",
        icon: "🥫",
        factory: (): Object3D => {
          const obj = new Object3D("Cylinder");
          obj.geometry = new Cylinder({
            radiusTop: 0.5,
            radiusBottom: 0.5,
            height: 1,
          }).getGeometryData();
          obj.material = matFactory();
          return obj;
        },
      },
      {
        name: "Plane",
        icon: "⏹️",
        factory: (): Object3D => {
          const obj = new Object3D("Plane");
          obj.geometry = new Plane({ width: 1, height: 1 }).getGeometryData();
          obj.material = matFactory();
          return obj;
        },
      },
      {
        name: "Capsule",
        icon: "💊",
        factory: (): Object3D => {
          const obj = new Object3D("Capsule");
          obj.geometry = new Capsule({ radius: 0.3, length: 0.8 }).getGeometryData();
          obj.material = matFactory();
          return obj;
        },
      },
      {
        name: "Cone",
        icon: "📐",
        factory: (): Object3D => {
          const obj = new Object3D("Cone");
          obj.geometry = new Cone({ radius: 0.5, height: 1 }).getGeometryData();
          obj.material = matFactory();
          return obj;
        },
      },
      {
        name: "Torus",
        icon: "🍩",
        factory: (): Object3D => {
          const obj = new Object3D("Torus");
          obj.geometry = new Torus({ radius: 0.5, tube: 0.15 }).getGeometryData();
          obj.material = matFactory();
          return obj;
        },
      },
      {
        name: "Pyramid",
        icon: "🔺",
        factory: (): Object3D => {
          const obj = new Object3D("Pyramid");
          obj.geometry = new Pyramid({ base: 1, height: 1 }).getGeometryData();
          obj.material = matFactory();
          return obj;
        },
      },
      {
        name: "SpawnPoint",
        icon: "📍",
        factory: (): Object3D => new SpawnPoint(),
      },
      {
        name: "Group",
        icon: "📁",
        factory: (): Object3D => new Object3D("Group"),
      },
    ];

    for (const p of primitives) {
      this._assets.push({
        id: `primitive/${p.name.toLowerCase()}`,
        name: p.name,
        type: "primitive",
        category: "Primitives",
        folderPath: "Primitives/3D",
        icon: p.icon,
        factory: p.factory,
      });
    }

    // Lights
    const lights: Array<{ name: string; icon: string; factory: () => Object3D }> = [
      {
        name: "PointLight",
        icon: "💡",
        factory: (): Object3D => new PointLight({ name: "PointLight" }),
      },
      {
        name: "SunLight",
        icon: "☀️",
        factory: (): Object3D => new DirectionalLight({ name: "SunLight" }),
      },
      {
        name: "SpotLight",
        icon: "🔦",
        factory: (): Object3D => new SpotLight({ name: "SpotLight" }),
      },
      {
        name: "AmbientLight",
        icon: "🌐",
        factory: (): Object3D => new AmbientLight({ name: "AmbientLight" }),
      },
    ];

    for (const l of lights) {
      this._assets.push({
        id: `light/${l.name.toLowerCase()}`,
        name: l.name,
        type: "light",
        category: "Lights",
        folderPath: "Primitives/Lights",
        icon: l.icon,
        factory: l.factory,
      });
    }

    this._folders.add("Primitives");
    this._folders.add("Primitives/3D");
    this._folders.add("Primitives/Lights");
  }

  private async _loadKitAssets(): Promise<void> {
    try {
      const index = (await this._kitRegistry.assetManager.loadJson(
        `${this._kitRegistry.basePath}index.json`,
      )) as { kits?: string[] };
      const kitIds = index.kits ?? ["bunker", "flakturm", "industrial"];

      for (const kitId of kitIds) {
        try {
          const manifest = await this._kitRegistry.getKitManifest(kitId);
          const kitName = manifest.name.split(" ")[0] ?? kitId;
          const kitFolder = `Kits/${kitName}`;

          // Props
          if (manifest.items) {
            for (const item of manifest.items) {
              this._assets.push({
                id: item.id,
                name: item.name,
                type: "prop",
                category: item.category,
                kitId,
                folderPath: `${kitFolder}/Props`,
                previewUrl: `${this._kitRegistry.basePath}${kitId}/${item.preview}`,
                raw: item,
              });
            }
            this._folders.add(`${kitFolder}/Props`);
          }

          // PBR Textures
          if (manifest.textures) {
            for (const tex of manifest.textures) {
              const albedoMap =
                tex.maps.find((m) => m.includes("albedo") || m.includes("diffuse")) ?? tex.maps[0];
              const texSlug = tex.id.includes("/") ? tex.id.split("/").pop()! : tex.id;
              this._assets.push({
                id: tex.id,
                name: tex.name,
                type: "texture",
                category: tex.category,
                kitId,
                folderPath: `${kitFolder}/Materials`,
                previewUrl: albedoMap
                  ? `${this._kitRegistry.basePath}${kitId}/textures/${texSlug}/${albedoMap}`
                  : undefined,
                raw: tex,
              });
            }
            this._folders.add(`${kitFolder}/Materials`);
          }

          // Decals
          if (manifest.decals) {
            for (const decal of manifest.decals) {
              this._assets.push({
                id: decal.id,
                name: decal.name,
                type: "decal",
                category: "decals",
                kitId,
                folderPath: `${kitFolder}/Decals`,
                previewUrl: `${this._kitRegistry.basePath}${kitId}/decals/${decal.file}`,
                raw: decal,
              });
            }
            this._folders.add(`${kitFolder}/Decals`);
          }

          this._folders.add("Kits");
          this._folders.add(kitFolder);
        } catch (err) {
          console.warn(`[ContentDrawer] Error loading manifest for '${kitId}':`, err);
        }
      }
    } catch (err) {
      console.warn("[ContentDrawer] Could not fetch kits index:", err);
    }

    this._countBadge.textContent = `${this._assets.length} Assets`;
    this._renderTree();
    this._renderGrid();
  }

  // --- Tree & Grid Rendering ---

  private _renderTree(): void {
    this._treeContainer.innerHTML = "";
    const rootTitle = document.createElement("div");
    rootTitle.className = "maker-tree-header";
    rootTitle.textContent = "FOLDERS";
    this._treeContainer.appendChild(rootTitle);

    const treeList = document.createElement("ul");
    treeList.className = "maker-tree-list";

    // "All" node
    const allItem = this._createTreeNode("All", "📁 All Assets", this._currentFolder === "All");
    treeList.appendChild(allItem);

    // Build hierarchy
    const sortedFolders = Array.from(this._folders).sort();
    for (const folder of sortedFolders) {
      const depth = folder.split("/").length;
      const label = folder.split("/").pop() ?? folder;
      const item = this._createTreeNode(
        folder,
        `${depth > 1 ? "└ " : "📁 "}${label}`,
        this._currentFolder === folder,
        depth,
      );
      treeList.appendChild(item);
    }

    this._treeContainer.appendChild(treeList);
  }

  private _createTreeNode(
    folderPath: string,
    displayLabel: string,
    isSelected: boolean,
    depth = 0,
  ): HTMLElement {
    const li = document.createElement("li");
    li.className = `maker-tree-node ${isSelected ? "selected" : ""}`;
    li.style.paddingLeft = `${depth * 12 + 8}px`;
    li.textContent = displayLabel;
    li.addEventListener("click", () => {
      this._currentFolder = folderPath;
      this._renderTree();
      this._renderBreadcrumbs();
      this._renderGrid();
    });
    return li;
  }

  private _renderBreadcrumbs(): void {
    this._breadcrumbsEl.innerHTML = "";
    const parts = this._currentFolder.split("/");
    const rootCrumb = document.createElement("span");
    rootCrumb.className = "maker-crumb";
    rootCrumb.textContent = "All";
    rootCrumb.addEventListener("click", () => {
      this._currentFolder = "All";
      this._renderTree();
      this._renderBreadcrumbs();
      this._renderGrid();
    });
    this._breadcrumbsEl.appendChild(rootCrumb);

    if (this._currentFolder !== "All") {
      let accum = "";
      for (const part of parts) {
        accum = accum ? `${accum}/${part}` : part;
        const sep = document.createElement("span");
        sep.className = "maker-crumb-sep";
        sep.textContent = " / ";
        this._breadcrumbsEl.appendChild(sep);

        const crumb = document.createElement("span");
        crumb.className = "maker-crumb";
        crumb.textContent = part;
        const target = accum;
        crumb.addEventListener("click", () => {
          this._currentFolder = target;
          this._renderTree();
          this._renderBreadcrumbs();
          this._renderGrid();
        });
        this._breadcrumbsEl.appendChild(crumb);
      }
    }
  }

  private _renderGrid(): void {
    this._gridContainer.innerHTML = "";

    const filtered = this._assets.filter((asset) => {
      // 1. Folder match
      if (this._currentFolder !== "All") {
        if (!asset.folderPath.startsWith(this._currentFolder)) return false;
      }
      // 2. Type filter
      if (this._activeFilter !== "all" && asset.type !== this._activeFilter) return false;
      // 3. Search query
      if (this._searchQuery) {
        const matchName = asset.name.toLowerCase().includes(this._searchQuery);
        const matchId = asset.id.toLowerCase().includes(this._searchQuery);
        const matchCat = asset.category?.toLowerCase().includes(this._searchQuery);
        if (!matchName && !matchId && !matchCat) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.className = "maker-content-empty";
      emptyMsg.innerHTML = `<span>🔍 No matching assets found in <b>${this._currentFolder}</b></span>`;
      this._gridContainer.appendChild(emptyMsg);
      return;
    }

    const grid = document.createElement("div");
    grid.className = "maker-content-grid";

    for (const asset of filtered) {
      const card = document.createElement("div");
      card.className = "maker-asset-card";
      card.draggable = true;
      card.title = `${asset.name} (${asset.type})\nDrag onto 3D viewport or double click to place.`;

      // Drag data transfer
      card.addEventListener("dragstart", (e) => {
        if (e.dataTransfer) {
          e.dataTransfer.setData("application/x-smallworldmachine-asset", JSON.stringify(asset));
          e.dataTransfer.effectAllowed = "copy";
        }
      });

      // Double click to place
      card.addEventListener("dblclick", () => {
        void this._instantiateAsset(asset);
      });

      // Thumbnail / Icon
      const thumbBox = document.createElement("div");
      thumbBox.className = "maker-asset-thumb";

      if (asset.previewUrl) {
        const img = document.createElement("img");
        img.src = asset.previewUrl;
        img.alt = asset.name;
        img.loading = "lazy";
        thumbBox.appendChild(img);
      } else if (asset.icon) {
        const iconSpan = document.createElement("span");
        iconSpan.className = "maker-asset-icon-placeholder";
        iconSpan.textContent = asset.icon;
        thumbBox.appendChild(iconSpan);
      } else {
        const iconSpan = document.createElement("span");
        iconSpan.className = "maker-asset-icon-placeholder";
        iconSpan.textContent = "📦";
        thumbBox.appendChild(iconSpan);
      }

      // Type Badge
      const badge = document.createElement("span");
      badge.className = `maker-asset-type-badge badge-${asset.type}`;
      badge.textContent = asset.type.toUpperCase();
      thumbBox.appendChild(badge);

      // Label
      const label = document.createElement("div");
      label.className = "maker-asset-name";
      label.textContent = asset.name;

      card.appendChild(thumbBox);
      card.appendChild(label);
      grid.appendChild(card);
    }

    this._gridContainer.appendChild(grid);
  }

  // --- Asset Instantiation ---

  private async _instantiateAsset(asset: ContentAssetItem, worldPos?: Vector3D): Promise<void> {
    const item = this._assets.find((a) => a.id === asset.id) ?? asset;
    switch (item.type) {
      case "prop":
        await this._options.callbacks.loadKitProp(item.id, worldPos);
        break;
      case "primitive":
      case "light":
        if (item.factory) {
          this._options.callbacks.createPrimitive(item.factory, worldPos);
        }
        break;
      case "texture":
        if (item.kitId && item.raw) {
          await this._options.callbacks.applyTexture(item.kitId, item.raw);
        }
        break;
      case "decal":
        if (item.kitId && item.raw) {
          await this._options.callbacks.createDecal(item.kitId, item.raw, worldPos);
        }
        break;
      case "prefab":
        await this._options.callbacks.instantiatePrefab(item.name, worldPos);
        break;
    }
  }

  // --- Drag & Drop into 3D Viewport ---

  private _setupCanvasDrop(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    });

    canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      const rawData = e.dataTransfer?.getData("application/x-smallworldmachine-asset");
      if (!rawData) return;

      try {
        const asset = JSON.parse(rawData) as ContentAssetItem;
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;

        const hit = this._options.callbacks.getRaycastHit
          ? this._options.callbacks.getRaycastHit(screenX, screenY)
          : {
              position: this._options.callbacks.getGroundPosition
                ? this._options.callbacks.getGroundPosition(screenX, screenY)
                : new Vector3D(0, 0, 0),
            };

        if (asset.type === "texture") {
          if (asset.kitId && asset.raw) {
            void this._options.callbacks.applyTexture(asset.kitId, asset.raw, hit.targetObject);
          }
        } else {
          void this._instantiateAsset(asset, hit.position);
        }

        // Auto-dismiss on drop if unpinned (UE5 drawer standard)
        if (!this._isPinned) {
          this.close();
        }
      } catch (err) {
        console.warn("[ContentDrawer] Drop failed:", err);
      }
    });
  }

  // --- Interaction & Resizer Helpers ---

  private _setupShortcuts(): void {
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  private _setupResizer(resizerEl: HTMLElement): void {
    let isResizing = false;
    let startY = 0;
    let startHeight = 280;

    resizerEl.addEventListener("mousedown", (e) => {
      isResizing = true;
      startY = e.clientY;
      startHeight = this._drawerEl.offsetHeight;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    });

    window.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const dy = startY - e.clientY;
      const newHeight = Math.max(160, Math.min(600, startHeight + dy));
      this._drawerEl.style.height = `${newHeight}px`;
    });

    window.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    });
  }
}
