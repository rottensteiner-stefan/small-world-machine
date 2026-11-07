export interface CommandHistoryOptions {
  /** Maximum number of history items to keep. Defaults to 100. */
  maxEntries?: number;
  /** Optional localStorage key for persistent command history across tool reloads. */
  storageKey?: string;
  /** Number of entries to skip on PageUp / PageDown. Defaults to 10. */
  pageStep?: number;
}

export class CommandHistory {
  private _history: string[] = [];
  private _index: number = 0;
  private _draft: string = "";
  private _maxEntries: number;
  private _pageStep: number;
  private _storageKey: string | undefined;

  constructor(options: CommandHistoryOptions = {}) {
    this._maxEntries = options.maxEntries ?? 100;
    this._pageStep = options.pageStep ?? 10;
    this._storageKey = options.storageKey;

    if (this._storageKey && typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(this._storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            this._history = parsed
              .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
              .slice(-this._maxEntries);
          }
        }
      } catch {
        // Ignore parsing or storage access errors
      }
    }
    this._index = this._history.length;
  }

  public get entries(): readonly string[] {
    return this._history;
  }

  public get currentIndex(): number {
    return this._index;
  }

  public push(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) return;

    // Deduplicate identical consecutive commands
    if (this._history.length > 0 && this._history[this._history.length - 1] === trimmed) {
      this._index = this._history.length;
      this._draft = "";
      return;
    }

    this._history.push(trimmed);
    if (this._history.length > this._maxEntries) {
      this._history.splice(0, this._history.length - this._maxEntries);
    }
    this._index = this._history.length;
    this._draft = "";
    this._save();
  }

  public navigateUp(currentText: string): string | null {
    if (this._history.length === 0) return null;

    if (this._index === this._history.length) {
      this._draft = currentText;
    }

    if (this._index > 0) {
      this._index--;
      return this._history[this._index]!;
    }
    return this._history[0]!;
  }

  public navigateDown(_currentText?: string): string | null {
    if (this._history.length === 0) return null;

    if (this._index < this._history.length - 1) {
      this._index++;
      return this._history[this._index]!;
    } else if (this._index === this._history.length - 1) {
      this._index = this._history.length;
      return this._draft;
    }
    return null;
  }

  public navigatePageUp(currentText: string): string | null {
    if (this._history.length === 0) return null;

    if (this._index === this._history.length) {
      this._draft = currentText;
    }

    this._index = Math.max(0, this._index - this._pageStep);
    return this._history[this._index]!;
  }

  public navigatePageDown(_currentText?: string): string | null {
    if (this._history.length === 0) return null;
    if (this._index >= this._history.length) return null;

    this._index = Math.min(this._history.length, this._index + this._pageStep);
    if (this._index === this._history.length) {
      return this._draft;
    }
    return this._history[this._index]!;
  }

  public resetDraft(): void {
    this._index = this._history.length;
    this._draft = "";
  }

  public bindInput(input: HTMLInputElement | HTMLTextAreaElement): () => void {
    const handleKeyDown = (e: KeyboardEvent): void => {
      let nextValue: string | null = null;
      if (e.key === "ArrowUp") {
        nextValue = this.navigateUp(input.value);
      } else if (e.key === "ArrowDown") {
        nextValue = this.navigateDown(input.value);
      } else if (e.key === "PageUp") {
        nextValue = this.navigatePageUp(input.value);
      } else if (e.key === "PageDown") {
        nextValue = this.navigatePageDown(input.value);
      }

      if (nextValue !== null) {
        e.preventDefault();
        input.value = nextValue;
        input.setSelectionRange(nextValue.length, nextValue.length);
      }
    };

    const target: HTMLElement = input;
    target.addEventListener("keydown", handleKeyDown);
    return () => target.removeEventListener("keydown", handleKeyDown);
  }

  private _save(): void {
    if (this._storageKey && typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(this._storageKey, JSON.stringify(this._history));
      } catch {
        // Ignore storage write errors
      }
    }
  }
}
