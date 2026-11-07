import type { IAssetSource } from "../types.js";
import { SecurityValidator } from "../Security.js";
import { globToRegExp } from "../globPattern.js";

export interface HttpAssetSourceOptions {
  id?: string;
  name?: string;
  baseUrl: string;
  knownFiles?: string[];
  security?: SecurityValidator;
}

/**
 * Asset source reading files over HTTP / dev-server presets.
 */
export class HttpAssetSource implements IAssetSource {
  public readonly id: string;
  public readonly name: string;
  private readonly _baseUrl: string;
  private readonly _knownFiles: Set<string>;
  private readonly _security: SecurityValidator;

  constructor(options: HttpAssetSourceOptions) {
    this.id = options.id ?? `http-${Math.random().toString(36).substring(2, 9)}`;
    this.name = options.name ?? options.baseUrl;
    let base = options.baseUrl;
    if (!base.endsWith("/")) {
      base += "/";
    }
    this._baseUrl = base;
    this._knownFiles = new Set(
      (options.knownFiles ?? []).map((f) => options.security?.sanitizePath(f) ?? f),
    );
    this._security = options.security ?? new SecurityValidator();
  }

  public get baseUrl(): string {
    return this._baseUrl;
  }

  public async list(pattern?: string): Promise<string[]> {
    const all = Array.from(this._knownFiles);
    if (!pattern) return all;
    const regex = globToRegExp(pattern);
    return all.filter((p) => regex.test(p));
  }

  public async has(path: string): Promise<boolean> {
    const cleanPath = this._security.sanitizePath(path);
    if (this._knownFiles.size > 0 && this._knownFiles.has(cleanPath)) {
      return true;
    }
    try {
      const resp = await fetch(`${this._baseUrl}${cleanPath}`, { method: "HEAD" });
      return resp.ok;
    } catch {
      return false;
    }
  }

  public async read(path: string): Promise<Uint8Array> {
    const cleanPath = this._security.sanitizePath(path);
    const resp = await fetch(`${this._baseUrl}${cleanPath}`);
    if (!resp.ok) {
      throw new Error(`[HttpAssetSource] Failed to fetch ${cleanPath} (HTTP ${resp.status})`);
    }
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  }

  public async readText(path: string): Promise<string> {
    const cleanPath = this._security.sanitizePath(path);
    const resp = await fetch(`${this._baseUrl}${cleanPath}`);
    if (!resp.ok) {
      throw new Error(`[HttpAssetSource] Failed to fetch ${cleanPath} (HTTP ${resp.status})`);
    }
    return resp.text();
  }

  public async readJson<T = unknown>(path: string): Promise<T> {
    const text = await this.readText(path);
    return JSON.parse(text) as T;
  }

  public toFetch(mountPrefix?: string): (url: string, init?: RequestInit) => Promise<Response> {
    const prefix = mountPrefix ?? `sw-asset://${this.id}/`;
    return async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.startsWith(prefix)) {
        const relPath = url.substring(prefix.length);
        const cleanPath = this._security.sanitizePath(relPath);
        return fetch(`${this._baseUrl}${cleanPath}`, init);
      }
      return fetch(url, init);
    };
  }
}
