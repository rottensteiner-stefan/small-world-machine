/**
 * Dependencies-injected undo-command runner backing `MakerApp._commit` and
 * `MakerApp._snapshotCommand`.
 *
 * The Maker undo sites all follow one strict ordering contract (thermo review
 * wave 1, item 17): an undoable operation is executed immediately, the shared
 * post-apply follow-up (selection refresh, hierarchy dirty flag, autosave)
 * runs exactly once after each (re-)application, and an undo/redo round trip
 * restores the before/after state. Keeping that mechanics in this small,
 * injected module means the ordering contract all undo call sites rely on can
 * be unit-tested without constructing a full `MakerApp` engine.
 */

/** Shape of the command handed to the undo stack — matches `UndoCommand`. */
export interface MakerUndoCommand {
  label: string;
  redo: () => void;
  undo: () => void;
  discard?: () => void;
}

/** A group of objects a transform/snapshot command may move together. */
export interface Transformable {
  updateMatrixWorld(): void;
}

export interface MakerUndoRunnerDeps {
  /** Commits a command to the undo stack (must run `redo` synchronously). */
  execute: (command: MakerUndoCommand) => void;
  /** The shared post-apply follow-up, run exactly once per (re-)application. */
  afterApply: () => void;
}

export interface MakerUndoRunner {
  /**
   * Executes an undoable operation via the injected undo stack and runs the
   * injected follow-up exactly once after the (re-)application of the change.
   */
  commit(label: string, redo: () => void, undo: () => void, discard?: () => void): void;
  /**
   * Executes a snapshot/restore transform over `objs` as ONE undo step:
   * captures the pre-state via `read`, runs `apply` once to reach the target
   * state, captures that as the redo payload, then commits redo/undo that
   * re-apply the target / restore the pre-state (each also calling
   * `updateMatrixWorld` per object and the shared follow-up once).
   */
  snapshotCommand<T, O extends Transformable>(
    objs: O[],
    read: (obj: O) => T,
    write: (obj: O, value: T) => void,
    label: string,
    apply: () => void,
  ): void;
}

export function createMakerCommandRunner(deps: MakerUndoRunnerDeps): MakerUndoRunner {
  return {
    commit(label: string, redo: () => void, undo: () => void, discard?: () => void): void {
      const command: MakerUndoCommand = {
        label,
        redo: () => {
          redo();
          deps.afterApply();
        },
        undo: () => {
          undo();
          deps.afterApply();
        },
      };
      if (discard !== undefined) command.discard = discard;
      deps.execute(command);
    },
    snapshotCommand<T, O extends Transformable>(
      objs: O[],
      read: (obj: O) => T,
      write: (obj: O, value: T) => void,
      label: string,
      apply: () => void,
    ): void {
      const before = objs.map((obj) => ({ obj, value: read(obj) }));
      // `apply` moves the objects to their target state; the post-state is the
      // redo payload (identical to the old "compute after, then execute runs
      // redo" sequence — execute is synchronous).
      apply();
      const after = objs.map((obj) => ({ obj, value: read(obj) }));
      this.commit(
        label,
        () => {
          for (const { obj, value } of after) {
            write(obj, value);
            obj.updateMatrixWorld();
          }
        },
        () => {
          for (const { obj, value } of before) {
            write(obj, value);
            obj.updateMatrixWorld();
          }
        },
      );
    },
  };
}
