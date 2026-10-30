export function buildMaterialStudioUI(container: HTMLElement): void {
  const wrapper = document.createElement("div");
  wrapper.className = "swf-ms-container";
  wrapper.innerHTML = `
    <div class="app-container">
      <!-- Loading Screen -->
      <div id="loading-overlay" class="loading-overlay active">
        <div class="spinner"></div>
        <div id="loading-text" class="loading-text">
          Processing rock texture...
        </div>
      </div>

      <!-- Sidebar controls -->
      <div class="sidebar">
        <div class="sidebar-scroll">
          <!-- Dropzone / Universal Ingest -->
          <div id="materialstudio-dropzone-container" style="margin-bottom: 0.75rem;"></div>

          <!-- Preset select -->
          <div class="section-title">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
            Preset Profile
          </div>
          <div class="control-row">
            <select class="tool-select" id="profile-select">
              <option value="default" selected>Default (Balanced)</option>
              <option value="stone">Stone (High Normal, Rough)</option>
              <option value="metal">Metal (Smooth, Shiny Spec)</option>
              <option value="wood">Wood (Grained, Deep Relief)</option>
            </select>
          </div>

          <div class="section-title">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
            Configure Parameters
          </div>

          <!-- 1. Height Map Settings -->
          <div class="tool-btn collapsible-header active" data-target="height-settings">
            <span>Height Map Settings</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
          <div id="height-settings" class="collapsible-content open">
            <div class="control-row">
              <label class="field-label">
                Blur Radius
                <span id="height-blur-val" class="tool-value">0</span>
              </label>
              <input class="tool-slider" type="range" id="height-blur-slider" min="0" max="10" step="1" value="0" />
            </div>
            <div class="control-row">
              <label class="field-label">
                Contrast
                <span id="height-contrast-val" class="tool-value">1.0</span>
              </label>
              <input
                class="tool-slider"
                type="range"
                id="height-contrast-slider"
                min="0.5"
                max="3.0"
                step="0.1"
                value="1.0"
              />
            </div>
            <div class="control-row switch-row">
              <label class="field-label" for="height-invert">Invert Map</label>
              <label class="tool-switch"><input type="checkbox" id="height-invert" /><span class="tool-switch-track"></span></label>
            </div>
          </div>

          <!-- 2. Normal Map Settings -->
          <div class="tool-btn collapsible-header" data-target="normal-settings">
            <span>Normal Map Settings</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
          <div id="normal-settings" class="collapsible-content">
            <div class="control-row">
              <label class="field-label">
                Bump Strength
                <span id="normal-strength-val" class="tool-value">100%</span>
              </label>
              <input
                class="tool-slider"
                type="range"
                id="normal-strength-slider"
                min="10"
                max="300"
                step="5"
                value="100"
              />
            </div>
            <div class="control-row">
              <label class="field-label"> Format </label>
              <select class="tool-select" id="normal-format">
                <option value="opengl">OpenGL (+Y / Green Up)</option>
                <option value="directx">DirectX (-Y / Green Down)</option>
              </select>
            </div>
            <div class="control-row switch-row">
              <label class="field-label" for="normal-invert-r">Invert Red (X-axis)</label>
              <label class="tool-switch"><input type="checkbox" id="normal-invert-r" /><span class="tool-switch-track"></span></label>
            </div>
          </div>

          <!-- 3. Specular Map Settings -->
          <div class="tool-btn collapsible-header" data-target="specular-settings">
            <span>Specular Map Settings</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
          <div id="specular-settings" class="collapsible-content">
            <div class="control-row">
              <label class="field-label">
                Sigmoidal Contrast
                <span id="spec-contrast-val" class="tool-value">10</span>
              </label>
              <input class="tool-slider" type="range" id="spec-contrast-slider" min="0" max="30" step="1" value="10" />
            </div>
            <div class="control-row">
              <label class="field-label">
                Midpoint Threshold
                <span id="spec-thresh-val" class="tool-value">50%</span>
              </label>
              <input class="tool-slider" type="range" id="spec-thresh-slider" min="10" max="90" step="5" value="50" />
            </div>
            <div class="control-row switch-row">
              <label class="field-label" for="spec-invert">Invert Specular</label>
              <label class="tool-switch"><input type="checkbox" id="spec-invert" /><span class="tool-switch-track"></span></label>
            </div>
          </div>

          <!-- 4. Roughness Map Settings -->
          <div class="tool-btn collapsible-header" data-target="roughness-settings">
            <span>Roughness Map Settings</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
          <div id="roughness-settings" class="collapsible-content">
            <div class="control-row">
              <label class="field-label">
                Gamma Exponent
                <span id="rough-gamma-val" class="tool-value">1.20</span>
              </label>
              <input
                class="tool-slider"
                type="range"
                id="rough-gamma-slider"
                min="0.20"
                max="3.00"
                step="0.05"
                value="1.20"
              />
            </div>
            <div class="control-row switch-row">
              <label class="field-label" for="rough-invert">Invert Roughness</label>
              <label class="tool-switch"><input type="checkbox" id="rough-invert" /><span class="tool-switch-track"></span></label>
            </div>
          </div>

          <!-- 5. Ambient Occlusion Settings -->
          <div class="tool-btn collapsible-header" data-target="ao-settings">
            <span>Ambient Occlusion Settings</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
          <div id="ao-settings" class="collapsible-content">
            <div class="control-row">
              <label class="field-label">
                Soft Shadow Blur
                <span id="ao-soft-val" class="tool-value">15px</span>
              </label>
              <input class="tool-slider" type="range" id="ao-soft-slider" min="3" max="40" step="1" value="15" />
            </div>
            <div class="control-row">
              <label class="field-label">
                Crevice Strength (Fine)
                <span id="ao-fine-val" class="tool-value">1.0</span>
              </label>
              <input class="tool-slider" type="range" id="ao-fine-slider" min="0.0" max="3.0" step="0.1" value="1.0" />
            </div>
            <div class="control-row">
              <label class="field-label">
                AO Intensity Level
                <span id="ao-level-val" class="tool-value">30%</span>
              </label>
              <input class="tool-slider" type="range" id="ao-level-slider" min="0" max="80" step="5" value="30" />
            </div>
          </div>

          <!-- 6. Edge Map Settings -->
          <div class="tool-btn collapsible-header" data-target="edge-settings">
            <span>Edge Map Settings</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
          <div id="edge-settings" class="collapsible-content">
            <div class="control-row">
              <label class="field-label">
                Contrast Threshold
                <span id="edge-thresh-val" class="tool-value">90%</span>
              </label>
              <input class="tool-slider" type="range" id="edge-thresh-slider" min="50" max="98" step="1" value="90" />
            </div>
            <div class="control-row">
              <label class="field-label">
                Edge Thickness
                <span id="edge-thick-val" class="tool-value">1</span>
              </label>
              <input class="tool-slider" type="range" id="edge-thick-slider" min="1" max="5" step="1" value="1" />
            </div>
            <div class="control-row switch-row">
              <label class="field-label" for="edge-invert">Invert Colors (Dark line)</label>
              <label class="tool-switch"><input type="checkbox" id="edge-invert" checked /><span class="tool-switch-track"></span></label>
            </div>
          </div>

          <!-- 7. 3D Preview Settings -->
          <div class="tool-btn collapsible-header" data-target="preview-3d-settings">
            <span>3D Preview Settings</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
          <div id="preview-3d-settings" class="collapsible-content">
            <div class="control-row">
              <label class="field-label">
                Metallic Base
                <span id="metallic-val" class="tool-value">0%</span>
              </label>
              <input class="tool-slider" type="range" id="metallic-slider" min="0" max="100" step="5" value="0" />
            </div>
            <div class="control-row">
              <label class="field-label">
                Roughness Override
                <span id="roughness-override-val" class="tool-value">60%</span>
              </label>
              <input
                class="tool-slider"
                type="range"
                id="roughness-override-slider"
                min="0"
                max="100"
                step="5"
                value="60"
              />
            </div>
          </div>

          <!-- Global Export Size -->
          <div class="section-title">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            Export Properties
          </div>
          <div class="control-row">
            <label class="field-label">Working Max Resolution</label>
            <select class="tool-select" id="export-size">
              <option value="256">256 x 256 (Ultra Fast)</option>
              <option value="512" selected>512 x 512 (Recommended)</option>
              <option value="1024">1024 x 1024 (HD Detail)</option>
              <option value="original">Original Image Size (Full Resolution)</option>
            </select>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="sidebar-actions">
          <button id="btn-download-all" class="tool-btn primary">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Download All Maps
          </button>
          <button
            id="btn-send-drawer"
            class="tool-btn"
            title="Übergibt das aktuelle Material (Diffuse/Normal/Roughness + Parameter) in den Maker Content Drawer"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            In Content Drawer übernehmen
          </button>
        </div>
      </div>

      <!-- Main Viewport -->
      <div class="viewport">
        <div class="tool-tabs tabs-bar">
          <button class="tool-tab active" data-tab="grid">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            All Maps Grid
          </button>
          <button class="tool-tab" data-tab="original">Original (Diffuse)</button>
          <button class="tool-tab" data-tab="height">Height Map</button>
          <button class="tool-tab" data-tab="normal">Normal Map</button>
          <button class="tool-tab" data-tab="specular">Specular Map</button>
          <button class="tool-tab" data-tab="roughness">Roughness Map</button>
          <button class="tool-tab" data-tab="ao">Ambient Occlusion</button>
          <button class="tool-tab" data-tab="edge">Edge Map</button>
          <button class="tool-tab tab-engine" data-tab="preview3d">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <path
                d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
              />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            Small World Machine Preview
          </button>
        </div>

        <div class="canvas-container">
          <!-- Grid View Content -->
          <div id="grid-view-container" class="grid-view">
            <div class="grid-item">
              <div class="grid-item-title">
                <span>Original (Diffuse)</span>
              </div>
              <div class="checkerboard">
                <canvas id="canvas-grid-original"></canvas>
              </div>
            </div>

            <div class="grid-item">
              <div class="grid-item-title">
                <span>Height Map</span>
                <span class="grid-item-download" data-map="height" title="Download Height Map">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </span>
              </div>
              <div class="checkerboard">
                <canvas id="canvas-grid-height"></canvas>
              </div>
            </div>

            <div class="grid-item">
              <div class="grid-item-title">
                <span>Normal Map</span>
                <span class="grid-item-download" data-map="normal" title="Download Normal Map">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </span>
              </div>
              <div class="checkerboard">
                <canvas id="canvas-grid-normal"></canvas>
              </div>
            </div>

            <div class="grid-item">
              <div class="grid-item-title">
                <span>Specular Map</span>
                <span class="grid-item-download" data-map="specular" title="Download Specular Map">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </span>
              </div>
              <div class="checkerboard">
                <canvas id="canvas-grid-specular"></canvas>
              </div>
            </div>

            <div class="grid-item">
              <div class="grid-item-title">
                <span>Roughness Map</span>
                <span
                  class="grid-item-download"
                  data-map="roughness"
                  title="Download Roughness Map"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </span>
              </div>
              <div class="checkerboard">
                <canvas id="canvas-grid-roughness"></canvas>
              </div>
            </div>

            <div class="grid-item">
              <div class="grid-item-title">
                <span>Ambient Occlusion</span>
                <span class="grid-item-download" data-map="ao" title="Download AO Map">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </span>
              </div>
              <div class="checkerboard">
                <canvas id="canvas-grid-ao"></canvas>
              </div>
            </div>

            <div class="grid-item">
              <div class="grid-item-title">
                <span>Edge Map</span>
                <span class="grid-item-download" data-map="edge" title="Download Edge Map">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </span>
              </div>
              <div class="checkerboard">
                <canvas id="canvas-grid-edge"></canvas>
              </div>
            </div>
          </div>

          <!-- Single Active Map Preview -->
          <div
            id="single-view-container"
            class="checkerboard tab-content-hidden"
          >
            <canvas id="canvas-main-preview"></canvas>
          </div>

          <!-- 3D Preview Container -->
          <div id="preview3d-container" class="preview3d tab-content-hidden">
            <div class="tool-tabs">
              <button class="tool-tab geom-btn active" data-geom="sphere">Sphere</button>
              <button class="tool-tab geom-btn" data-geom="cube">Cube</button>
              <button class="tool-tab geom-btn" data-geom="torus">Torus</button>
              <button class="tool-tab geom-btn" data-geom="plane">Plane</button>
            </div>
            <div class="preview3d-stage">
              <canvas id="SmallWorldMachinePreview" width="512" height="384"></canvas>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Load SmallWorldMachine 3D Preview Engine Entry -->`;
  container.appendChild(wrapper);
}
