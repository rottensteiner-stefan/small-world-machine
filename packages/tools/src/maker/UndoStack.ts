/** A single undoable action: `redo()` (re)applies it, `undo()` reverts it. `label` is shown to
 * the user (e.g. in a future "Undo <label>" menu item) -- not required for Phase 1's plain
 * keyboard-only undo/redo, but cheap to carry along now. */
export interface UndoCommand {
  label: string;
  redo(): void;
  undo(): void;
  /** Called exactly once, when this command permanently leaves history with no way back --
   * either trimmed off the front of a full undo stack, or dropped by `clear()`. Optional: only
   * commands that stash something a permanent discard must actually release (e.g. a soft-deleted
   * object parked in a trash bin specifically to keep undo cheap) need to implement it. Whichever
   * of `redo()`/`undo()` was applied most recently is still in effect when this runs, so the
   * command knows which side (if either) needs releasing. */
  discard?(): void;
  /** Commands executed back-to-back with the same `mergeKey` (within `MERGE_WINDOW_MS`, and with
   * no undo/redo/clear in between) collapse into ONE history step: the merged step redoes to the
   * newest command's state and undoes to the oldest command's pre-state. Both commands must
   * therefore restore absolute state (snapshots), not apply deltas. Used for held-key nudges. */
  mergeKey?: string;
}

/** Max gap between two same-key commands for them to merge into one undo step. */
export const MERGE_WINDOW_MS = 400;

/** Same cap Pixler's own undo history uses (`Pixler.ts`'s `_history`) -- kept in sync so both of
 * this project's undo stacks grow to the same bound rather than picking an arbitrary new number. */
const MAX_HISTORY = 50;

/**
 * Plain command-pattern undo/redo stack, the same shape as Pixler's own undo history. Executes
 * a command immediately, then makes it revertible/reappliable via `undo()`/`redo()`. Pushing a
 * new command after an undo discards the redo branch -- there is no redo tree, matching how
 * every mainstream editor (and Pixler) behaves.
 *
 * Bounded to `MAX_HISTORY` entries: without a cap, `_done`/`_undone` retain every command (and
 * everything it closed over) for the rest of the session, which is what makes Maker's
 * soft-delete trash bin pattern (see `MakerApp._trashBin`) a real, unbounded memory leak instead
 * of a bounded one -- a permanently unreachable command's `discard()` is the other half of that
 * fix, letting it actually release whatever it stashed instead of merely losing the stack's
 * reference to the command itself.
 */
export class UndoStack {
  private _undone: UndoCommand[] = [];
  private _done: UndoCommand[] = [];
  /** Timestamp of the last executed command while it is still the history top and may be merged into. */
  private _lastExecutedAt: number | undefined;

  constructor(private readonly _now: () => number = (): number => performance.now()) {}

  /** Runs `command.redo()` immediately and pushes it onto the undo history (or merges it into the
   * previous step, see `UndoCommand.mergeKey`). */
  public execute(command: UndoCommand): void {
    command.redo();
    this._discardAll(this._undone); // the redo branch is gone for good the moment something new executes
    const now = this._now();
    const top = this._done[this._done.length - 1];
    if (
      top !== undefined &&
      command.mergeKey !== undefined &&
      top.mergeKey === command.mergeKey &&
      this._lastExecutedAt !== undefined &&
      now - this._lastExecutedAt <= MERGE_WINDOW_MS
    ) {
      const olderDiscard = top.discard;
      const newerDiscard = command.discard;
      const merged: UndoCommand = {
        label: command.label,
        mergeKey: command.mergeKey,
        redo: command.redo,
        undo: top.undo,
      };
      if (olderDiscard || newerDiscard) {
        merged.discard = (): void => {
          olderDiscard?.();
          newerDiscard?.();
        };
      }
      this._done[this._done.length - 1] = merged;
      this._lastExecutedAt = now;
      return;
    }
    this._done.push(command);
    this._lastExecutedAt = now;
    if (this._done.length > MAX_HISTORY) {
      this._done.shift()?.discard?.();
    }
  }

  public get canUndo(): boolean {
    return 0 < this._done.length;
  }

  public get canRedo(): boolean {
    return 0 < this._undone.length;
  }

  public undo(): void {
    const command = this._done.pop();
    if (!command) return;
    this._lastExecutedAt = undefined;
    command.undo();
    this._undone.push(command);
  }

  public redo(): void {
    const command = this._undone.pop();
    if (!command) return;
    this._lastExecutedAt = undefined;
    command.redo();
    this._done.push(command);
  }

  /** Drops all history without undoing anything -- for a freshly loaded/reset document. */
  public clear(): void {
    this._lastExecutedAt = undefined;
    this._discardAll(this._done);
    this._discardAll(this._undone);
  }

  /** Calls `discard()` on every command in `list` (whichever of `redo()`/`undo()` each one last
   * applied is still in effect) and empties it -- shared by `clear()` and `execute()`'s redo-
   * branch/capacity trimming so a command is never silently dropped without the chance to release
   * whatever it stashed. */
  private _discardAll(list: UndoCommand[]): void {
    for (const command of list) command.discard?.();
    list.length = 0;
  }
}
