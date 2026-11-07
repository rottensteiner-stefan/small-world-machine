export interface ToolShortcuts {
  /** Cmd/Ctrl+O */
  open?: () => void;
  /** Cmd/Ctrl+S */
  save?: () => void;
  /** Cmd/Ctrl+Shift+E */
  exportAll?: () => void;
  /** Cmd/Ctrl+Z */
  undo?: () => void;
  /** Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y */
  redo?: () => void;
}

/** Binds standard shortcuts on `target`; returns the unbind function. */
export function bindToolShortcuts(
  shortcuts: ToolShortcuts,
  target: Document = document,
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key: string = event.key.toLowerCase();

    // Preserve native undo/redo inside text input elements
    const targetEl = event.target as HTMLElement | null;
    const isTextInput =
      targetEl &&
      (targetEl.tagName === "INPUT" ||
        targetEl.tagName === "TEXTAREA" ||
        targetEl.isContentEditable);

    const action = ((): (() => void) | undefined => {
      if (key === "o" && !event.shiftKey) return shortcuts.open;
      if (key === "s" && !event.shiftKey) return shortcuts.save;
      if (key === "e" && event.shiftKey) return shortcuts.exportAll;
      if (key === "z" && !event.shiftKey && !isTextInput) return shortcuts.undo;
      if (((key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey)) && !isTextInput) {
        return shortcuts.redo;
      }
      return undefined;
    })();
    if (!action) return;
    // Swallow browser default
    event.preventDefault();
    action();
  };
  target.addEventListener("keydown", onKeyDown);
  return (): void => target.removeEventListener("keydown", onKeyDown);
}
