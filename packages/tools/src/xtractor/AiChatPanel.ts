import type {
  AiConfig,
  AiProviderType,
  IVisionAiProvider,
  VisionAiMessage,
} from "../common/ai/index.js";
import {
  DEFAULT_AI_CONFIGS,
  providerRequiresApiKey,
  sortModelsDescending,
} from "../common/ai/index.js";
import { parseActionChips, type CanvasActionChip } from "../common/image/index.js";
import type { CommandHistory } from "../common/io/index.js";
import { renderChatMarkup } from "./chatMarkup.js";

const CUSTOM_MODEL_VALUE = "__custom__";

const PROVIDER_NAMES: Record<AiProviderType, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  claude: "Claude",
  ollama: "Ollama",
  custom: "Custom",
};

const SYSTEM_PROMPT = `You are the Small World Machine Vision AI Assistant for 2D/3D game art, texture extraction, sprite sheets, pixel art, and material authoring.
When analyzing images, recommend and emit deterministic action chips using square brackets so the user can apply them with 1 click:
- Background Removal & Chroma: '[REMBG]' or '[CHROMA_KEY: #hex, tolerance]'
- Trimming & Cropping: '[AUTOCROP]' (trim transparent padding), '[CROP: x, y, w, h]'
- Geometry & Transforms: '[FLIP_H]', '[FLIP_V]', '[ROTATE: 90|-90|180|270]', '[SCALE: 2x|4x|0.5x]', '[PAD_POT]' (power of 2)
- Color & Palette: '[RECOLOR: #fromHex -> #toHex]', '[POSTERIZE: 4]' (retro palette quantization), '[GRAYSCALE]', '[INVERT]', '[SEPIA]', '[AUTO_LEVELS]'
- Tone Adjustments: '[ADJUST: brightness=1.2, contrast=1.1, hue=45, saturation=1.2]'
- Game Art & Pixel Cleanup: '[OUTLINE: #000000, 1]' (add crisp pixel outline), '[DESPECKLE]' (remove orphan noise pixels)
- Sprite Slicing: '[AUTO_SPRITES]' (auto connected-component detection), '[SLICE: N]' (uniform N frame slice)
- 3D Texture Maps: '[NORMAL_MAP]' (tangent-space normal vectors), '[DEPTH_MAP]' (height/depth), '[EMISSIVE_MAP]' (glow mask), '[AO_MAP]' (ambient occlusion)

When colors or palettes are mentioned, output HEX values (e.g. #ff3366).
Keep answers concise, actionable, and formatted with clean markdown bullet points.`;

