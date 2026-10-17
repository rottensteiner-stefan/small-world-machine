import { DEFAULT_MODE_ID, type ToolMode } from "./ToolMode.js";

/**
 * Minimal adapter exposing Maker's persistent editor as the default `world` mode. The editor
 * IS the shell: its panels and viewport are always live, so mount/unmount stay inert and the
 * adapter exists so the host has a `world` entry for the hash router to default into.
 */
export class WorldModeAdapter implements ToolMode {
  public readonly modeId: string = DEFAULT_MODE_ID;

  public initialize(): void {}

  public mount(_hostEl: HTMLElement): void {}

  public unmount(): void {}

  public getState(): unknown {
    return undefined;
  }

  public setState(_state: unknown): void {}
}
