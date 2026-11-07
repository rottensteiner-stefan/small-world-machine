import { ensureIoStyles } from "./ioStyles.js";

export type ToastKind = "info" | "success" | "warning" | "error";

const DEFAULT_DURATION_MS: Record<ToastKind, number> = {
  info: 4000,
  success: 3000,
  warning: 6000,
  error: 9000,
};

/** Non-blocking status messages. One instance per tool page; replaces `alert()`. */
export class ToastManager {
  private readonly _container: HTMLElement;

  constructor(doc: Document = document) {
    ensureIoStyles(doc);
    this._container = doc.createElement("div");
    this._container.className = "sw-io-toasts";
    this._container.setAttribute("role", "status");
    this._container.setAttribute("aria-live", "polite");
    doc.body.appendChild(this._container);
  }

  public show(
    message: string,
    kind: ToastKind = "info",
    durationMs: number = DEFAULT_DURATION_MS[kind],
  ): void {
    const toast: HTMLElement = this._container.ownerDocument.createElement("div");
    toast.className = "sw-io-toast";
    toast.dataset["kind"] = kind;
    toast.textContent = message;
    const dismiss = (): void => toast.remove();
    toast.addEventListener("click", dismiss);
    this._container.appendChild(toast);
    setTimeout(dismiss, durationMs);
  }

  public info(message: string): void {
    this.show(message, "info");
  }

  public success(message: string): void {
    this.show(message, "success");
  }

  public warning(message: string): void {
    this.show(message, "warning");
  }

  public error(message: string): void {
    this.show(message, "error");
  }

  public dispose(): void {
    this._container.remove();
  }
}