const PANEL_HTML = `
      <div class="swf-ix-chat-header">
        <div class="swf-ix-chat-title">
          <span>Vision AI Assistant</span>
          <span class="swf-ix-provider-badge" id="ai-badge">Gemini</span>
        </div>
        <button class="tool-btn" id="btn-toggle-ai-settings" title="KI Einstellungen (Provider & API Keys)" style="padding: 0.25rem 0.5rem; font-size: 0.85rem;">⚙️ Settings</button>
      </div>

      <div class="swf-ix-ai-settings" id="ai-settings-panel" style="display: none;">
        <div class="swf-ix-settings-row">
          <label>AI Provider</label>
          <select id="ai-provider-select" class="tool-input" style="padding: 4px 8px;">
            <option value="gemini">Google Gemini (Flash / Pro)</option>
            <option value="openai">OpenAI (GPT-4o, Mini)</option>
            <option value="claude">Anthropic Claude (Sonnet / Haiku)</option>
            <option value="ollama">Ollama (Lokal / llama3.2-vision)</option>
            <option value="custom">Custom Endpoint (OpenAI-compatible)</option>
          </select>
        </div>
        <div class="swf-ix-settings-row" id="ai-apikey-row">
          <label id="ai-apikey-label">API Key</label>
          <input type="password" id="ai-api-key" class="tool-input" placeholder="AIzaSy... oder sk-..." autocomplete="off" />
        </div>
        <div class="swf-ix-settings-row">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label>Modell</label>
            <button class="tool-btn" id="btn-fetch-models" title="Verfügbare Modelle von API abrufen" style="padding: 1px 6px; font-size: 0.75rem;">🔄 Modelle laden</button>
          </div>
          <select id="ai-model-select" class="tool-input" style="padding: 4px 8px;">
            <option value="${CUSTOM_MODEL_VALUE}">Manuelle Eingabe...</option>
          </select>
          <input type="text" id="ai-model-name" class="tool-input" style="display: none; margin-top: 4px;" placeholder="Modellname eingeben..." />
        </div>
        <div class="swf-ix-settings-row" id="ai-endpoint-row" style="display: none;">
          <label>Endpoint URL</label>
          <input type="text" id="ai-endpoint" class="tool-input" placeholder="http://localhost:11434/api/chat" />
        </div>
        <div style="display: flex; gap: 8px; margin-top: 4px; align-items: center;">
          <button class="tool-btn primary" id="btn-save-ai-settings" style="flex: 1; padding: 0.35rem 0.6rem;">Speichern & Testen</button>
          <button class="tool-btn" id="btn-close-ai-settings" style="padding: 0.35rem 0.6rem;">Schließen</button>
        </div>
        <div id="ai-settings-status" style="font-size: 0.78rem; display: none;"></div>
      </div>

      <div class="swf-ix-chat-history" id="chat-history">
        <div class="swf-ix-message msg-ai">
          Willkommen beim <strong>Xtractor Vision AI</strong>!<br/>
          Lade ein Bild hoch und ziehe bei Bedarf einen Auswahlrahmen auf. Du kannst mir freie Fragen zum Bild stellen (z.B. <em>"Welche Farbpalette passt zu diesem Sprite?"</em>, <em>"Schneide in 4 Segmente"</em> oder <em>"Schätze Roughness/Metallic für diese Textur"</em>).
        </div>
      </div>

      <div class="swf-ix-chat-input-area">
        <div class="tool-card swf-ix-context-pill" id="context-pill">
          <canvas id="crop-preview-canvas"></canvas>
          <div style="font-size: 0.8rem; color: var(--tool-text-muted);">Ausschnitt aktiv</div>
          <button class="tool-btn" style="padding: 0.2rem 0.5rem; margin-left: auto; margin-right: 5px;" id="btn-send-pixler">An Pixler</button>
          <button class="tool-btn" style="padding: 0.2rem 0.5rem;" id="btn-cancel-crop">✖</button>
        </div>
        <div class="swf-ix-chat-input-row">
          <textarea id="chat-input" class="tool-input" rows="1" style="flex:1; resize: none; font-family: inherit;" placeholder="Frage oder Befehl eingeben... (Shift+Enter = neue Zeile)"></textarea>
          <button class="tool-btn primary" id="btn-send">Senden</button>
        </div>
      </div>`;

export interface AiChatHost {
  /** Image (crop or downscaled canvas) to attach to a vision request; undefined if nothing is loaded. */
  getImagePayload(): string | undefined;
  applyActionChip(chip: CanvasActionChip): void;
}

export interface AiConfigStore {
  load(): AiConfig;
  save(config: AiConfig): void;
}

export interface AiChatPanelDeps {
  host: AiChatHost;
  configStore: AiConfigStore;
  createProvider: (config: AiConfig) => IVisionAiProvider;
  commandHistory: CommandHistory;
  /** Cancels a pending request when aborted (tool unmount). */
  signal: AbortSignal;
}

/** Vision-AI sidebar: provider settings, chat history, request lifecycle. */
export class AiChatPanel {
  private readonly _root: HTMLElement;
  private readonly _deps: AiChatPanelDeps;
  private _config: AiConfig;
  private readonly _conversation: VisionAiMessage[] = [];
  private _pending: AbortController | null = null;

  private readonly _badge: HTMLElement;
  private readonly _settingsPanel: HTMLElement;
  private readonly _providerSelect: HTMLSelectElement;
  private readonly _apiKey: HTMLInputElement;
  private readonly _apiKeyRow: HTMLElement;
  private readonly _modelSelect: HTMLSelectElement;
  private readonly _modelName: HTMLInputElement;
  private readonly _fetchModelsButton: HTMLElement;
  private readonly _endpoint: HTMLInputElement;
  private readonly _endpointRow: HTMLElement;
  private readonly _settingsStatus: HTMLElement;
  private readonly _history: HTMLElement;
  private readonly _input: HTMLTextAreaElement;
  private readonly _sendButton: HTMLButtonElement;

