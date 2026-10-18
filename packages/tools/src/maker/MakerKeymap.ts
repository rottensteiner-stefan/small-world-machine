import type { GizmoMode } from "./TransformGizmo.js";

/**
 * Minimal keyboard-event shape the keymap resolves against. Kept intentionally
 * DOM-free so the table and its resolver are unit-testable without a browser.
 * `KeyboardEvent` is structurally compatible (it provides these members and
 * `preventDefault`), so `MakerApp` can hand the raw event straight through.
 */
export interface MakerKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault(): void;
}

/**
 * The editor operations a keymap action may perform. Injected by `MakerApp`
 * (bound to the real panels/tools) and mocked in tests. This is the full set
 * of state the historical `_onMakerKeyDown` if-chain read — nothing more.
 */
export interface MakerKeyContext {
  isEditingField(): boolean;
  isDecalStampActive(): boolean;
  isDrawingZone(): boolean;
  selectionSize(): number;
  hasPrimary(): boolean;
  undo(): void;
  redo(): void;
  /** Post-undo/redo property + hierarchy refresh (Ctrl/Cmd+Z follow-up). */
  refreshSelectionAndHierarchy(): void;
  decalHandleKeyDown(event: MakerKeyEvent): boolean;
  decalDisable(): void;
  zoneCancel(): void;
  zoneFinish(): void;
  zoneToggle(): void;
  deleteSelection(): void;
  startRenamingPrimary(): void;
  focusSearch(): void;
  duplicateSelection(): void;
  groupSelection(): void;
  toggleSnap(): void;
  saveCameraBookmark(slot: number): void;
  jumpToCameraBookmark(slot: number): void;
  setGizmoMode(mode: GizmoMode): void;
  stepGrid(dir: 1 | -1): void;
  snapSelectionToGround(): void;
  nudgeSelection(key: string, isShift: boolean, isAlt: boolean): void;
}

/**
 * One shortcut. The keymap is an ORDERED array: resolution walks it top to
 * bottom and the first entry whose key/modifiers match and whose `when` guard
 * passes owns the key. A binding whose `action` returns `false` does not
 * consume the key and resolution falls through to the next entry — this is
 * what preserves the old decal-stamp pass-through (the stamp only claims the
 * keys it actually handles).
 */
export interface MakerKeyBinding {
  /** Primary key (matched case-insensitively). */
  key: string;
  /** Other keys resolving to the same binding (e.g. Delete/Backspace). */
  keyAliases?: readonly string[];
  /** Matches ANY key — used for state-gated intercepts (active decal stamp). */
  matchAnyKey?: boolean;
  /** Matches any digit within `[min, max]` (inclusive). */
  numericRange?: readonly [number, number];
  /** Modifiers that must be pressed. `ctrlOrMeta` = control OR meta. */
  modifiers?: { ctrlOrMeta?: boolean; shift?: boolean; alt?: boolean };
  /** Modifiers that must NOT be pressed for the binding to match. */
  exclude?: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean };
  /** Human-readable label for a future help overlay; unique across the table. */
  label: string;
  /** State guard; the binding only fires while this returns true. */
  when?: (ctx: MakerKeyContext, event: MakerKeyEvent) => boolean;
  /** Performs the action. Returns true = consumed (stop), false = pass through. */
  action: (ctx: MakerKeyContext, event: MakerKeyEvent) => boolean;
}

/**
 * Routes every key the stamp tool owns while it is active, mirroring the old
 * `if (this._decalStamp.isActive || "d" === key)` block: a stray zone draw is
 * cancelled first, then the stamp decides. Only stamps a key the stamp reports
 * as consumed; everything else falls through to the rest of the table.
 */
function decalRoute(ctx: MakerKeyContext, event: MakerKeyEvent): boolean {
  if (ctx.isDrawingZone()) ctx.zoneCancel();
  return ctx.decalHandleKeyDown(event);
}

/**
 * The Maker shortcut table. ORDER IS PRECEDENCE — do not reorder entries
 * without re-deriving the old `_onMakerKeyDown` if-chain (thermo review wave 1,
 * item 13). Labels are unique and dedicated to a future help overlay.
 */
