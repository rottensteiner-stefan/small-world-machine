import { Object3D } from "@small-world-machine/engine";

export interface HierarchyCallbacks {
  /** `toggle` mirrors the click's Shift/Ctrl/Cmd modifier state -- add/remove `obj` from the
   * existing selection instead of replacing it wholesale. */
  onSelect(obj: Object3D, toggle: boolean): void;
  onReparent(obj: Object3D, newParent: Object3D): void;
  onRename?(obj: Object3D, newName: string): void;
}

const DRAG_MIME = "text/maker-uuid";

/**
 * A flat, indented outliner (not a nested DOM tree -- simpler to rebuild wholesale on every
 * structural change) with real drag-and-drop reparenting, replacing GadgetInspector's
 * read-only "jump to parent/child" buttons. Rebuilt from scratch on every `refresh()` -- fine
 * at Maker's expected scene sizes; a diffed update is a later-phase concern if it ever isn't.
 */
export class HierarchyPanel {
  private _renamingUuid: string | null = null;
  private _filterQuery: string = "";
  private _searchInput: HTMLInputElement;
  private _treeContainer: HTMLElement;

  constructor(
    private _container: HTMLElement,
    private _getRoot: () => Object3D,
    private _callbacks: HierarchyCallbacks,
    /** Editor-only helper meshes (selection highlight, transform gizmo) are real scene children
     * but shouldn't clutter the outliner -- excluded (subtree and all) by identity here. */
    private _isExcluded: (obj: Object3D) => boolean = () => false,
  ) {
    this._container.classList.add("maker-hierarchy");
    this._container.innerHTML = "";

    // Search header container
    const searchWrapper = document.createElement("div");
    searchWrapper.className = "maker-hierarchy-search-wrapper";

    this._searchInput = document.createElement("input");
    this._searchInput.type = "text";
    this._searchInput.className = "maker-hierarchy-search-input";
    this._searchInput.placeholder = "🔍 Filter objects... (Ctrl+F)";
    this._searchInput.spellcheck = false;

    this._searchInput.addEventListener("input", (): void => {
      this._filterQuery = this._searchInput.value.trim().toLowerCase();
      this.refresh();
    });

    this._searchInput.addEventListener("keydown", (e): void => {
      e.stopPropagation();
      if ("Enter" === e.key) {
        e.preventDefault();
        const first = this.getFirstMatchingObject();
        if (first) this._callbacks.onSelect(first, false);
      } else if ("Escape" === e.key) {
        e.preventDefault();
        this._filterQuery = "";
        this._searchInput.value = "";
        this.refresh();
        this._searchInput.blur();
      }
    });

    searchWrapper.appendChild(this._searchInput);
    this._container.appendChild(searchWrapper);

    // Tree container
    this._treeContainer = document.createElement("div");
    this._treeContainer.className = "maker-hierarchy-tree";
    this._container.appendChild(this._treeContainer);

    this._container.addEventListener("dragover", (e) => e.preventDefault());
    this._container.addEventListener("drop", (e) => {
      // Dropped on empty space below the last row -- reparent to the scene root.
      if (e.target !== this._container && e.target !== this._treeContainer) return;
      e.preventDefault();
      const draggedUuid = e.dataTransfer?.getData(DRAG_MIME);
      const dragged = draggedUuid && this._findByUuid(this._getRoot(), draggedUuid);
      if (dragged) this._callbacks.onReparent(dragged, this._getRoot());
    });
  }

  public focusSearch(): void {
    this._searchInput.focus();
    this._searchInput.select();
  }

  public getFirstMatchingObject(): Object3D | undefined {
    const findFirst = (parent: Object3D): Object3D | undefined => {
      for (const child of parent.children) {
        if (this._isExcluded(child)) continue;
        const name = (child.name || child.constructor.name).toLowerCase();
        if (this._filterQuery && name.includes(this._filterQuery)) {
          return child;
        }
        const deep = findFirst(child);
        if (deep) return deep;
      }
      return undefined;
    };
    return findFirst(this._getRoot());
  }

  private _matchesFilter(obj: Object3D): boolean {
    if (!this._filterQuery) return true;
    const name = (obj.name || obj.constructor.name).toLowerCase();
    if (name.includes(this._filterQuery)) return true;
    for (const child of obj.children) {
      if (!this._isExcluded(child) && this._matchesFilter(child)) return true;
    }
    return false;
  }

  private _selection: ReadonlySet<Object3D> = new Set();

  public setSelected(selection: ReadonlySet<Object3D>): void {
    this._selection = selection;
    this.refresh();
  }

  public startRenaming(obj: Object3D): void {
    this._renamingUuid = obj.uuid;
    this.refresh();
  }

  public refresh(): void {
    this._treeContainer.innerHTML = "";
    this._renderChildren(this._getRoot(), 0);
  }

  private _renderChildren(parent: Object3D, depth: number): void {
    for (const child of parent.children) {
      if (this._isExcluded(child)) continue;
      if (!this._matchesFilter(child)) continue;
      const row = document.createElement("div");
      row.className = "maker-hierarchy-row" + (this._selection.has(child) ? " selected" : "");
      row.style.paddingLeft = `${depth * 16 + 6}px`;
      row.draggable = true;

      if (this._renamingUuid === child.uuid) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "maker-hierarchy-rename-input";
        input.value = child.name || child.constructor.name;
        row.appendChild(input);

        let committed = false;
        const commit = (): void => {
          if (committed) return;
          committed = true;
          this._renamingUuid = null;
          const trimmed = input.value.trim();
          if (trimmed && trimmed !== child.name) {
            this._callbacks.onRename?.(child, trimmed);
          } else {
            this.refresh();
          }
        };

        const cancel = (): void => {
          if (committed) return;
          committed = true;
          this._renamingUuid = null;
          this.refresh();
        };

        input.addEventListener("keydown", (e): void => {
          e.stopPropagation();
          if ("Enter" === e.key) {
            e.preventDefault();
            commit();
          } else if ("Escape" === e.key) {
            e.preventDefault();
            cancel();
          }
        });

        input.addEventListener("blur", (): void => commit());

        setTimeout(() => {
          input.focus();
          input.select();
        }, 0);
      } else {
        row.textContent = child.name || child.constructor.name;

        row.addEventListener("click", (e) => {
          this._callbacks.onSelect(child, e.shiftKey || e.ctrlKey || e.metaKey);
        });
        row.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          this.startRenaming(child);
        });
      }
      row.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData(DRAG_MIME, child.uuid);
      });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedUuid = e.dataTransfer?.getData(DRAG_MIME);
        const dragged = draggedUuid && this._findByUuid(this._getRoot(), draggedUuid);
        if (dragged && dragged !== child && !this._isAncestorOf(dragged, child)) {
          this._callbacks.onReparent(dragged, child);
        }
      });

      this._treeContainer.appendChild(row);
      this._renderChildren(child, depth + 1);
    }
  }

  private _findByUuid(obj: Object3D, uuid: string): Object3D | undefined {
    if (obj.uuid === uuid) return obj;
    for (const child of obj.children) {
      const found = this._findByUuid(child, uuid);
      if (found) return found;
    }
    return undefined;
  }

  /** A node can never become its own descendant's child -- would create a cycle. */
  private _isAncestorOf(candidate: Object3D, obj: Object3D): boolean {
    let p: Object3D | undefined = obj.parent;
    while (p) {
      if (p === candidate) return true;
      p = p.parent;
    }
    return false;
  }
}