  constructor(root: HTMLElement, deps: AiChatPanelDeps) {
    this._root = root;
    this._deps = deps;
    root.innerHTML = PANEL_HTML;

    this._badge = this._query("#ai-badge");
    this._settingsPanel = this._query("#ai-settings-panel");
    this._providerSelect = this._query("#ai-provider-select");
    this._apiKey = this._query("#ai-api-key");
    this._apiKeyRow = this._query("#ai-apikey-row");
    this._modelSelect = this._query("#ai-model-select");
    this._modelName = this._query("#ai-model-name");
    this._fetchModelsButton = this._query("#btn-fetch-models");
    this._endpoint = this._query("#ai-endpoint");
    this._endpointRow = this._query("#ai-endpoint-row");
    this._settingsStatus = this._query("#ai-settings-status");
    this._history = this._query("#chat-history");
    this._input = this._query("#chat-input");
    this._sendButton = this._query("#btn-send");

    this._config = deps.configStore.load();
    deps.commandHistory.bindInput(this._input);
    this._bindSettings();
    this._bindChat();
    this._syncSettingsUi(this._config);
  }

  /** Appends a message; text is escaped and rendered with the chat markup subset. */
  public addMessage(text: string, type: "user" | "ai"): HTMLElement {
    const msg = document.createElement("div");
    msg.className = `swf-ix-message msg-${type}`;
    msg.innerHTML = renderChatMarkup(text);
    this._appendToHistory(msg);
    return msg;
  }

  /** Attaches rich content (galleries, previews) to the newest message. */
  public attachToLastMessage(content: HTMLElement): void {
    this._history.lastElementChild!.appendChild(content);
    this._history.scrollTop = this._history.scrollHeight;
  }

  private _query<T extends HTMLElement>(selector: string): T {
    return this._root.querySelector<T>(selector)!;
  }

  private _appendToHistory(msg: HTMLElement): void {
    this._history.appendChild(msg);
    this._history.scrollTop = this._history.scrollHeight;
  }

  private _openSettings(): void {
    this._settingsPanel.style.display = "flex";
  }

  private _readFormConfig(): AiConfig {
    const modelFromList =
      this._modelSelect.value === CUSTOM_MODEL_VALUE
        ? this._modelName.value.trim()
        : this._modelSelect.value || this._modelName.value.trim();
    return {
      provider: this._providerSelect.value as AiProviderType,
      apiKey: this._apiKey.value.trim(),
      model: modelFromList,
      endpoint: this._endpoint.value.trim() || undefined,
    };
  }

  private _bindSettings(): void {
    this._modelSelect.addEventListener("change", () => {
      if (this._modelSelect.value === CUSTOM_MODEL_VALUE) {
        this._modelName.style.display = "block";
        this._modelName.focus();
      } else {
        this._modelName.style.display = "none";
        this._modelName.value = this._modelSelect.value;
      }
    });

    this._fetchModelsButton.addEventListener("click", () => {
      void this._refreshModels({ ...this._readFormConfig(), model: this._modelName.value.trim() });
    });

    this._providerSelect.addEventListener("change", () => {
      const selected = this._providerSelect.value as AiProviderType;
      const defaults = DEFAULT_AI_CONFIGS[selected];
      this._modelName.value = defaults.model;
      this._endpoint.value = defaults.endpoint || "";
      this._applyFieldVisibility(selected);
      void this._refreshModels({
        provider: selected,
        apiKey: this._apiKey.value.trim(),
        model: defaults.model,
        endpoint: this._endpoint.value.trim() || undefined,
      });
    });

    this._query("#btn-toggle-ai-settings").addEventListener("click", () => {
      const isVisible = this._settingsPanel.style.display !== "none";
      this._settingsPanel.style.display = isVisible ? "none" : "flex";
      this._settingsStatus.style.display = "none";
    });

    this._query("#btn-close-ai-settings").addEventListener("click", () => {
      this._settingsPanel.style.display = "none";
      this._settingsStatus.style.display = "none";
    });

    this._query("#btn-save-ai-settings").addEventListener("click", () => void this._saveSettings());
  }

