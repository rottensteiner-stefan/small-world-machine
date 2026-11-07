export interface PrefabPaletteCallbacks {
  /** Saves the currently selected object as a new prefab under this name. */
  saveSelectionAsPrefab(name: string): void;
  /** Instantiates (loads a fresh, independent copy of) the named prefab into the scene. */
  instantiate(name: string): void;
}

/** One entry in the prefab list -- `thumbnailDataUrl` is optional since older prefabs (or ones
 * saved before a project was bound) may not have a saved thumbnail. */
export interface PrefabEntry {
  name: string;
  thumbnailDataUrl?: string;
}

/**
 * The dynamic half of Maker's palette -- unlike `ObjectPalette`'s fixed built-in catalog, this
 * section's contents depend on what's actually in the bound project's `prefabs/` folder, so it
 * needs to be rebuilt at runtime (`setNames()`) rather than only once at construction. See ADR
 * 0010's Phase 2 "stamped copies" decision: instantiating just loads another independent copy,
 * there is no live link back to a shared definition.
 */
export class PrefabPalette {
  private readonly _listContainer: HTMLElement;
  private readonly _nameInput: HTMLInputElement;

  constructor(
    container: HTMLElement,
    private readonly _callbacks: PrefabPaletteCallbacks,
  ) {
    const heading = document.createElement("h4");
    heading.className = "maker-palette-section";
    heading.textContent = "Prefabs";
    container.appendChild(heading);

    const saveRow = document.createElement("div");
    saveRow.className = "maker-prefab-save-row";
    this._nameInput = document.createElement("input");
    this._nameInput.type = "text";
    this._nameInput.placeholder = "prefab name";
    this._nameInput.className = "maker-prefab-name-input";
    const saveButton = document.createElement("button");
    saveButton.className = "maker-palette-btn";
    saveButton.textContent = "💾 Save Selection";
    saveButton.addEventListener("click", (): void => {
      const name = this._nameInput.value.trim();
      if (!name) return;
      this._callbacks.saveSelectionAsPrefab(name);
      this._nameInput.value = "";
    });
    saveRow.appendChild(this._nameInput);
    saveRow.appendChild(saveButton);
    container.appendChild(saveRow);

    this._listContainer = document.createElement("div");
    this._listContainer.className = "maker-prefab-list";
    container.appendChild(this._listContainer);
  }

  /** Rebuilds the instantiate-buttons list from scratch -- call after binding a project and
   * after every successful `savePrefab()`. Entries without a `thumbnailDataUrl` fall back to the
   * plain text-only look. */
  public setEntries(entries: PrefabEntry[]): void {
    this._listContainer.innerHTML = "";
    for (const { name, thumbnailDataUrl } of entries) {
      const button = document.createElement("button");
      button.className = "maker-palette-btn maker-prefab-btn";
      if (thumbnailDataUrl) {
        const img = document.createElement("img");
        img.className = "maker-prefab-thumb";
        img.src = thumbnailDataUrl;
        img.alt = "";
        button.appendChild(img);
      }
      const label = document.createElement("span");
      label.textContent = `▣ ${name}`;
      button.appendChild(label);
      button.addEventListener("click", (): void => this._callbacks.instantiate(name));
      this._listContainer.appendChild(button);
    }
  }
}
