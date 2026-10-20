export type ProgressCallback = (loaded: number, total: number) => void;

/**
 * Interface for tracking the progress of an individual asset.
 */
interface AssetProgress {
  loaded: number;
  total: number;
}

/**
 * Per-instance manager for loading and caching assets (images, text, etc.). Construct one per
 * engine instance (see `RendererContext.assetManager`) so its cache can be released with the
 * engine instead of living for the process's lifetime.
 */
export class AssetManager {
  private _imageCache = new Map<string, Promise<ImageBitmap | HTMLImageElement>>();
  private _textCache = new Map<string, Promise<string>>();
  private _jsonCache = new Map<string, Promise<unknown>>();
  private _binaryCache = new Map<string, Promise<ArrayBuffer>>();

  private _activeLoaders = new Map<string, AssetProgress>();
  private _onLoadedPromise: Promise<void> | undefined = undefined;
  private _resolveLoaded: (() => void) | undefined = undefined;

  private _baseUrl: string = "";
  private _headers: Record<string, string> = {};

  /**
   * Optional custom fetch implementation (e.g. for virtual tool I/O schemes like sw-asset:// or ZIP sources).
   * When undefined, global fetch is used.
   */
  public customFetch?: ((url: string, init?: RequestInit) => Promise<Response>) | undefined;

  /**
   * Sets a base URL that will be prepended to all relative asset paths.
   * @param url The base URL (e.g. "https://cdn.example.com/assets/").
   */
  public setBaseUrl(url: string): void {
    this._baseUrl = url;
    if (this._baseUrl && !this._baseUrl.endsWith("/")) {
      this._baseUrl += "/";
    }
  }

  /**
   * Sets a custom header to be sent with every asset request.
   * @param key The header name (e.g. "Authorization").
   * @param value The header value.
   */
  public setHeader(key: string, value: string): void {
    this._headers[key] = value;
  }

  /**
   * Returns a promise that resolves when all currently active loading processes are finished.
   */
  public async onLoaded(): Promise<void> {
    if (0 === this._activeLoaders.size) {
      return Promise.resolve();
    }
    if (!this._onLoadedPromise) {
      this._onLoadedPromise = new Promise<void>((resolve) => {
        this._resolveLoaded = resolve;
      });
    }
    return this._onLoadedPromise;
  }

  /**
   * Checks if all assets are currently loaded.
   */
  public get isLoaded(): boolean {
    return 0 === this._activeLoaders.size;
  }

  /**
   * Returns the global loading progress (0.0 to 1.0).
   */
  public getGlobalProgress(): number {
    if (0 === this._activeLoaders.size) return 1.0;

    let loaded = 0;
    let total = 0;

    for (const progress of this._activeLoaders.values()) {
      loaded += progress.loaded;
      total += progress.total;
    }

    return 0 < total ? loaded / total : 0;
  }

  /**
   * Resolves a relative or root-relative URL against the configured base URL or Vite base path.
   * @param url The asset URL to resolve.
   */
  public resolveUrl(url: string): string {
    const isAbsolute =
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("//") ||
      url.startsWith("blob:") ||
      url.startsWith("data:") ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url);
    if (isAbsolute) return url;