  private async _saveSettings(): Promise<void> {
    this._settingsStatus.style.display = "block";
    this._settingsStatus.style.color = "var(--tool-text-muted)";
    this._settingsStatus.innerText = "⏳ Verbindung wird getestet...";

    const newConfig = this._readFormConfig();
    try {
      await this._deps.createProvider(newConfig).testConnection();
      this._config = newConfig;
      this._deps.configStore.save(newConfig);
      this._syncSettingsUi(newConfig);
      this._settingsStatus.style.color = "#4ade80";
      this._settingsStatus.innerText = "✓ Verbindung erfolgreich! Gespeichert.";
      setTimeout(() => {
        this._settingsPanel.style.display = "none";
      }, 1200);
    } catch (err) {
      this._settingsStatus.style.color = "#f87171";
      this._settingsStatus.innerText = `Fehler: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private _applyFieldVisibility(provider: AiProviderType): void {
    this._apiKeyRow.style.display = "ollama" === provider ? "none" : "flex";
    this._endpointRow.style.display =
      "ollama" === provider || "custom" === provider ? "flex" : "none";
  }

  private _syncSettingsUi(cfg: AiConfig): void {
    const modelShort = cfg.model ? ` (${cfg.model.split("/").pop()})` : "";
    this._badge.innerText = `${PROVIDER_NAMES[cfg.provider]}${modelShort}`;

    this._providerSelect.value = cfg.provider;
    this._apiKey.value = cfg.apiKey || "";
    this._modelName.value = cfg.model || "";
    this._endpoint.value = cfg.endpoint || "";
    this._applyFieldVisibility(cfg.provider);
    void this._refreshModels(cfg);
  }

  private async _refreshModels(cfg: AiConfig): Promise<void> {
    this._fetchModelsButton.innerText = "⏳...";
    try {
      const provider = this._deps.createProvider(cfg);
      if (provider.listModels) {
        this._populateModels(await provider.listModels(), cfg.model);
      }
    } catch {
      // Keep the current list; the manual entry stays available
    } finally {
      this._fetchModelsButton.innerText = "🔄 Modelle laden";
    }
  }

  private _populateModels(models: string[], selectedModel: string): void {
    this._modelSelect.innerHTML = "";
    let found = false;
    for (const m of sortModelsDescending(models)) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.innerText = m;
      if (m === selectedModel) {
        opt.selected = true;
        found = true;
      }
      this._modelSelect.appendChild(opt);
    }
    const customOpt = document.createElement("option");
    customOpt.value = CUSTOM_MODEL_VALUE;
    customOpt.innerText = "Manuelle Eingabe...";
    const needsManualEntry = !found && "" !== selectedModel;
    customOpt.selected = needsManualEntry;
    this._modelName.style.display = needsManualEntry ? "block" : "none";
    this._modelSelect.appendChild(customOpt);
  }

  private _bindChat(): void {
    this._sendButton.addEventListener("click", () => void this._send());

    this._input.addEventListener("keydown", (e: KeyboardEvent) => {
      if ("Escape" === e.key && null !== this._pending) {
        this._pending.abort();
        return;
      }
      if ("Enter" === e.key && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void this._send();
      }
    });
  }

  private async _send(): Promise<void> {
    const text = this._input.value.trim();
    if ("" === text || null !== this._pending) return;

    this._deps.commandHistory.push(text);
    this.addMessage(text, "user");
    this._input.value = "";

    const directChips = parseActionChips(text);
    if (directChips.length > 0) {
      for (const chip of directChips) {
        this._deps.host.applyActionChip(chip);
      }
      return;
    }

    const hasKey = !!this._config.apiKey?.trim() || !providerRequiresApiKey(this._config.provider);
    if (!hasKey) {
      this._showMissingProviderHint();
      return;
    }

    await this._requestAi(text);
  }

  private async _requestAi(text: string): Promise<void> {
    const thinking = document.createElement("div");
    thinking.className = "swf-ix-message msg-ai swf-ix-thinking";
    thinking.innerHTML = `<span class="swf-ix-spinner"></span> <span>Vision AI analysiert...</span>`;
    this._appendToHistory(thinking);

    const userMessage: VisionAiMessage = {
      role: "user",
      content: text,
      imageBase64: this._deps.host.getImagePayload(),
    };
    this._conversation.push(userMessage);

    const controller = new AbortController();
    this._pending = controller;
    this._sendButton.disabled = true;
    const abortOnUnmount = (): void => controller.abort();
    this._deps.signal.addEventListener("abort", abortOnUnmount);

    try {
      const response = await this._deps.createProvider(this._config).sendMessage({
        messages: this._conversation,
        systemInstruction: SYSTEM_PROMPT,
        signal: controller.signal,
      });
      this._conversation.push({ role: "assistant", content: response.text });
      this._appendToHistory(this._buildAiResponse(response.text));
    } catch (err) {
      this._conversation.splice(this._conversation.indexOf(userMessage), 1);
      this._appendToHistory(this._buildFailureMessage(err, controller.signal.aborted));
    } finally {
      thinking.remove();
      this._deps.signal.removeEventListener("abort", abortOnUnmount);
      this._pending = null;
      this._sendButton.disabled = false;
    }
  }

  private _showMissingProviderHint(): void {
    const msg = document.createElement("div");
    msg.className = "swf-ix-message msg-ai";
    msg.innerHTML = `
      <strong>Noch kein KI-Provider eingerichtet.</strong><br/>
      Um die echte Multimodal-Vision-KI zu nutzen (Gemini, OpenAI, Claude oder lokales Ollama), trage bitte deinen API-Key in den Einstellungen ein.<br/>
      <button class="tool-btn primary" style="margin-top: 8px; font-size: 0.82rem; padding: 4px 8px;">⚙️ Jetzt Provider konfigurieren</button>
    `;
    msg.querySelector("button")!.addEventListener("click", () => this._openSettings());
    this._appendToHistory(msg);
  }

  private _buildFailureMessage(err: unknown, cancelled: boolean): HTMLElement {
    const msg = document.createElement("div");
    msg.className = "swf-ix-message msg-ai";
    if (cancelled) {
      msg.textContent = "Anfrage abgebrochen.";
      return msg;
    }

    msg.style.borderColor = "#f87171";
    const title = document.createElement("strong");
    title.textContent = "⚠️ KI-Fehler:";
    const detail = document.createTextNode(` ${err instanceof Error ? err.message : String(err)}`);
    const button = document.createElement("button");
    button.className = "tool-btn";
    button.style.cssText = "margin-top:6px;font-size:0.8rem;display:block;";
    button.textContent = "⚙️ Einstellungen überprüfen";
    button.addEventListener("click", () => this._openSettings());
    msg.append(title, detail, button);
    return msg;
  }

  private _buildAiResponse(rawText: string): HTMLElement {
    const msg = document.createElement("div");
    msg.className = "swf-ix-message msg-ai";
    msg.innerHTML = renderChatMarkup(rawText);

    const uniqueColors = Array.from(new Set(rawText.match(/#[0-9a-fA-F]{6}\b/g) ?? []));
    if (uniqueColors.length > 0) {
      const chipContainer = document.createElement("div");
      chipContainer.className = "swf-ix-chip-container";
      for (const hex of uniqueColors) {
        const chip = document.createElement("span");
        chip.className = "swf-ix-color-chip";
        const swatch = document.createElement("span");
        swatch.className = "swf-ix-color-swatch";
        swatch.style.background = hex;
        chip.append(swatch, hex);
        chipContainer.appendChild(chip);
      }
      msg.appendChild(chipContainer);
    }

    const chips = parseActionChips(rawText);
    if (chips.length > 0) {
      msg.appendChild(this._buildActionChips(chips));
    }
    return msg;
  }

  private _buildActionChips(chips: CanvasActionChip[]): HTMLElement {
    const container = document.createElement("div");
    container.className = "swf-ix-chip-container";

    for (const chip of chips) {
      const button = document.createElement("button");
      button.className = "swf-ix-action-chip";
      button.textContent = `${chip.icon} ${chip.label}`;
      button.addEventListener("click", () => this._deps.host.applyActionChip(chip));
      container.appendChild(button);
    }

    if (chips.length > 1) {
      const all = document.createElement("button");
      all.className = "swf-ix-action-chip";
      all.style.background = "var(--tool-accent, #3b82f6)";
      all.style.color = "#ffffff";
      all.style.fontWeight = "600";
      all.textContent = "⚡ Alle Aktionen anwenden";
      all.addEventListener("click", () => {
        for (const chip of chips) {
          this._deps.host.applyActionChip(chip);
        }
      });
      container.appendChild(all);
    }
    return container;
  }
}
