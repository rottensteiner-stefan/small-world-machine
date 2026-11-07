const STYLE_ID = "sw-io-styles";

const IO_CSS = `
  .sw-io-toasts { position: fixed; right: 16px; bottom: 16px; z-index: 100000; display: flex;
    flex-direction: column; gap: 8px; max-width: min(420px, calc(100vw - 32px)); pointer-events: none; }
  .sw-io-toast { pointer-events: auto; padding: 10px 14px; border-radius: 8px; font: 13px/1.4 var(--swf-font, system-ui, sans-serif);
    color: var(--swf-text, #e2e8f0); background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(148, 163, 184, 0.4);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4); cursor: pointer; white-space: pre-wrap; word-break: break-word; }
  .sw-io-toast[data-kind="success"] { border-color: #22c55e; }
  .sw-io-toast[data-kind="warning"] { border-color: #f59e0b; }
  .sw-io-toast[data-kind="error"] { border-color: #ef4444; }
  .sw-io-drop { position: fixed; inset: 0; z-index: 99999; display: none; align-items: center; justify-content: center;
    background: rgba(15, 23, 42, 0.78); backdrop-filter: blur(3px); pointer-events: none; }
  .sw-io-drop[data-active="true"] { display: flex; }
  .sw-io-drop-label { padding: 28px 44px; border: 2px dashed var(--swf-accent, #b000ff); border-radius: 16px;
    font: 600 18px var(--swf-font, system-ui, sans-serif); color: var(--swf-text, #e2e8f0);
    box-shadow: 0 0 32px rgba(176, 0, 255, 0.35); }
  .sw-io-modal-backdrop { position: fixed; inset: 0; z-index: 100001; display: flex; align-items: center;
    justify-content: center; background: rgba(0, 0, 0, 0.55); }
  .sw-io-modal { width: min(560px, calc(100vw - 32px)); max-height: 80vh; display: flex; flex-direction: column;
    border-radius: 12px; background: #0f172a; border: 1px solid rgba(148, 163, 184, 0.35);
    font: 13px/1.45 var(--swf-font, system-ui, sans-serif); color: var(--swf-text, #e2e8f0); }
  .sw-io-modal h2 { margin: 0; padding: 14px 18px; font-size: 15px; border-bottom: 1px solid rgba(148, 163, 184, 0.25); }
  .sw-io-modal ul { margin: 0; padding: 8px 18px; overflow: auto; list-style: none; }
  .sw-io-modal li { padding: 6px 0; border-bottom: 1px solid rgba(148, 163, 184, 0.12); }
  .sw-io-modal li[data-severity="error"] .sw-io-sev { color: #ef4444; }
  .sw-io-modal li[data-severity="warning"] .sw-io-sev { color: #f59e0b; }
  .sw-io-modal li[data-severity="info"] .sw-io-sev { color: #38bdf8; }
  .sw-io-path { display: block; color: var(--swf-text-muted, #94a3b8); font-size: 12px; }
  .sw-io-modal button { align-self: flex-end; margin: 12px 18px; padding: 6px 16px; border-radius: 6px; cursor: pointer;
    background: var(--swf-accent, #b000ff); color: #fff; border: 0; font: inherit; }
`;

export function ensureIoStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style: HTMLStyleElement = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = IO_CSS;
  doc.head.appendChild(style);
}
