import type { ShaderDefinition } from "./ShaderDefinition.js";
import type { ShaderProvider } from "../../interfaces/index.js";
import type { ShaderChunkId } from "../../enums/index.js";
import { CoreShaderChunks } from "./CoreShaderChunks.js";
// Single source of the shared wind field (ADR 0059 step 1b): the function chunk lives in
// `vegetation-extras` (canonical, `WIND_FIELD_*` re-exports + CPU `WindField` mirror) and is
// registered here so the engine's field lane (`field_pull.wgsl`) and the WebGL2 vertex chunks
// consume the very same code instead of maintaining byte-copies that could drift. The engine
// imports the raw file by workspace-relative path (the packages are npm workspaces; engine does
// not declare a dependency on vegetation-extras).
import windFieldGLSL from "../../../../vegetation-extras/src/wind/shaders/chunks/wind_field.glsl?raw";
import windFieldWGSL from "../../../../vegetation-extras/src/wind/shaders/chunks/wind_field.wgsl?raw";

/**
 * Supported shader languages.
 */
export type ShaderLanguage = "glsl300" | "glsl100" | "wgsl";

/** `struct SwmWind { ... }` block of the canonical wind chunk (WGSL). */
const SWM_WIND_STRUCT_RE = /struct SwmWind \{\n[\s\S]*?\n\}/;

/**
 * Functions-only WGSL wind variant for the field-pull module: the composed module already declares
 * `SwmWind` via `instance_field_structs.wgsl`, and WGSL forbids duplicate module-scope structs.
 * Derived from the canonical chunk at registration time -- never a maintained copy.
 */
function windFieldFunctionsOnly(source: string): string {
  return source.replace(SWM_WIND_STRUCT_RE, "");
}

/**
 * Central registry for shader definitions.
 */
export class ShaderRegistry {
  private _shaders: Map<string, ShaderDefinition> = new Map();
  private _providers: Map<string, ShaderProvider> = new Map();
  private _chunks: Map<string, Map<ShaderLanguage, string>> = new Map();

  constructor() {
    // Shared wind field chunk (ADR 0059 step 1b) from the canonical vegetation-extras source: full
    // block (struct + functions) for standalone/GL consumers, plus the struct-stripped WGSL
    // functions variant the field-pull module injects (its `SwmWind` lives in
    // `instance_field_structs.wgsl`, so a duplicate module-scope struct would be a WGSL error).
    this._registerWindChunks();
  }

  private _registerWindChunks(): void {
    const wgslFuncs = windFieldFunctionsOnly(windFieldWGSL);
    this.registerChunk("WIND_FIELD", windFieldWGSL, "wgsl");
    this.registerChunk("WIND_FIELD", windFieldGLSL, "glsl300");
    this.registerChunk("WIND_FIELD", windFieldGLSL, "glsl100");
    this.registerChunk("WIND_FIELD_FUNCS", wgslFuncs, "wgsl");
  }

  /**
   * Registers a new shader definition.
   * @param definition The shader definition to register.
   */
  public register(definition: ShaderDefinition): void {
    this._shaders.set(definition.id, definition);
  }

  /**
   * Registers a provider that can supply a shader definition on demand.
   * @param id The shader ID.
   * @param provider The provider instance.
   */
  public registerProvider(id: string, provider: ShaderProvider): void {
    this._providers.set(id, provider);
  }

  /**
   * Makes `provider` (typically a material) the source of shader `id` unless that id is already
   * known (registered, or provided earlier). The renderer calls this for every material it
   * renders, so a registry only ever knows what its own engine has seen (ADR 0032).
   * @param id The shader ID (the material's `getRenderManifest().shaderId`).
   * @param provider The provider that can build the shader definition on demand.
   */
  public ensureProvider(id: string, provider: ShaderProvider): void {
    if (!this._shaders.has(id) && !this._providers.has(id)) {
      this._providers.set(id, provider);
    }
  }

  /**
   * Gets a shader definition by its ID.
   * If not found, it checks if a provider is registered for this ID.
   * @param id The ID of the shader.
   * @returns The shader definition or undefined if not found.
   */
  public get(id: string): ShaderDefinition | undefined {
    CoreShaderChunks.init(this);
    let def = this._shaders.get(id);

    if (!def) {
      const provider = this._providers.get(id);
      if (provider) {
        def = provider.getShaderDefinition();
        this.register(def);
        this._providers.delete(id); // Move from provider to registered shader
      }
    }

    return def;
  }

  /**
   * Registers a shader chunk for a specific language.
   * @param id The ID of the chunk (a built-in `ShaderChunkId`, or any external/dynamic id).
   * @param code The source code of the chunk.
   * @param lang The language of the code.
   */
  public registerChunk(
    id: ShaderChunkId | (string & {}),
    code: string,
    lang: ShaderLanguage,
  ): void {
    if (!this._chunks.has(id)) {
      this._chunks.set(id, new Map());
    }
    this._chunks.get(id)!.set(lang, code);
  }

  /**
   * Gets a shader chunk by its ID and language.
   * @param id The ID of the chunk (a built-in `ShaderChunkId`, or any external/dynamic id).
   * @param lang The language of the chunk.
   * @returns The source code of the chunk or undefined if not found.
   */
  public getChunk(id: ShaderChunkId | (string & {}), lang: ShaderLanguage): string | undefined {
    CoreShaderChunks.init(this);
    const chunk = this._chunks.get(id)?.get(lang);
    return chunk;
  }

  /**
   * Processes a shader source and replaces all chunk placeholders.
   * Placeholders are formatted as: [CHUNK_ID]
   * @param source The shader source code.
   * @param lang The language to use for chunks.
   * @returns The source code with all placeholders replaced.
   */
  public assemble(source: string, lang: ShaderLanguage): string {
    CoreShaderChunks.init(this);
    // Regex matches [CHUNK_NAME] but avoids [0-9] or single letters to not collide with GLSL array indexing
    return source.replace(/\[([A-Z][A-Z0-9_]+)\]/g, (match: string, chunkId: string) => {
      const chunk: string | undefined = this.getChunk(chunkId, lang);
      if (undefined === chunk) {
        console.warn(`[ShaderRegistry] Chunk not found for language ${lang}: ${chunkId}`);
        return match;
      }
      // Recursively assemble chunks in case chunks contain other chunks
      return this.assemble(chunk, lang);
    });
  }
}
