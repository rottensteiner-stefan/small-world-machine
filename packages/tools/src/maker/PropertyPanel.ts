import { Pane, FolderApi } from "tweakpane";
import {
  Object3D,
  Behavior,
  AbstractMaterial,
  StandardMaterial,
  BasicMaterial,
  WireframeMaterial,
  GlassMaterial,
  PhongMaterial,
  Color,
  InspectorField,
  collectInspectorSchema,
  StageZoneMarker,
} from "@small-world-machine/engine";
import { UndoStack } from "./UndoStack.js";

/** Minimal shape shared by Tweakpane binding/blade APIs this panel actually calls -- mirrors
 * `GadgetInspector`'s own minimal interfaces rather than depending on Tweakpane's full types. */
interface DisposableBlade {
  dispose(): void;
}
interface RefreshableBinding {
  refresh(): void;
}

type ChangeEvent<T> = { value: T; last?: boolean };

export interface PropertyPanelCallbacks {
  onPropertyChanged?: (obj: Object3D, propKey: string, value: unknown) => void;
  onDetachBehavior?: (obj: Object3D, behavior: Behavior) => void;
  onSetMaterial?: (obj: Object3D, material: AbstractMaterial | undefined) => void;
}

/**
 * The generic, schema-driven property panel that is Maker's actual replacement for
 * GadgetInspector's hand-duck-typed one (see docs/adr/0010-maker-editor-architecture.md).
 * Every field it renders comes from `collectInspectorSchema()` -- there is no per-material or
 * per-light special-casing here; a new `static inspector` entry on any class is enough to make
 * it show up, with zero changes to this file.
 */
export class PropertyPanel {
  private _pane: Pane;
  private _titleFolder: FolderApi;
  private _blades: DisposableBlade[] = [];
  private _currentObj: Object3D | undefined;
  private _extraCount: number = 0;

