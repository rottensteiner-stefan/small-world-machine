/**
 * Validation guard around the (synchronous) pipeline creation of an OPTIONAL post effect.
 *
 * Without it, an invalid effect pipeline (WGSL error, binding-limit violation on a low-limit
 * device) only surfaces as an uncaptured error and every later `ce.finish()` that references the
 * pipeline is invalid -- the whole frame is dropped (black screen) because of one optional effect.
 *
 * Usage (one gate per pass instance, no global state -- multiple engine instances are fine):
 * ```ts
 * this._gate = new PostEffectPipelineGate(device, "DepthOfField");
 * this._gate.begin();          // pushErrorScope("validation")
 * ... createShaderModule / createRenderPipeline / createComputePipeline ...
 * this._gate.end();            // popErrorScope() -> settles asynchronously
 * ...
 * execute(): if (!this._gate.ready) return null;   // pending (1-2 frames) or failed: skip effect
 * ```
 * A failed gate stays failed for the lifetime of the pass (warns exactly once); the effect is
 * simply disabled. Devices without `pushErrorScope` (test doubles) settle as ready immediately.
 *
 * `onSettled` lets a pass that owns several pipeline generations (e.g. the uber pass with its
 * signature-dependent variants) react to the verdict.
 */
export class PostEffectPipelineGate {
  private _state: "pending" | "ready" | "failed" = "pending";
  private _scoped: boolean = false;

  constructor(
    private readonly _device: GPUDevice,
    private readonly _label: string,
    private readonly _onSettled?: (ok: boolean) => void,
  ) {}

  /** True once the creation scope popped without a validation error. */
  public get ready(): boolean {
    return this._state === "ready";
  }

  /** True when validation failed; the effect must stay disabled. */
  public get failed(): boolean {
    return this._state === "failed";
  }

  /** Opens the validation scope. Call immediately before the pipeline creation calls. */
  public begin(): void {
    this._state = "pending";
    if (typeof this._device.pushErrorScope !== "function") {
      this._scoped = false;
      return;
    }
    this._scoped = true;
    this._device.pushErrorScope("validation");
  }

  /** Closes the validation scope. Call in the same synchronous block as `begin()`. */
  public end(): void {
    if (!this._scoped) {
      this._settle(true, undefined);
      return;
    }
    this._scoped = false;
    this._device.popErrorScope().then(
      (error: GPUError | null) => this._settle(error === null, error?.message),
      (reason: unknown) => this._settle(false, String(reason)),
    );
  }

  private _settle(ok: boolean, message: string | undefined): void {
    this._state = ok ? "ready" : "failed";
    if (!ok) {
      console.warn(
        `[PostEffect] "${this._label}" pipeline failed validation, effect disabled: ${message ?? "unknown error"}`,
      );
    }
    this._onSettled?.(ok);
  }
}
