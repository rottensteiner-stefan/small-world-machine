import { AbstractLoader } from "./AbstractLoader.js";
import { EventType } from "../enums/index.js";
import type { LoaderOptions } from "../interfaces/index.js";

/**
 * Loader for text assets.
 */
export class TextLoader extends AbstractLoader<string> {
  /**
   * Creates a new TextLoader.
   * @param options Optional configuration options.
   */
  constructor(options: LoaderOptions = {}) {
    super(options);
  }

  /** @inheritdoc */
  public override async load(url: string): Promise<string> {
    const fullUrl: string = this.basePath + url;
    this.dispatchEvent(EventType.LOADER_START, { url: fullUrl });

    try {
      const text: string = await this._assetManager.loadText(
        fullUrl,
        (loaded: number, total: number) => {
          this.dispatchEvent(EventType.LOADER_PROGRESS, { url: fullUrl, loaded, total });
        },
      );

      this.dispatchEvent(EventType.LOADER_END, { url: fullUrl, data: text });
      return text;
    } catch (error: unknown) {
      this.dispatchEvent(EventType.LOADER_ERROR, { url: fullUrl, error });
      throw error;
    }
  }
}
