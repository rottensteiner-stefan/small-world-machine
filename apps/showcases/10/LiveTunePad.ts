import { StylizedWaterMaterial } from "@small-world-machine/engine";

export type StylizedWaterTunableKey =
  | "rampSoftness"
  | "washAmount"
  | "lineDensity"
  | "lineWidth"
  | "foamSoftness"
  | "skyTint"
  | "glitterStrength"
  | "causticStrength"
  | "specularStrength";

export interface TuneParameter {
  readonly key: StylizedWaterTunableKey;
  readonly label: string;
  readonly step: number;
  readonly min: number;
  readonly max: number;
  readonly precision: number;
}

export const DEFAULT_TUNE_PARAMETERS: readonly TuneParameter[] = [
  { key: "rampSoftness", label: "Ramp Softness", step: 0.05, min: 0.0, max: 1.0, precision: 2 },
  { key: "washAmount", label: "Wash Amount", step: 0.05, min: 0.0, max: 1.0, precision: 2 },
  { key: "lineDensity", label: "Line Density", step: 0.05, min: 0.0, max: 5.0, precision: 2 },
  { key: "lineWidth", label: "Line Width", step: 0.02, min: 0.0, max: 1.0, precision: 2 },
  { key: "foamSoftness", label: "Foam Softness", step: 0.01, min: 0.0, max: 1.0, precision: 3 },
  { key: "skyTint", label: "Sky Tint", step: 0.05, min: 0.0, max: 1.0, precision: 2 },
  {
    key: "glitterStrength",
    label: "Glitter Strength",
    step: 0.05,
    min: 0.0,
    max: 5.0,
    precision: 2,
  },
  {
    key: "causticStrength",
    label: "Caustic Strength",
    step: 0.05,
    min: 0.0,
    max: 5.0,
    precision: 2,
  },
  {
    key: "specularStrength",
    label: "Specular Strength",
    step: 0.05,
    min: 0.0,
    max: 5.0,
    precision: 2,
  },
];

export interface LiveTunePadOptions {
  parameters?: readonly TuneParameter[];
  onParameterChange?: (param: TuneParameter, value: number) => void;
  logger?: (message: string, ...args: unknown[]) => void;
}

/**
 * Lightweight showcase debug controller for a StylizedWaterMaterial instance.
 * Provides keyboard-driven real-time parameter tweaking, clamping, reset baselines, and console logging.
 */
export class LiveTunePad {
  public readonly material: StylizedWaterMaterial;
  public readonly parameters: readonly TuneParameter[];

  private _selectedIndex = 0;
  private readonly _initialBaselines: Map<StylizedWaterTunableKey, number> = new Map();
  private readonly _onParameterChange?: ((param: TuneParameter, value: number) => void) | undefined;
  private readonly _logger: (message: string, ...args: unknown[]) => void;
  private _attachedTarget: EventTarget | null = null;
  private readonly _boundKeyHandler: (event: Event) => void;

  constructor(material: StylizedWaterMaterial, options: LiveTunePadOptions = {}) {
    this.material = material;
    this.parameters = options.parameters ?? DEFAULT_TUNE_PARAMETERS;
    this._onParameterChange = options.onParameterChange;
    this._logger = options.logger ?? console.log;

    // Snapshot initial values as baseline for reset
    for (const param of this.parameters) {
      this._initialBaselines.set(param.key, this._getMaterialValue(param.key));
    }

    this._boundKeyHandler = (event: Event): void => {
      if (typeof event === "object" && event !== null && "key" in event) {
        this.handleKeyDown(event as unknown as KeyboardEvent);
      }
    };
  }

  public get selectedIndex(): number {
    return this._selectedIndex;
  }

  public get currentParam(): TuneParameter {
    return this.parameters[this._selectedIndex]!;
  }

  public get currentValue(): number {
    return this._getMaterialValue(this.currentParam.key);
  }

  public selectNext(): TuneParameter {
    if (this.parameters.length === 0) return this.currentParam;
    this._selectedIndex = (this._selectedIndex + 1) % this.parameters.length;
    const param = this.currentParam;
    this._notifyParamSelected(param);
    return param;
  }

  public selectPrevious(): TuneParameter {
    if (this.parameters.length === 0) return this.currentParam;
    this._selectedIndex =
      (this._selectedIndex - 1 + this.parameters.length) % this.parameters.length;
    const param = this.currentParam;
    this._notifyParamSelected(param);
    return param;
  }

