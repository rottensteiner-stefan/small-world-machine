/**
 * Per-object texture references of one renderer: which textures each drawn object holds, so a
 * texture's GPU resource is freed once no object references it anymore. Shared by the WebGPU
 * texture cache and the GL texture manager (the refcounts themselves stay with each owner,
 * reached through `acquire`/`release`).
 *
 * Hot path: `acquire()` runs per object and per pass. Diffing a material's texture record key by
 * key there (22 slots for a `StandardMaterial`) dominated the frame's JS time at 20k objects.
 * Instead, `setVersion()` diffs a record ONCE per batch and stamps its current contents with a
 * version; an object that already holds exactly that (record, version) skips in O(1). The full
 * per-key diff only runs when the record changed or the object is new.
 *
 * Merge semantics (see `GPUTextureResourceCache.acquireTextures`): one object is acquired with
 * DIFFERENT records in one frame (main pass vs depth/shadow pass), each carrying only its own
 * keys. Keys absent from a record leave the object's snapshot untouched. Any change to an
 * object's snapshot invalidates every (record, version) it had verified, so the fast path is
 * exactly equivalent to running the full diff every time.
 */
export class TextureHoldings<T extends object> {
  private readonly _byObject = new WeakMap<object, Holding<T>>();
  private readonly _sets = new WeakMap<object, TextureSetState<T>>();
  private readonly _acquire: (tex: T) => void;
  private readonly _release: (tex: T) => void;
  /** Global version clock: a (record, version) pair is never reused, even across records. */
  private _clock = 0;

  constructor(acquire: (tex: T) => void, release: (tex: T) => void) {
    this._acquire = acquire;
    this._release = release;
  }

  /**
   * Version of `textures`' current contents: unchanged as long as its keys and values (in
   * enumeration order) are the same as at the previous call, a new value otherwise. Call once
   * per batch, after the material built its manifest, and pass the result to every `acquire()`
   * of that batch.
   */
  public setVersion(textures: Record<string, T | undefined>): number {
    let s = this._sets.get(textures);
    if (!s) {
      s = { keys: [], values: [], version: -1 };
      this._sets.set(textures, s);
    }
    const keys = s.keys;
    const values = s.values;
    let n = 0;
    let changed = false;
    for (const key in textures) {
      const value = textures[key];
      if (n >= keys.length || keys[n] !== key || values[n] !== value) {
        keys[n] = key;
        values[n] = value;
        changed = true;
      }
      n++;
    }
    if (n !== keys.length) {
      keys.length = n;
      values.length = n;
      changed = true;
    }
    if (changed || s.version < 0) s.version = ++this._clock;
    return s.version;
  }

  /**
   * Records that `obj` depends on the textures in `textures`. `version` is the record's
   * `setVersion()` from this batch; `-1` (no version) always runs the full per-key diff.
   */
  public acquire(obj: object, textures: Record<string, T | undefined>, version = -1): void {
    let h = this._byObject.get(obj);
    if (!h) {
      h = { textures: {}, sets: [], versions: [] };
      this._byObject.set(obj, h);
    }
    const sets = h.sets;
    let slot = -1;
    if (version >= 0) {
      for (let i = 0; i < sets.length; i++) {
        if (sets[i] !== textures) continue;
        if (h.versions[i] === version) return;
        slot = i;
        break;
      }
    }

    const held = h.textures;
    let changed = false;
    for (const key in textures) {
      const current = textures[key];
      const last = held[key];
      if (current !== last) {
        if (last) this._release(last);
        if (current) this._acquire(current);
        held[key] = current;
        changed = true;
      }
    }

    if (changed) {
      // The snapshot moved: every record verified against the old one must be re-checked.
      sets.length = 0;
      h.versions.length = 0;
      slot = -1;
    }
    if (version < 0) return;
    if (slot >= 0) {
      h.versions[slot] = version;
    } else if (sets.length < MAX_VERIFIED_SETS) {
      sets.push(textures);
      h.versions.push(version);
    }
  }

  /** Releases every texture `obj` holds and forgets it (object removed from the renderer). */
  public releaseObject(obj: object): void {
    const h = this._byObject.get(obj);
    if (!h) return;
    this._byObject.delete(obj);
    const held = h.textures;
    for (const key in held) {
      const tex = held[key];
      if (tex) this._release(tex);
    }
  }
}

/** Records per object: main material + depth/shadow materials stay far below this. */
const MAX_VERIFIED_SETS = 8;

interface Holding<T> {
  /** Merged snapshot over all records this object was acquired with. */
  textures: Record<string, T | undefined>;
  /** Records verified equal to `textures` on their keys, with the version they were verified at. */
  sets: object[];
  versions: number[];
}

interface TextureSetState<T> {
  keys: string[];
  values: (T | undefined)[];
  version: number;
}
