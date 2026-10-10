export const FORGE_THEME_CSS = `
  :root {
    --swf-bg: rgba(15, 23, 42, 0.65); /* More transparent for better glass effect */
    --swf-panel: rgba(30, 41, 59, 0.5);
    --swf-panel-hover: rgba(51, 65, 85, 0.65);
    --swf-border: rgba(176, 0, 255, 0.3);
    --swf-border-focus: rgba(176, 0, 255, 0.8);
    --swf-accent: #b000ff;
    --swf-accent-alt: #ff00ff;
    --swf-text: #e2e8f0;
    --swf-text-muted: #94a3b8;
    --swf-font: "Rajdhani", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    --swf-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);

    /* Tweakpane Integration */
    --tp-base-background-color: transparent;
    --tp-base-shadow-color: transparent;
    --tp-button-background-color: var(--swf-panel);
    --tp-button-background-color-active: var(--swf-accent);
    --tp-button-background-color-focus: var(--swf-panel-hover);
    --tp-button-background-color-hover: var(--swf-panel-hover);
    --tp-button-foreground-color: var(--swf-text);
    --tp-container-background-color: rgba(0, 0, 0, 0.2);
    --tp-container-background-color-active: rgba(0, 0, 0, 0.4);
    --tp-container-background-color-focus: rgba(0, 0, 0, 0.3);
    --tp-container-background-color-hover: rgba(0, 0, 0, 0.3);
    --tp-container-foreground-color: var(--swf-text);
    --tp-groove-foreground-color: rgba(0, 0, 0, 0.2);
    --tp-input-background-color: rgba(0, 0, 0, 0.3);
    --tp-input-background-color-active: rgba(0, 0, 0, 0.5);
    --tp-input-background-color-focus: rgba(0, 0, 0, 0.5);
    --tp-input-background-color-hover: rgba(0, 0, 0, 0.5);
    --tp-input-foreground-color: var(--swf-accent);
    --tp-label-foreground-color: var(--swf-text-muted);
    --tp-monitor-background-color: rgba(0, 0, 0, 0.3);
    --tp-monitor-foreground-color: var(--swf-accent);
    --tp-folder-background-color: rgba(15, 23, 42, 0.4);
    --tp-folder-background-color-active: rgba(15, 23, 42, 0.8);
    --tp-folder-background-color-focus: rgba(15, 23, 42, 0.6);
    --tp-folder-background-color-hover: rgba(15, 23, 42, 0.6);
  }

  /* Forge Global Container */
  .swf-forge-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    pointer-events: none;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    font-family: var(--swf-font);
    color: var(--swf-text);
  }

  /* Taskbar */
  .swf-taskbar {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 36px;
    box-sizing: border-box;
    background: rgba(15, 23, 42, 0.95);
    border-top: 1px solid var(--swf-border);
    display: flex;
    align-items: center;
    padding: 0 12px;
    gap: 8px;
    pointer-events: auto;
    z-index: 99999;
    backdrop-filter: blur(10px);
  }

  /* Taskbar Buttons */
  .swf-taskbar-btn {
    background: var(--swf-panel);
    border: 1px solid var(--swf-border);
    color: var(--swf-text);
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
    transition: all 0.2s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .swf-taskbar-btn:hover {
    background: var(--swf-panel-hover);
    border-color: var(--swf-accent);
    color: var(--swf-accent);
    box-shadow: 0 0 10px rgba(0, 229, 255, 0.3);
  }
  .swf-taskbar-btn.inactive {
    opacity: 0.5;
    background: transparent;
    border-color: var(--swf-text-muted);
    color: var(--swf-text-muted);
    box-shadow: none;
  }

  /* Forge Window */
  .swf-window {
    position: absolute;
    background: var(--swf-bg);
    border: 1px solid var(--swf-border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    box-shadow: var(--swf-shadow);
    pointer-events: auto;
    overflow: hidden;
    /* Never larger than the screen: the header (and its close button) must stay reachable.
       The reserved strip at the bottom is the taskbar. */
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 44px);
    backdrop-filter: blur(12px);
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
  }
  .swf-window:focus-within {
    border-color: var(--swf-accent);
    box-shadow: 0 0 15px rgba(0, 229, 255, 0.15);
  }

  /* Forge Window Header */
  .swf-window-header {
    height: 32px;
    background: linear-gradient(90deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 41, 59, 0.9) 100%);
    border-bottom: 1px solid var(--swf-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    cursor: move;
    user-select: none;
    flex-shrink: 0;
    position: relative;
    z-index: 100;
  }
  .swf-window-title {
    font-weight: 600;
    font-size: 14px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--swf-accent);
  }
  .swf-window-close {
    background: none;
    border: none;
    color: var(--swf-text-muted);
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
    transition: color 0.2s;
  }
  .swf-window-close:hover {
    color: #ef4444;
  }

  .swf-window-content {
    padding: 8px;
    flex: 1;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }

  .swf-window-resize-handle {
    position: absolute;
    width: 10px;
    height: 10px;
    background: transparent;
    z-index: 100;
  }
  .swf-resize-nw {
    top: 0; left: 0;
    cursor: nw-resize;
  }
  .swf-resize-ne {
    top: 0; right: 0;
    cursor: ne-resize;
  }
  .swf-resize-sw {
    bottom: 0; left: 0;
    cursor: sw-resize;
  }
  .swf-resize-se {
    bottom: 0; right: 0;
    cursor: se-resize;
  }
  /* Buttons */
  .swf-btn {
    background: var(--swf-panel);
    color: var(--swf-text);
    border: 1px solid var(--swf-border);
    border-radius: 4px;
    padding: 6px 12px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .swf-btn:hover {
    background: var(--swf-panel-hover);
    border-color: var(--swf-accent);
    color: var(--swf-accent);
    box-shadow: 0 0 8px rgba(0, 229, 255, 0.2);
  }
  .swf-btn.active {
    background: var(--swf-accent);
    color: #000;
    border-color: var(--swf-accent);
  }
  .swf-btn.secondary {
    background: transparent;
    border-color: var(--swf-text-muted);
    color: var(--swf-text-muted);
  }
  .swf-btn.secondary:hover {
    border-color: var(--swf-accent-alt);
    color: var(--swf-accent-alt);
    box-shadow: 0 0 8px rgba(255, 0, 255, 0.2);
  }

  /* Inputs */
  .swf-input {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--swf-border);
    border-radius: 4px;
    color: var(--swf-text);
    padding: 6px 8px;
    font-family: inherit;
    font-size: 13px;
    transition: border-color 0.2s ease;
    outline: none;
  }
  .swf-input:focus {
    border-color: var(--swf-accent);
    box-shadow: 0 0 5px rgba(0, 229, 255, 0.2);
  }

  /* Scrollbars */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }
  ::-webkit-scrollbar-thumb {
    background: var(--swf-panel);
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: var(--swf-accent);
  }
`;