  public selectParameter(keyOrIndex: StylizedWaterTunableKey | number): boolean {
    if (typeof keyOrIndex === "number") {
      if (keyOrIndex >= 0 && keyOrIndex < this.parameters.length) {
        this._selectedIndex = keyOrIndex;
        this._notifyParamSelected(this.currentParam);
        return true;
      }
      return false;
    }
    const idx = this.parameters.findIndex((p) => p.key === keyOrIndex);
    if (idx >= 0) {
      this._selectedIndex = idx;
      this._notifyParamSelected(this.currentParam);
      return true;
    }
    return false;
  }

  public increase(stepMultiplier = 1): number {
    const param = this.currentParam;
    const current = this._getMaterialValue(param.key);
    const updated = this._roundToPrecision(
      Math.min(param.max, current + param.step * stepMultiplier),
      param.precision,
    );
    this._setMaterialValue(param.key, updated);
    this._notifyChange(param, updated);
    return updated;
  }

  public decrease(stepMultiplier = 1): number {
    const param = this.currentParam;
    const current = this._getMaterialValue(param.key);
    const updated = this._roundToPrecision(
      Math.max(param.min, current - param.step * stepMultiplier),
      param.precision,
    );
    this._setMaterialValue(param.key, updated);
    this._notifyChange(param, updated);
    return updated;
  }

  public resetCurrent(): number {
    const param = this.currentParam;
    const baseline = this._initialBaselines.get(param.key) ?? 0.0;
    this._setMaterialValue(param.key, baseline);
    this._notifyChange(param, baseline);
    return baseline;
  }

  public resetAll(): void {
    for (const param of this.parameters) {
      const baseline = this._initialBaselines.get(param.key) ?? 0.0;
      this._setMaterialValue(param.key, baseline);
      this._notifyChange(param, baseline);
    }
    this._logger("[LiveTunePad] All parameters reset to baseline.");
  }

  public getVector(): Record<StylizedWaterTunableKey, number> {
    const vector: Partial<Record<StylizedWaterTunableKey, number>> = {};
    for (const param of this.parameters) {
      vector[param.key] = this._getMaterialValue(param.key);
    }
    return vector as Record<StylizedWaterTunableKey, number>;
  }

  public logCurrentVector(): Record<StylizedWaterTunableKey, number> {
    const vector = this.getVector();
    this._logger("[LiveTunePad] Current Vector:", JSON.stringify(vector, null, 2));
    return vector;
  }

  public handleKeyDown(event: {
    key: string;
    shiftKey?: boolean;
    code?: string;
    preventDefault?: () => void;
  }): boolean {
    const key = event.key;
    const shiftKey = Boolean(event.shiftKey);
    const code = event.code;

    if (key === "[" || code === "BracketLeft") {
      this.selectPrevious();
      event.preventDefault?.();
      return true;
    }

    if (key === "]" || code === "BracketRight") {
      this.selectNext();
      event.preventDefault?.();
      return true;
    }

    if (key === "ArrowUp") {
      this.increase();
      event.preventDefault?.();
      return true;
    }

    if (key === "ArrowDown") {
      this.decrease();
      event.preventDefault?.();
      return true;
    }

    // Shift+0 -> reset all
    if ((shiftKey && (key === "0" || code === "Digit0" || code === "Numpad0")) || key === ")") {
      this.resetAll();
      event.preventDefault?.();
      return true;
    }

    // 0 without shift -> reset current
    if (!shiftKey && (key === "0" || code === "Digit0" || code === "Numpad0")) {
      this.resetCurrent();
      event.preventDefault?.();
      return true;
    }

    if (key === "g" || key === "G") {
      this.logCurrentVector();
      event.preventDefault?.();
      return true;
    }

    return false;
  }

  public attach(target: EventTarget = window): void {
    if (this._attachedTarget) {
      this.detach();
    }
    this._attachedTarget = target;
    target.addEventListener("keydown", this._boundKeyHandler);
  }

  public detach(): void {
    if (this._attachedTarget) {
      this._attachedTarget.removeEventListener("keydown", this._boundKeyHandler);
      this._attachedTarget = null;
    }
  }

  private _getMaterialValue(key: StylizedWaterTunableKey): number {
    const val = this.material[key];
    return typeof val === "number" ? val : 0.0;
  }

  private _setMaterialValue(key: StylizedWaterTunableKey, value: number): void {
    this.material[key] = value;
  }

  private _roundToPrecision(value: number, precision: number): number {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  }

  private _notifyParamSelected(param: TuneParameter): void {
    const val = this._getMaterialValue(param.key);
    this._logger(`[LiveTunePad] Selected [${param.label}]: ${val.toFixed(param.precision)}`);
  }

  private _notifyChange(param: TuneParameter, value: number): void {
    this._logger(`[LiveTunePad] ${param.label} = ${value.toFixed(param.precision)}`);
    if (this._onParameterChange) {
      this._onParameterChange(param, value);
    }
  }
}
