import { EventDispatcherImpl } from "../core/events/index.js";
import type { Events, EventHandler, LoaderOptions } from "../interfaces/index.js";
import type { EventType } from "../enums/index.js";
import { AssetManager } from "./AssetManager.js";

/**
 * Abstract base class for all resource loaders.
 * @template T The type of resource returned by the loader.
 */
export abstract class AbstractLoader<T> implements Events {
  /** The base path for resource URLs. */
  public basePath: string = "";
  private _dispatcher: EventDispatcherImpl = new EventDispatcherImpl();
  /**
   * The `AssetManager` this loader fetches/caches resources through. Private per instance unless
   * `options.assetManager` was passed -- never the deprecated process-wide singleton.
   */
  protected _assetManager: AssetManager;

  /**
   * Creates a new AbstractLoader.
   * @param options Optional configuration options.
   */
  constructor(options: LoaderOptions = {}) {
    this.basePath = options.basePath ?? "";
    this._assetManager = options.assetManager ?? new AssetManager();
  }

  /**
   * Sets the base path for the loader.
   * @param path The base path string.
   * @returns this
   */
  public setBasePath(path: string): this {
    this.basePath = path;
    return this;
  }

  /** @inheritdoc */
  public addEventListener(type: string | EventType, listener: EventHandler): void {
    this._dispatcher.addEventListener(type, listener);
  }

  /** @inheritdoc */
  public removeEventListener(type: string | EventType, listener: EventHandler): void {
    this._dispatcher.removeEventListener(type, listener);
  }

  /** @inheritdoc */
  public dispatchEvent(type: string | EventType, eventData: Record<string, unknown> = {}): void {
    this._dispatcher.dispatchEvent(type, eventData);
  }

  /**
   * Loads a resource from the given URL.
   * @param url The relative URL to the resource.
   * @returns A promise resolving to the loaded resource.
   */
  public abstract load(url: string): Promise<T>;

  /**
   * Derives the folder path (everything up to and including the last `/`)
   * from a URL, so sibling resources (materials, textures, buffers) can be
   * resolved relative to it.
   * @param url The URL to derive the folder path from.
   * @returns The folder path, including a trailing slash.
   */
  protected static getFolderPath(url: string): string {
    return url.substring(0, url.lastIndexOf("/") + 1);
  }
}
