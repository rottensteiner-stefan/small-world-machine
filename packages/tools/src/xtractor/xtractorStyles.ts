const STYLE_ID = "xtractor-style";

const XTRACTOR_CSS = `
    .swf-ix-main-container {
      display: flex;
      flex: 1;
      overflow: hidden;
      width: 100%;
      height: 100%;
      background: transparent;
      color: var(--tool-text);
    }
    .swf-ix-workbench {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: transparent;
      position: relative;
      min-width: 0;
    }
    .swf-ix-toolbar {
      padding: 0.5rem 1rem;
      background: var(--tool-panel);
      border-bottom: 1px solid var(--tool-border);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 15px;
    }
    .swf-ix-toolbar-group {
      gap: 5px;
    }
    .swf-ix-canvas-container {
      flex: 1;
      overflow: auto;
      padding: 2rem;
      position: relative;
      background: repeating-conic-gradient(var(--tool-card) 0% 25%, var(--tool-panel-solid) 0% 50%) 50% / 20px 20px;
    }
    #canvas-stage {
      position: relative; 
      display: inline-block; 
      transform-origin: 0 0;
      transition: transform 0.1s ease-out;
    }
    /* shared.css sizes every canvas to 100vw x 100vh; the bitmap's own size must win here. */
    #image-canvas {
      width: auto;
      height: auto;
      box-shadow: var(--tool-shadow-float);
      cursor: crosshair;
      max-width: 100%;
    }
    #drop-overlay {
      position: absolute;
      inset: 0;
      background: color-mix(in srgb, var(--tool-bg) 90%, transparent);
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 1.5rem;
      color: var(--tool-accent);
      border: 2px dashed var(--tool-accent);
      border-radius: var(--tool-radius-lg);
      font-weight: 700;
      z-index: 10;
      display: none;
    }
    .swf-ix-splitter {
      width: 8px;
      background: var(--tool-panel-solid);
      cursor: col-resize;
      display: flex;
      justify-content: center;
      align-items: center;
      border-left: 1px solid var(--tool-border);
      border-right: 1px solid var(--tool-border);
      transition: background 0.2s;
      flex-shrink: 0;
      z-index: 50;
    }
    .swf-ix-splitter:hover, .swf-ix-splitter.active {
      background: var(--tool-accent);
    }
    .swf-ix-splitter::after {
      content: '||';
      color: var(--tool-text-muted);
      font-size: 10px;
      letter-spacing: -1px;
    }
    .swf-ix-sidebar {
      width: 400px;
      min-width: 250px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      background: var(--tool-panel);
    }
    .swf-ix-chat-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.6rem 1rem;
      background: var(--tool-panel-solid);
      border-bottom: 1px solid var(--tool-border);
      gap: 10px;
    }
    .swf-ix-chat-title {
      font-weight: 700;
      font-size: 0.95rem;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .swf-ix-provider-badge {
      font-size: 0.72rem;
      padding: 2px 6px;
      border-radius: 999px;
      background: var(--tool-card);
      border: 1px solid var(--tool-border);
      color: var(--tool-accent);
      font-family: monospace;
    }
    .swf-ix-ai-settings {
      padding: 1rem;
      background: var(--tool-panel);
      border-bottom: 2px solid var(--tool-border);
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      font-size: 0.85rem;
    }
    .swf-ix-settings-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .swf-ix-settings-row label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--tool-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .swf-ix-chat-history {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .swf-ix-message {
      padding: 0.85rem 1rem;
      border-radius: var(--tool-radius-md);
      max-width: 90%;
      line-height: 1.45;
      font-size: 0.9rem;
      word-break: break-word;
    }
    .swf-ix-message p {
      margin: 0 0 0.5rem 0;
    }
    .swf-ix-message p:last-child {
      margin-bottom: 0;
    }
    .swf-ix-message pre {
      background: var(--tool-panel-solid);
      border: 1px solid var(--tool-border);
      padding: 0.5rem;
      border-radius: var(--tool-radius-sm);
      overflow-x: auto;
      font-family: monospace;
      font-size: 0.82rem;
      margin: 0.4rem 0;
    }
    .swf-ix-message code {
      font-family: monospace;
      font-size: 0.85em;
      background: rgba(127, 127, 127, 0.2);
      padding: 1px 4px;
      border-radius: 3px;
    }
    .swf-ix-chip-container {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .swf-ix-action-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 8px;
      background: var(--tool-card);
      border: 1px solid var(--tool-accent);
      color: var(--tool-text);
      border-radius: var(--tool-radius-sm);
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.1s ease;
    }
    .swf-ix-action-chip:hover {
      background: var(--tool-accent-glow);
      transform: translateY(-1px);
    }
    .swf-ix-color-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--tool-panel-solid);
      border: 1px solid var(--tool-border);
      font-family: monospace;
      font-size: 0.78rem;
    }
    .swf-ix-color-swatch {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      border: 1px solid rgba(255,255,255,0.3);
      display: inline-block;
    }
    .swf-ix-thinking {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--tool-accent);
      font-style: italic;
    }
    .swf-ix-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--tool-accent);
      border-top-color: transparent;
      border-radius: 50%;
      animation: swf-ix-spin 0.8s linear infinite;
    }
    @keyframes swf-ix-spin {
      to { transform: rotate(360deg); }
    }
    .msg-ai {
      background: var(--tool-panel);
      align-self: flex-start;
      border: 1px solid var(--tool-border);
    }
    .msg-user {
      background: var(--tool-card-active);
      border: 1px solid var(--tool-border-active);
      align-self: flex-end;
    }
    .swf-ix-chat-input-area {
      padding: 1rem;
      background: var(--tool-panel);
      border-top: 1px solid var(--tool-border);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .swf-ix-context-pill {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0.5rem;
      display: none;
    }
    .swf-ix-context-pill canvas {
      width: auto;
      height: 40px;
      border: 1px solid var(--tool-border);
    }
    .swf-ix-chat-input-row {
      display: flex;
      gap: 10px;
    }
    #selection-box {
      position: absolute;
      border: 2px dashed var(--tool-accent2);
      background: var(--tool-accent2-glow);
      pointer-events: none;
      display: none;
      z-index: 5;
    }
    #selection-props {
      position: absolute;
      bottom: 20px;
      left: 20px;
      padding: 10px 15px;
      border-radius: var(--tool-radius-md);
      display: flex;
      gap: 15px;
      z-index: 20;
      box-shadow: var(--tool-shadow-float);
    }
  `;

export function injectXtractorStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.innerHTML = XTRACTOR_CSS;
  document.head.appendChild(style);
}