export const MAKER_KEYMAP: readonly MakerKeyBinding[] = [
  {
    key: "z",
    modifiers: { ctrlOrMeta: true },
    label: "Undo / Redo (history step back / forward, Shift redo)",
    when: (ctx): boolean => !ctx.isEditingField(),
    action: (ctx, event): boolean => {
      event.preventDefault();
      if (event.shiftKey) ctx.redo();
      else ctx.undo();
      ctx.refreshSelectionAndHierarchy();
      return true;
    },
  },
  {
    key: "d",
    matchAnyKey: true,
    label: "Decal stamp active — route keys to the stamp tool",
    when: (ctx): boolean => ctx.isDecalStampActive() && !ctx.isEditingField(),
    action: decalRoute,
  },
  {
    key: "d",
    label: "Toggle decal stamp tool",
    when: (ctx): boolean => !ctx.isEditingField() && !ctx.isDecalStampActive(),
    action: decalRoute,
  },
  {
    key: "Escape",
    label: "Cancel zone drawing",
    when: (ctx): boolean => ctx.isDrawingZone(),
    action: (ctx, event): boolean => {
      event.preventDefault();
      ctx.zoneCancel();
      return true;
    },
  },
  {
    key: "Enter",
    label: "Finish zone drawing",
    when: (ctx): boolean => ctx.isDrawingZone(),
    action: (ctx, event): boolean => {
      event.preventDefault();
      ctx.zoneFinish();
      return true;
    },
  },
  {
    key: "z",
    exclude: { ctrl: true, meta: true, alt: true },
    label: "Toggle zone draw mode",
    when: (ctx): boolean => !ctx.isEditingField(),
    action: (ctx, event): boolean => {
      event.preventDefault();
      ctx.decalDisable();
      ctx.zoneToggle();
      return true;
    },
  },
  {
    key: "Delete",
    keyAliases: ["Backspace"],
    label: "Delete selection",
    when: (ctx): boolean => !ctx.isEditingField() && ctx.selectionSize() > 0,
    action: (ctx, event): boolean => {
      event.preventDefault();
      ctx.deleteSelection();
      return true;
    },
  },
  {
    key: "F2",
    label: "Rename primary object",
    when: (ctx): boolean => !ctx.isEditingField() && ctx.hasPrimary(),
    action: (ctx, event): boolean => {
      event.preventDefault();
      ctx.startRenamingPrimary();
      return true;
    },
  },
  {
    key: "f",
    modifiers: { ctrlOrMeta: true },
    label: "Focus hierarchy search",
    when: (ctx): boolean => !ctx.isEditingField(),
    action: (ctx, event): boolean => {
      event.preventDefault();
      ctx.focusSearch();
      return true;
    },
  },
  {
    key: "d",
    keyAliases: ["g"],
    modifiers: { ctrlOrMeta: true },
    label: "Duplicate / group selection (D / G)",
    when: (ctx): boolean => !ctx.isEditingField() && ctx.selectionSize() > 0,
    action: (ctx, event): boolean => {
      event.preventDefault();
      if ("d" === event.key.toLowerCase()) ctx.duplicateSelection();
      else ctx.groupSelection();
      return true;
    },
  },
  {
    key: "x",
    exclude: { ctrl: true, meta: true, alt: true },
    label: "Toggle snap",
    when: (ctx): boolean => !ctx.isEditingField(),
    action: (ctx): boolean => {
      ctx.toggleSnap();
      return true;
    },
  },
  {
    key: "1",
    numericRange: [1, 9] as const,
    label: "Camera bookmarks 1-9 (jump; Ctrl/Cmd+digit saves)",
    when: (ctx, event): boolean => !ctx.isEditingField() && !event.altKey,
    action: (ctx, event): boolean => {
      event.preventDefault();
      const slot = Number(event.key);
      if (event.ctrlKey || event.metaKey) ctx.saveCameraBookmark(slot);
      else ctx.jumpToCameraBookmark(slot);
      return true;
    },
  },
  {
    key: "w",
    keyAliases: ["e", "r"],
    exclude: { ctrl: true, meta: true, alt: true },
    label: "Set gizmo mode (W move / E rotate / R scale)",
    when: (ctx): boolean => !ctx.isEditingField(),
    action: (ctx, event): boolean => {
      const key = event.key.toLowerCase();
      const mode: GizmoMode = "w" === key ? "translate" : "e" === key ? "rotate" : "scale";
      ctx.setGizmoMode(mode);
      return true;
    },
  },
  {
    key: "[",
    keyAliases: ["]"],
    exclude: { ctrl: true, meta: true, alt: true },
    label: "Step grid (decrease / increase)",
    when: (ctx): boolean => !ctx.isEditingField(),
    action: (ctx, event): boolean => {
      event.preventDefault();
      ctx.stepGrid("[" === event.key ? -1 : 1);
      return true;
    },
  },
  {
    key: "End",
    label: "Snap selection to ground",
    when: (ctx): boolean => !ctx.isEditingField() && ctx.selectionSize() > 0,
    action: (ctx, event): boolean => {
      event.preventDefault();
      ctx.snapSelectionToGround();
      return true;
    },
  },
  {
    key: "ArrowLeft",
    keyAliases: ["ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown"],
    label: "Nudge selection (Shift x10 / Alt modes)",
    when: (ctx): boolean => !ctx.isEditingField() && ctx.selectionSize() > 0,
    action: (ctx, event): boolean => {
      event.preventDefault();
      ctx.nudgeSelection(event.key, event.shiftKey, event.altKey);
      return true;
    },
  },
];

function matchesKey(binding: MakerKeyBinding, event: MakerKeyEvent): boolean {
  if (binding.matchAnyKey) return true;
  if (binding.numericRange) {
    if (!/^[0-9]$/.test(event.key)) return false;
    const digit = Number(event.key);
    return digit >= binding.numericRange[0] && digit <= binding.numericRange[1];
  }
  const key = event.key.toLowerCase();
  if (key !== binding.key.toLowerCase()) {
    if (!binding.keyAliases?.some((alias) => key === alias.toLowerCase())) return false;
  }
  const mods = binding.modifiers;
  if (mods?.ctrlOrMeta && !(event.ctrlKey || event.metaKey)) return false;
  if (mods?.shift === true && !event.shiftKey) return false;
  if (mods?.alt === true && !event.altKey) return false;
  const exclude = binding.exclude;
  if (exclude?.ctrl && event.ctrlKey) return false;
  if (exclude?.meta && event.metaKey) return false;
  if (exclude?.shift && event.shiftKey) return false;
  if (exclude?.alt && event.altKey) return false;
  return true;
}

/**
 * Resolves a key event through the ordered keymap. Runs the first matching
 * binding whose `when` guard passes; a binding that reports its action as
 * unconsumed (the decal stamp pass-through) is skipped and the search
 * continues. Returns whether some binding consumed the event.
 */
export function dispatchMakerKey(event: MakerKeyEvent, ctx: MakerKeyContext): boolean {
  for (const binding of MAKER_KEYMAP) {
    if (!matchesKey(binding, event)) continue;
    if (binding.when && !binding.when(ctx, event)) continue;
    if (binding.action(ctx, event)) return true;
  }
  return false;
}