    const base =
      this._baseUrl ||
      (typeof import.meta !== "undefined" &&
        (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
      "";
    if (base && base !== "./") {
      if (url.startsWith("/")) {
        return base.endsWith("/") ? base + url.substring(1) : base + "/" + url.substring(1);
      } else if (!url.startsWith("./") && !url.startsWith("../")) {
        return base.endsWith("/") ? base + url : base + "/" + url;
      }
    }
    return url;
  }

  /**
   * @param trackingKey Key under which this request's progress is tracked in `_activeLoaders`.
   *   Callers that cache by something other than the raw `url` (e.g. `loadImage`'s
   *   `${url}_${flipY}`) must pass that same key here -- otherwise two concurrent, distinctly
   *   cached requests for the same `url` (different flipY, or an image vs. a binary load of the
   *   same asset) would collide on one `_activeLoaders` entry: they'd overwrite each other's
   *   progress, and whichever finishes first would delete the entry via `_checkCompletion` while
   *   the other is still in flight, making `onLoaded()`/`isLoaded` report done too early.
   */
  private async _fetchWithProgress(
    url: string,
    trackingKey: string,
    onProgress?: ProgressCallback,
  ): Promise<Blob> {
    const finalUrl = this.resolveUrl(url);

    // Guarantee the progress-tracking entry is always released -- success, HTTP error, or a
    // mid-stream failure after `_activeLoaders.set` below. Previously each loader re-implemented
    // this cleanup in its own `.catch()`, which leaked an entry (and thus hung `onLoaded()`) if
    // any copy forgot it; the invariant now lives in exactly one place.
    try {
      const fetchFn = this.customFetch ?? fetch;
      const response: Response = await fetchFn(finalUrl, {
        headers: this._headers,
      });

      if (!response.ok) {
        throw new Error(`[AssetManager] HTTP error: ${response.status} at ${finalUrl}`);
      }

      const contentLength: string | undefined = response.headers.get("content-length") ?? undefined;
      const total: number = contentLength ? parseInt(contentLength, 10) : 0;

      this._activeLoaders.set(trackingKey, { loaded: 0, total });

      const updateProgress = (loaded: number, total: number): void => {
        this._activeLoaders.set(trackingKey, { loaded, total });
        if (onProgress) onProgress(loaded, total);
      };

      if (!onProgress || !response.body) {
        const blob = await response.blob();
        updateProgress(blob.size, blob.size);
        return blob;
      }

      const reader = response.body.getReader();
      let loaded: number = 0;
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          loaded += value.length;
          chunks.push(value);
          updateProgress(loaded, total);
        }
      }

      return new Blob(chunks as BlobPart[]);
    } finally {
      this._checkCompletion(trackingKey);
    }
  }

  private _checkCompletion(url: string): void {
    this._activeLoaders.delete(url);
    if (0 === this._activeLoaders.size && this._resolveLoaded) {
      this._resolveLoaded();
      this._onLoadedPromise = undefined;
      this._resolveLoaded = undefined;
    }
  }

  /**
   * Single caching primitive used by every asset loader. Returns the in-flight promise for `key`
   * if one exists, otherwise starts `loader`, stores its promise in `cache`, and -- critically --
   * evicts the entry again if the load rejects. This is what prevents cache poisoning: without
   * it, a rejected promise would stay cached forever and the next request for the same asset
   * would re-return the stale rejection instead of issuing a fresh load. HW: no caller may
   * implement its own `.catch(){ cache.delete(key) }`; route every cached load through here so
   * the invariant is enforced in exactly one place.
   */
  private _cacheOrStart<T>(
    cache: Map<string, Promise<T>>,
    key: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    const existing = cache.get(key);
    if (existing) return existing;
    const promise = loader().catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, promise);
    return promise;
  }

  /**
   * Fetches an image via fetch+Blob and decodes it via createImageBitmap.
   * `flipY` defaults to `true` ("Human Convention First" - top of image maps to top of 3D geometry).
   * glTF models and cubemaps explicitly pass `false`.
   */
  public async loadImage(
    url: string,
    onProgress?: ProgressCallback,
    flipY: boolean = true,
  ): Promise<ImageBitmap | HTMLImageElement> {
    const cacheKey: string = `${url}_${flipY}`;
    // The fallback (HTMLImageElement) lives INSIDE the cached promise: a successful fallback is
    // cached like any other result, and only a total failure rejects -- which is exactly when
    // `_cacheOrStart` evicts the entry so a later request reloads instead of seeing a stale error.
    return this._cacheOrStart(this._imageCache, cacheKey, async () => {
      try {
        const blob = await this._fetchWithProgress(url, cacheKey, onProgress);

        if (flipY) {
          return await createImageBitmap(blob, {
            colorSpaceConversion: "none",
            imageOrientation: "flipY",
          });
        }
        try {
          return await createImageBitmap(blob, {
            colorSpaceConversion: "none",
            imageOrientation: "from-image" as ImageOrientation,
          });
        } catch {
          return await createImageBitmap(blob, {
            colorSpaceConversion: "none",
            imageOrientation: "none",
          });
        }
      } catch (e: unknown) {
        // Fall back to a plain HTMLImageElement (e.g. when createImageBitmap is unavailable).
        console.error(e);
        return new Promise<HTMLImageElement>((resolve, reject) => {
          this._fetchWithProgress(url, `${cacheKey}_fallback`, onProgress)
            .then((blob) => {
              const objectUrl = URL.createObjectURL(blob);
              const img: HTMLImageElement = new Image();
              img.crossOrigin = "anonymous";
              img.src = objectUrl;
              img.onload = (): void => {
                URL.revokeObjectURL(objectUrl);
                resolve(img);
              };
              img.onerror = (): void => {
                URL.revokeObjectURL(objectUrl);
                reject(`[AssetManager] Fallback failed: ${url}`);
              };
            })
            .catch(() => {
              const img: HTMLImageElement = new Image();
              img.crossOrigin = "anonymous";
              img.src = this.resolveUrl(url);
              img.onload = (): void => resolve(img);
              img.onerror = (): void => {
                reject(`[AssetManager] Fallback failed: ${url}`);
              };
            });
        });
      }
    });
  }

  public async loadText(url: string, onProgress?: ProgressCallback): Promise<string> {
    const trackingKey = `text:${url}`;
    return this._cacheOrStart(this._textCache, url, async () => {
      const blob = await this._fetchWithProgress(url, trackingKey, onProgress);
      return blob.text();
    });
  }

  public async loadJson(url: string, onProgress?: ProgressCallback): Promise<unknown> {
    const trackingKey = `json:${url}`;
    return this._cacheOrStart(this._jsonCache, url, async () => {
      const blob = await this._fetchWithProgress(url, trackingKey, onProgress);
      const text: string = await blob.text();
      return JSON.parse(text);
    });
  }

  public async loadBinary(url: string, onProgress?: ProgressCallback): Promise<ArrayBuffer> {
    const trackingKey = `binary:${url}`;
    return this._cacheOrStart(this._binaryCache, url, async () => {
      const blob = await this._fetchWithProgress(url, trackingKey, onProgress);
      return blob.arrayBuffer();
    });
  }

  /**
   * Streams a binary resource chunk-by-chunk directly with chunk notifications
   * and builds a contiguous ArrayBuffer (DirectStorage Web streaming).
   * @param url The resource URL.
   * @param onChunk Optional callback invoked when each chunk is received.
   * @param onProgress Optional progress callback.
   */
  public async streamBinary(
    url: string,
    onChunk?: (chunk: Uint8Array, loaded: number, total: number) => void,
    onProgress?: ProgressCallback,
  ): Promise<ArrayBuffer> {
    const trackingKey = `stream:${url}`;
    return this._cacheOrStart(this._binaryCache, url, async () => {
      try {
        const finalUrl = this.resolveUrl(url);

        const fetchFn = this.customFetch ?? fetch;
        const response = await fetchFn(finalUrl, { headers: this._headers });
        if (!response.ok) {
          throw new Error(`[AssetManager] Stream error: ${response.status} at ${finalUrl}`);
        }

        const contentLength = response.headers.get("content-length");
        const total = contentLength ? parseInt(contentLength, 10) : 0;

        // Namespaced separately from loadBinary's "binary:" key -- both cache into _binaryCache and
        // could plausibly be called concurrently for the same url, and sharing a tracking key would
        // reintroduce the premature-completion race _fetchWithProgress's trackingKey param avoids.
        this._activeLoaders.set(trackingKey, { loaded: 0, total });

        if (!response.body) {
          const buf = await response.arrayBuffer();
          if (onChunk) onChunk(new Uint8Array(buf), buf.byteLength, total || buf.byteLength);
          if (onProgress) onProgress(buf.byteLength, total || buf.byteLength);
          return buf;
        }

        const reader = response.body.getReader();
        let loaded = 0;
        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            loaded += value.length;
            chunks.push(value);
            this._activeLoaders.set(trackingKey, { loaded, total });
            if (onChunk) onChunk(value, loaded, total);
            if (onProgress) onProgress(loaded, total);
          }
        }

        // Merge chunks into a single contiguous ArrayBuffer
        const finalBuffer = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
          finalBuffer.set(chunk, offset);
          offset += chunk.length;
        }

        return finalBuffer.buffer;
      } finally {
        // Mirror `_fetchWithProgress`: the tracking entry must be released even on failure.
        this._checkCompletion(trackingKey);
      }
    });
  }
}
