/**
 * ContentPackage — stable text-ID lookup for a the-whisper content package (ADR 0041 Stufe 4).
 *
 * Story/UI texts live as `content/<lang>.json` under stable text IDs; code references IDs,
 * never content strings. Every language pack of an app carries the SAME ID set — enforced by
 * `ContentPackageValidation.test.ts` (mutual key check). This class is the app-level, honest
 * resolver: it loads a package and answers `t(id)` with fail-fast on unknown or missing texts.
 *
 * NOTE (Stufe 4 runtime wiring): wired consumers resolve their chrome through this resolver
 * (UI-chrome in `HotspotManager`/`TerminalModal`, kältekammer hotspots + objectives in
 * `prologue.ts`). Remaining follow-up: `ViennaMapModal` render call sites, `level.json`
 * hotspot texts and `TerminalModal` case data still author strings in code.
 */
export interface ContentPackageData {
  readonly id: string;
  readonly language: string;
  readonly version: string;
  readonly texts: Readonly<Record<string, string>>;
}

export class ContentPackage {
  private constructor(
    private readonly _data: ContentPackageData,
    private readonly _index: ReadonlyMap<string, string>,
  ) {}

  public static fromJSON(data: ContentPackageData): ContentPackage {
    if (!data || typeof data !== "object") {
      throw new Error("[ContentPackage] invalid content package: expected an object");
    }
    if (typeof data.id !== "string" || typeof data.language !== "string") {
      throw new Error("[ContentPackage] invalid content package: id and language are required");
    }
    const index = new Map<string, string>();
    for (const [id, value] of Object.entries(data.texts ?? {})) {
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`[ContentPackage] text id '${id}' must map to a non-empty string`);
      }
      index.set(id, value);
    }
    return new ContentPackage(data, index);
  }

  /**
   * Loads the requested language package from `content/<lang>.json` next to this module.
   * Fail-fast: an undeclared/unknown language is a hard error, never a silent empty UI.
   */
  public static async load(language: string): Promise<ContentPackage> {
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(language)) {
      throw new Error(`[ContentPackage] invalid language code '${language}'`);
    }
    const response = await fetch(new URL(`./${language}.json`, import.meta.url), {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        `[ContentPackage] content/${language}.json not loadable (HTTP ${response.status})`,
      );
    }
    const data = (await response.json()) as ContentPackageData;
    return ContentPackage.fromJSON(data);
  }

  public get language(): string {
    return this._data.language;
  }

  /** Resolves a stable text ID. Fail-fast on unknown IDs (typos surface immediately). */
  public t(id: string): string {
    const value = this._index.get(id);
    if (value === undefined) {
      throw new Error(
        `[ContentPackage] unknown text id '${id}' in language '${this._data.language}'`,
      );
    }
    return value;
  }

  public has(id: string): boolean {
    return this._index.has(id);
  }
}