  constructor(
    container: HTMLElement,
    private _undo: UndoStack,
    private _callbacks?: PropertyPanelCallbacks,
  ) {
    this._pane = new Pane({ container });
    this._titleFolder = this._pane.addFolder({ title: "No Selection", expanded: true });

    // Double-click on folder title area focuses the name input field
    this._titleFolder.element.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.focusNameInput();
    });
  }

  public focusNameInput(): void {
    const nameInput = this._pane.element.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement | null;
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }

  private _updateTitle(): void {
    const baseName = this._currentObj
      ? this._currentObj.name || this._currentObj.constructor.name
      : "No Selection";
    this._titleFolder.title =
      this._currentObj && this._extraCount > 0
        ? `${baseName} (+${this._extraCount} more)`
        : baseName;
  }

  /** Rebuilds the entire panel for the newly selected (primary) object, or clears it for
   * `undefined`. `extraCount` -- how many other objects are also selected alongside it -- is
   * shown as a "(+N more)" suffix; this panel only ever edits the primary object's properties,
   * never a multi-object batch edit. */
  public setSelection(obj: Object3D | undefined, extraCount: number = 0): void {
    this._currentObj = obj;
    this._extraCount = extraCount;
    for (const blade of this._blades) blade.dispose();
    this._blades = [];
    this._updateTitle();
    if (!obj) return;

    this._renderSchema(
      this._titleFolder,
      obj as unknown as Record<string, unknown>,
      collectInspectorSchema(obj),
    );

    if (obj.material) {
      const matFolder = this._titleFolder.addFolder({
        title: `Material (${obj.material.constructor.name})`,
        expanded: true,
      });
      this._blades.push(matFolder);
      this._attachMaterialHeaderMenu(matFolder, obj, obj.material);
      this._renderSchema(
        matFolder,
        obj.material as unknown as Record<string, unknown>,
        collectInspectorSchema(obj.material),
      );
    } else if (obj.geometry) {
      const noMatFolder = this._titleFolder.addFolder({
        title: "Material (None)",
        expanded: true,
      });
      this._blades.push(noMatFolder);
      const addBtn = noMatFolder.addButton({ title: "➕ Add Standard Material" });
      addBtn.on("click", (): void => {
        this._callbacks?.onSetMaterial?.(obj, new StandardMaterial());
      });
    }

    if (obj instanceof StageZoneMarker) {
      this._renderStageZonePoints(obj);
    }

    if (obj.behaviors.length > 0) {
      const behaviorsFolder = this._titleFolder.addFolder({ title: "Behaviors", expanded: true });
      this._blades.push(behaviorsFolder);
      for (const behavior of obj.behaviors) {
        const oneFolder = behaviorsFolder.addFolder({
          title: behavior.constructor.name,
          expanded: true,
        });
        this._attachBehaviorHeaderMenu(oneFolder, obj, behavior);
        oneFolder.addBinding(behavior, "isActive", { label: "Active" });
        this._renderSchema(
          oneFolder,
          behavior as unknown as Record<string, unknown>,
          collectInspectorSchema(behavior),
        );
      }
    }
  }

  private _attachMaterialHeaderMenu(
    folder: FolderApi,
    obj: Object3D,
    material: AbstractMaterial,
  ): void {
    const folderEl = folder.element;
    if (!folderEl) return;

    folderEl.style.position = "relative";

    const dotsBtn = document.createElement("button");
    dotsBtn.type = "button";
    dotsBtn.className = "maker-behavior-menu-btn";
    dotsBtn.innerHTML = "&#8942;"; // ⋮
    dotsBtn.title = "Material Options";

    dotsBtn.addEventListener("click", (e: MouseEvent): void => {
      e.stopPropagation();
      e.preventDefault();
      this._showMaterialContextMenu(dotsBtn, obj, material);
    });

    folderEl.appendChild(dotsBtn);
  }

  private _showMaterialContextMenu(
    anchor: HTMLElement,
    obj: Object3D,
    material: AbstractMaterial,
  ): void {
    document.querySelectorAll(".maker-behavior-dropdown").forEach((el) => el.remove());

    const menu = document.createElement("div");
    menu.className = "maker-behavior-dropdown";

    const addOption = (label: string, isDanger: boolean, onClick: () => void): void => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `maker-behavior-dropdown-item${isDanger ? " maker-behavior-dropdown-danger" : ""}`;
      btn.innerHTML = label;
      btn.addEventListener("click", (e: MouseEvent): void => {
        e.stopPropagation();
        closeMenu();
        onClick();
      });
      menu.appendChild(btn);
    };

    // Material Switch Options
    addOption("🎨 Switch: Standard (PBR)", false, () =>
      this._callbacks?.onSetMaterial?.(obj, new StandardMaterial()),
    );
    addOption("💡 Switch: Basic (Unlit)", false, () =>
      this._callbacks?.onSetMaterial?.(obj, new BasicMaterial()),
    );
    addOption("🕸️ Switch: Wireframe", false, () =>
      this._callbacks?.onSetMaterial?.(obj, new WireframeMaterial()),
    );
    addOption("🍷 Switch: Glass", false, () =>
      this._callbacks?.onSetMaterial?.(obj, new GlassMaterial()),
    );
    addOption("✨ Switch: Phong", false, () =>
      this._callbacks?.onSetMaterial?.(obj, new PhongMaterial()),
    );

    // Separator
    const sep = document.createElement("div");
    sep.style.cssText = "height: 1px; background: #334155; margin: 4px 0;";
    menu.appendChild(sep);

    // Reset Defaults
    addOption("🔄 Reset to Defaults", false, () => {
      const matClass = material.constructor as new () => AbstractMaterial;
      this._callbacks?.onSetMaterial?.(obj, new matClass());
    });

    // Remove Material
    addOption("🗑️ Remove Material", true, () => this._callbacks?.onSetMaterial?.(obj, undefined));

    const rect = anchor.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    menu.style.zIndex = "9999";

    const closeHandler = (e: MouseEvent): void => {
      if (!menu.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const closeMenu = (): void => {
      menu.remove();
      window.removeEventListener("pointerdown", closeHandler);
    };
    setTimeout(() => {
      window.addEventListener("pointerdown", closeHandler);
    }, 0);

    document.body.appendChild(menu);
  }

  private _attachBehaviorHeaderMenu(folder: FolderApi, obj: Object3D, behavior: Behavior): void {
    const folderEl = folder.element;
    if (!folderEl) return;

    folderEl.style.position = "relative";

    const dotsBtn = document.createElement("button");
    dotsBtn.type = "button";
    dotsBtn.className = "maker-behavior-menu-btn";
    dotsBtn.innerHTML = "&#8942;"; // ⋮
    dotsBtn.title = "Behavior Options";

    dotsBtn.addEventListener("click", (e: MouseEvent): void => {
      e.stopPropagation();
      e.preventDefault();
      this._showBehaviorContextMenu(dotsBtn, obj, behavior);
    });

    folderEl.appendChild(dotsBtn);
  }

  private _showBehaviorContextMenu(anchor: HTMLElement, obj: Object3D, behavior: Behavior): void {
    document.querySelectorAll(".maker-behavior-dropdown").forEach((el) => el.remove());

    const menu = document.createElement("div");
    menu.className = "maker-behavior-dropdown";

    const removeOption = document.createElement("button");
    removeOption.type = "button";
    removeOption.className = "maker-behavior-dropdown-item maker-behavior-dropdown-danger";
    removeOption.innerHTML = "🗑️ Remove Behavior";
    removeOption.addEventListener("click", (e: MouseEvent): void => {
      e.stopPropagation();
      closeMenu();
      this._callbacks?.onDetachBehavior?.(obj, behavior);
    });
    menu.appendChild(removeOption);

    const rect = anchor.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    menu.style.zIndex = "9999";

    const closeHandler = (e: MouseEvent): void => {
      if (!menu.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const closeMenu = (): void => {
      menu.remove();
      window.removeEventListener("pointerdown", closeHandler);
    };
    setTimeout(() => {
      window.addEventListener("pointerdown", closeHandler);
    }, 0);

    document.body.appendChild(menu);
  }

  private _renderSchema(
    folder: FolderApi,
    target: Record<string, unknown>,
    schema: Record<string, InspectorField>,
  ): void {
    const entries = Object.entries(schema);
    let i = 0;
    while (i < entries.length) {
      const [key, field] = entries[i]!;
      if (field.row) {
        const rowId = field.row;
        const rowEntries: [string, InspectorField][] = [];
        while (i < entries.length && entries[i]![1].row === rowId) {
          rowEntries.push(entries[i]!);
          i++;
        }
        this._bindRowFields(folder, target, rowEntries);
      } else {
        this._bindField(folder, target, key, field);
        i++;
      }
    }
  }

  private _bindRowFields(
    folder: FolderApi,
    target: Record<string, unknown>,
    entries: [string, InspectorField][],
  ): void {
    const rowEl = document.createElement("div");
    rowEl.className = "maker-prop-row";

    for (const [key, field] of entries) {
      const blade = this._createFieldBinding(folder, target, key, field);
      const el = (blade as unknown as { element?: HTMLElement }).element;
      if (el) rowEl.appendChild(el);
    }

    const container = folder.element.querySelector(".tp-fldv_c") ?? folder.element;
    container.appendChild(rowEl);
    this._blades.push({
      dispose: (): void => {
        rowEl.remove();
      },
    });
  }

  /** Resolves `field.path` (e.g. "position.x") to the actual host object + property key --
   * the same dotted-path convention `GadgetInspector` already uses for nested Behavior fields,
   * generalized here to every schema entry. */
  private _resolvePath(
    target: Record<string, unknown>,
    key: string,
    path: string | undefined,
  ): { host: Record<string, unknown>; propKey: string } {
    if (!path) return { host: target, propKey: key };
    const parts = path.split(".");
    let host = target;
    for (let i = 0; i < parts.length - 1; i++) {
      host = host[parts[i]!] as Record<string, unknown>;
    }
    return { host, propKey: parts[parts.length - 1]! };
  }

  /** Reports an edit of the inspected object, or of its material (also reached through a path such as
   * `material.color.a`), so the host can autosave. Behavior fields are not reported. */
  private _notifyChanged(host: Record<string, unknown>, propKey: string, value: unknown): void {
    const obj = this._currentObj;
    if (!obj) return;
    const isObject = host === (obj as unknown as Record<string, unknown>);
    const material = obj.material as unknown as { color?: unknown } | undefined;
    if (!isObject && host !== (material as unknown) && host !== (material?.color as unknown)) {
      return;
    }
    if (isObject && "name" === propKey) this._updateTitle();
    this._callbacks?.onPropertyChanged?.(obj, propKey, value);
  }

  private _bindField(
    folder: FolderApi,
    target: Record<string, unknown>,
    key: string,
    field: InspectorField,
  ): void {
    this._createFieldBinding(folder, target, key, field);
  }

  private _createFieldBinding(
    folder: FolderApi,
    target: Record<string, unknown>,
    key: string,
    field: InspectorField,
  ): RefreshableBinding & DisposableBlade {
    const { host, propKey } = this._resolvePath(target, key, field.path);
    const label = field.label ?? key;

    if ("color" === field.type) {
      return this._bindColorField(folder, host, propKey, label);
    }

    const options: Record<string, unknown> = { label };
    if ("number" === field.type) {
      if (undefined !== field.min) options["min"] = field.min;
      if (undefined !== field.max) options["max"] = field.max;
      if (undefined !== field.step) options["step"] = field.step;
    } else if ("vec3" === field.type || "vec2" === field.type) {
      if (undefined !== field.step) options["step"] = field.step;
      if (undefined !== field.min) options["min"] = field.min;
      if (undefined !== field.max) options["max"] = field.max;
    } else if ("choice" === field.type && field.options) {
      options["options"] = Array.isArray(field.options)
        ? Object.fromEntries(field.options.map((o) => [o, o]))
        : field.options;
    }

    const cloneVal = (v: unknown): unknown => {
      if (v && typeof v === "object") {
        if ("clone" in v && typeof (v as { clone: () => unknown }).clone === "function") {
          return (v as { clone: () => unknown }).clone();
        }
        return { ...(v as object) };
      }
      return v;
    };

    const copyVal = (dest: unknown, src: unknown): void => {
      if (dest && typeof dest === "object" && src && typeof src === "object") {
        if (
          "copyFrom" in dest &&
          typeof (dest as { copyFrom: (s: unknown) => unknown }).copyFrom === "function"
        ) {
          (dest as { copyFrom: (s: unknown) => unknown }).copyFrom(src);
          return;
        }
        Object.assign(dest, src);
      }
    };

    let before = cloneVal(host[propKey]);
    const binding = folder.addBinding(host, propKey, options) as unknown as RefreshableBinding &
      DisposableBlade & { on: (event: "change", cb: (ev: ChangeEvent<unknown>) => void) => void };
    binding.on("change", (ev: ChangeEvent<unknown>) => {
      if (false === ev.last) return;
      const from = before;
      const to = cloneVal(ev.value);
      this._undo.execute({
        label: `Edit ${label}`,
        redo: () => {
          if (typeof host[propKey] === "object" && null !== host[propKey]) {
            copyVal(host[propKey], to);
          } else {
            host[propKey] = to;
          }
          binding.refresh();
          this._notifyChanged(host, propKey, to);
        },
        undo: () => {
          if (typeof host[propKey] === "object" && null !== host[propKey]) {
            copyVal(host[propKey], from);
          } else {
            host[propKey] = from;
          }
          binding.refresh();
          this._notifyChanged(host, propKey, from);
        },
      });
      this._notifyChanged(host, propKey, to);
      before = to;
    });
    this._blades.push(binding);
    return binding;
  }

  /**
   * Renders a dedicated points editor for a `StageZoneMarker` -- a hand-written special case
   * (like the Material/Behaviors folders above), since a variable-length list of points has no
   * equivalent in `Inspectable`'s generic, statically-shaped `static inspector` schema (see ADR
   * 0016 Phase 2). Every field/add/remove is its own undo step, same granularity as any other
   * field in this panel -- deliberately NOT the single "one command per whole drag" granularity
   * `TransformGizmo`'s viewport point-drag uses, since that's a different interaction (a
   * continuous drag vs. a single typed/committed edit).
   */
  private _renderStageZonePoints(marker: StageZoneMarker): void {
    const zone = marker.zone;
    const folder = this._titleFolder.addFolder({
      title: `Zone Points (${zone.points.length})`,
      expanded: true,
    });
    this._blades.push(folder);

    zone.points.forEach((point, index) => {
      const rowFolder = folder.addFolder({ title: `Point ${index + 1}`, expanded: false });
      this._blades.push(rowFolder);

      this._bindZonePointField(rowFolder, point, "u", "U", 0, 1, 0.001);
      this._bindZonePointField(rowFolder, point, "v", "V", 0, 1, 0.001);
      this._bindZonePointField(rowFolder, point, "scale", "Scale", 0, 5, 0.01);

      if (3 < zone.points.length) {
        const removeBtn = rowFolder.addButton({ title: "🗑 Remove Point" });
        removeBtn.on("click", (): void => this._removeZonePoint(marker, index));
      }
    });

    const addBtn = folder.addButton({ title: "➕ Add Point" });
    addBtn.on("click", (): void => this._addZonePoint(marker));
  }

  private _bindZonePointField(
    folder: FolderApi,
    point: { u: number; v: number; scale: number },
    key: "u" | "v" | "scale",
    label: string,
    min: number,
    max: number,
    step: number,
  ): void {
    let before = point[key];
    const binding = folder.addBinding(point, key, {
      label,
      min,
      max,
      step,
    }) as unknown as RefreshableBinding &
      DisposableBlade & { on: (event: "change", cb: (ev: ChangeEvent<number>) => void) => void };
    binding.on("change", (ev: ChangeEvent<number>) => {
      if (false === ev.last) return;
      const from = before;
      const to = ev.value;
      this._undo.execute({
        label: `Edit Zone Point ${label}`,
        redo: () => {
          point[key] = to;
          binding.refresh();
          this._notifyZoneChanged();
        },
        undo: () => {
          point[key] = from;
          binding.refresh();
          this._notifyZoneChanged();
        },
      });
      before = to;
    });
    this._blades.push(binding);
  }

  private _addZonePoint(marker: StageZoneMarker): void {
    const points = marker.zone.points;
    const last = points[points.length - 1]!;
    const secondLast = points[points.length - 2] ?? last;
    const newPoint = {
      u: (last.u + secondLast.u) / 2,
      v: (last.v + secondLast.v) / 2,
      scale: last.scale,
    };
    this._undo.execute({
      label: "Add Zone Point",
      redo: () => {
        points.push(newPoint);
        this._notifyZoneChanged();
        this.setSelection(this._currentObj, this._extraCount);
      },
      undo: () => {
        points.pop();
        this._notifyZoneChanged();
        this.setSelection(this._currentObj, this._extraCount);
      },
    });
  }

  private _removeZonePoint(marker: StageZoneMarker, index: number): void {
    const points = marker.zone.points;
    if (3 >= points.length) return;
    const removed = points[index]!;
    this._undo.execute({
      label: "Remove Zone Point",
      redo: () => {
        points.splice(index, 1);
        this._notifyZoneChanged();
        this.setSelection(this._currentObj, this._extraCount);
      },
      undo: () => {
        points.splice(index, 0, removed);
        this._notifyZoneChanged();
        this.setSelection(this._currentObj, this._extraCount);
      },
    });
  }

  /** Zone point edits mutate `zone.points` directly (not a property on the `StageZoneMarker`
   * itself), so the generic `_createFieldBinding` identity check (`host === this._currentObj`)
   * that normally gates `onPropertyChanged` never fires for them -- without this, editing a
   * zone's points would silently never trigger Maker's autosave. */
  private _notifyZoneChanged(): void {
    if (this._currentObj) {
      this._callbacks?.onPropertyChanged?.(this._currentObj, "zone.points", undefined);
    }
  }

  private _bindColorField(
    folder: FolderApi,
    host: Record<string, unknown>,
    propKey: string,
    label: string,
  ): RefreshableBinding & DisposableBlade {
    const colorObj = host[propKey] as Color | undefined;
    if (!colorObj || typeof colorObj.r !== "number") {
      return { refresh: () => {}, dispose: () => {} } as unknown as RefreshableBinding &
        DisposableBlade;
    }
    const proxy = { value: { r: colorObj.r * 255, g: colorObj.g * 255, b: colorObj.b * 255 } };
    let before = { ...proxy.value };

    const binding = folder.addBinding(proxy, "value", { label }) as unknown as RefreshableBinding &
      DisposableBlade & {
        on: (
          event: "change",
          cb: (ev: ChangeEvent<{ r: number; g: number; b: number }>) => void,
        ) => void;
      };
    binding.on("change", (ev: ChangeEvent<{ r: number; g: number; b: number }>) => {
      colorObj.r = ev.value.r / 255;
      colorObj.g = ev.value.g / 255;
      colorObj.b = ev.value.b / 255;
      if (false === ev.last) return;
      const from = before;
      const to = { ...ev.value };
      this._undo.execute({
        label: `Edit ${label}`,
        redo: () => {
          colorObj.r = to.r / 255;
          colorObj.g = to.g / 255;
          colorObj.b = to.b / 255;
          proxy.value = { ...to };
          binding.refresh();
          this._notifyChanged(host, propKey, to);
        },
        undo: () => {
          colorObj.r = from.r / 255;
          colorObj.g = from.g / 255;
          colorObj.b = from.b / 255;
          proxy.value = { ...from };
          binding.refresh();
          this._notifyChanged(host, propKey, from);
        },
      });
      this._notifyChanged(host, propKey, to);
      before = to;
    });
    this._blades.push(binding);
    return binding;
  }
}
