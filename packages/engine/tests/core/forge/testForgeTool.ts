import type { ForgeToolOptions } from "../../../src/core/forge/ForgeTool.js";
import { ForgeTool } from "../../../src/core/forge/ForgeTool.js";

/** Minimal concrete `ForgeTool` for tests -- `ForgeTool` itself is abstract. */
export class TestForgeTool extends ForgeTool {
  public state: unknown = null;

  constructor(options: ForgeToolOptions = {}) {
    super(options);
  }

  public override getState(): unknown {
    return this.state;
  }

  public override setState(state: unknown): void {
    this.state = state;
  }
}
