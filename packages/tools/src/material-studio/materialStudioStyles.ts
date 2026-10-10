export const MATERIAL_STUDIO_CSS = `
      .swf-ms-container {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        overflow-y: auto;
        background: var(--tool-bg);
        color: var(--tool-text);
        font-family: var(--tool-font-ui);
        box-sizing: border-box;
      }

      .swf-ms-container *,
      .swf-ms-container *::before,
      .swf-ms-container *::after {
        box-sizing: border-box;
      }

      .swf-ms-container .app-container {
        display: flex;
        flex: 1;
        height: 100%;
        position: relative;
      }

      /* Sidebar controls */
      .swf-ms-container .sidebar {
        width: 320px;
        background: var(--tool-panel);
        border-right: 1px solid var(--tool-border);
        display: flex;
        flex-direction: column;
        height: 100%;
        z-index: 5;
      }

      .swf-ms-container .sidebar-scroll {
        flex: 1;
        overflow-y: auto;
        padding: 0.75rem;
      }

      .swf-ms-container .section-title {
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--tool-text-muted);
        margin: 0.9rem 0 0.5rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border-bottom: 1px solid var(--tool-border);
        padding-bottom: 0.35rem;
      }

      .swf-ms-container .section-title:first-child {
        margin-top: 0;
      }

      .swf-ms-container .control-row {
        margin-bottom: 0.6rem;
      }

      .swf-ms-container .control-row:last-child {
        margin-bottom: 0;
      }

      .swf-ms-container .field-label {
        display: flex;
        justify-content: space-between;
        font-size: 0.82rem;
        font-weight: 500;
        color: var(--tool-text-muted);
        margin-bottom: 0.3rem;
      }

      .swf-ms-container .tool-select {
        width: 100%;
      }

      /* Toggle switch row */
      .swf-ms-container .switch-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .swf-ms-container .switch-row .field-label {
        margin-bottom: 0;
        cursor: pointer;
      }

      /* Dropzone */
      .swf-ms-container .dropzone {
        border: 1px dashed var(--tool-border-active);
        border-radius: var(--tool-radius-md);
        padding: 1rem 0.75rem;
        text-align: center;
        cursor: pointer;
        background: var(--tool-card);
        transition: all 0.15s ease;
        margin-bottom: 0.75rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.35rem;
      }

      .swf-ms-container .dropzone:hover,
.swf-ms-container .dropzone.dragover {
        border-color: var(--tool-accent);
        background: var(--tool-card-active);
      }

      .swf-ms-container .dropzone-icon {
        color: var(--tool-accent);
        transition: transform 0.15s ease;
      }

      .swf-ms-container .dropzone:hover .dropzone-icon {
        transform: translateY(-2px);
      }

      .swf-ms-container .dropzone-text {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--tool-text);
      }

      .swf-ms-container .dropzone-sub {
        font-size: 0.72rem;
        color: var(--tool-text-muted);
      }

      /* Sidebar action buttons */
      .swf-ms-container .sidebar-actions {
        padding: 0.75rem;
        border-top: 1px solid var(--tool-border);
        background: var(--tool-panel-solid);
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.5rem;
      }

      .swf-ms-container .sidebar-actions .tool-btn {
        padding: 0.55rem 0.8rem;
        font-size: 0.85rem;
      }

      /* Main viewport & tabs */
      .swf-ms-container .viewport {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: var(--tool-bg);
        overflow: hidden;
        position: relative;
      }

      .swf-ms-container .tabs-bar {
        margin: 0.6rem 0.75rem 0;
        overflow-x: auto;
        flex-shrink: 0;
      }

      .swf-ms-container .tool-tab {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        white-space: nowrap;
      }

      .swf-ms-container .tool-tab.tab-engine:not(.active) {
        color: var(--tool-accent2);
      }

      .swf-ms-container .canvas-container {
        flex: 1;
        padding: 0.75rem;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        overflow: auto;
        position: relative;
      }

      /* Transparency checkerboard behind the maps */
      .swf-ms-container .checkerboard {
        background-image:
          linear-gradient(45deg, var(--tool-card-hover) 25%, transparent 25%),
          linear-gradient(-45deg, var(--tool-card-hover) 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, var(--tool-card-hover) 75%),
          linear-gradient(-45deg, transparent 75%, var(--tool-card-hover) 75%);
        background-size: 20px 20px;
        background-position:
          0 0,
          0 10px,
          10px -10px,
          -10px 0px;
        background-color: var(--tool-panel-solid);
        border-radius: var(--tool-radius-md);
        border: 1px solid var(--tool-border);
        display: flex;
        align-items: center;
        justify-content: center;
        max-width: 100%;
        max-height: 100%;
        padding: 10px;
      }

      .swf-ms-container canvas {
        max-width: 100%;
        max-height: 70vh;
        object-fit: contain;
        border-radius: var(--tool-radius-sm);
        display: block;
        width: auto;
        height: auto;
      }

      /* Grid view */
      .swf-ms-container .grid-view {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 0.75rem;
        width: 100%;
        height: 100%;
        overflow-y: auto;
        align-content: start;
      }

      .swf-ms-container .grid-item {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        align-items: center;
        position: relative;
      }

      .swf-ms-container .grid-item-title {
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--tool-text-muted);
        align-self: flex-start;
        display: flex;
        justify-content: space-between;
        width: 100%;
        align-items: center;
        border-bottom: 1px solid var(--tool-border);
        padding-bottom: 0.3rem;
      }

      .swf-ms-container .grid-item-download {
        cursor: pointer;
        color: var(--tool-accent);
        transition: color 0.15s ease;
        display: flex;
        align-items: center;
      }

      .swf-ms-container .grid-item-download:hover {
        color: var(--tool-text);
      }

      .swf-ms-container .grid-item .checkerboard {
        width: 100%;
        aspect-ratio: 1;
        padding: 6px;
      }

      .swf-ms-container .grid-item canvas {
        width: 100%;
        height: 100%;
        max-height: 100%;
      }

      /* 3D preview */
      .swf-ms-container .preview3d {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        align-items: center;
        justify-content: flex-start;
        padding-top: 0.5rem;
      }

      .swf-ms-container .preview3d-stage {
        flex: 1;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .swf-ms-container #SmallWorldMachinePreview {
        max-width: 100%;
        max-height: 60vh;
        background: var(--tool-bg);
        border: 1px solid var(--tool-border);
        border-radius: var(--tool-radius-md);
      }

      /* Loading overlay */
      .swf-ms-container .loading-overlay {
        position: absolute;
        inset: 0;
        background: color-mix(in srgb, var(--tool-bg) 85%, transparent);
        z-index: 100;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
      }

      .swf-ms-container .loading-overlay.active {
        opacity: 1;
        pointer-events: auto;
      }

      .swf-ms-container .loading-text {
        font-weight: 600;
        font-size: 0.95rem;
        color: var(--tool-text);
      }

      .swf-ms-container .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid var(--tool-border);
        border-top-color: var(--tool-accent);
        border-radius: 50%;
        animation: spin 1s infinite linear;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .swf-ms-container .hidden {
        display: none !important;
      }

      .swf-ms-container .tab-content-hidden {
        position: absolute !important;
        left: -9999px !important;
        top: -9999px !important;
        opacity: 0 !important;
        pointer-events: none !important;
        visibility: hidden !important;
      }

      /* Expandable sections */
      .swf-ms-container .collapsible-header {
        width: 100%;
        justify-content: space-between;
        margin-top: 0.4rem;
      }

      .swf-ms-container .collapsible-header svg {
        transition: transform 0.15s ease;
      }

      .swf-ms-container .collapsible-header.active svg {
        transform: rotate(90deg);
      }

      .swf-ms-container .collapsible-content {
        max-height: 0;
        overflow: hidden;
        transition:
          max-height 0.25s ease-out,
          padding 0.25s ease;
        padding: 0 0.25rem;
      }

      .swf-ms-container .collapsible-content.open {
        max-height: 1000px;
        padding: 0.6rem 0.25rem 0.75rem;
      }
    `;
