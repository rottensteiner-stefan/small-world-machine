import type { ShaderDefinition } from "./ShaderDefinition.js";
import type { ShaderProvider } from "../../interfaces/index.js";
import { CoreShaderChunks } from "./CoreShaderChunks.js";

/**
 * Supported shader languages.
 */
export type ShaderLanguage = "glsl300" | "glsl100" | "wgsl";

/**
 * Process-wide registry of material shader providers, keyed by material type. Materials aren't
 * constructed with a reference to a specific engine/registry, so this stays a flat type->provider
 * lookup rather than per-instance state -- every ShaderRegistry instance consults it as a fallback
 * in get(). Populated by AbstractMaterial's constructor.
 */
const materialShaderProviders = new Map<string, ShaderProvider>();

/** Registers a material type's shader provider for lookup by any ShaderRegistry instance. */
export function registerMaterialShaderProvider(type: string, provider: ShaderProvider): void {
  if (!materialShaderProviders.has(type)) {
    materialShaderProviders.set(type, provider);
  }
}

/**
 * Central registry for shader definitions.
 */
export class ShaderRegistry {
  private static _instance: ShaderRegistry;
  private _shaders: Map<string, ShaderDefinition> = new Map();
  private _providers: Map<string, ShaderProvider> = new Map();
  private _chunks: Map<string, Map<ShaderLanguage, string>> = new Map();

  constructor() {}

  /**
   * Gets the process-wide default ShaderRegistry instance.
   * @deprecated Use an instance via `RendererContext.shaderRegistry` instead. Removal target: v1.0.0.
   * @returns The instance.
   */
  public static get instance(): ShaderRegistry {
    if (!this._instance) {
      this._instance = new ShaderRegistry();
    }
    return this._instance;
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
   * Gets a shader definition by its ID.
   * If not found, it checks if a provider is registered for this ID.
   * @param id The ID of the shader.
   * @returns The shader definition or undefined if not found.
   */
  public get(id: string): ShaderDefinition | undefined {
    CoreShaderChunks.init(this);
    let def = this._shaders.get(id);

    if (!def) {
      const provider = this._providers.get(id) ?? materialShaderProviders.get(id);
      if (provider) {
        def = provider.getShaderDefinition();
        this.register(def);
        this._providers.delete(id); // Move from provider to registered shader
      }
    }

    if (!def && this !== ShaderRegistry._instance && ShaderRegistry._instance) {
      console.warn(
        `[ShaderRegistry] Cache miss on instance registry for "${id}" -- falling back to the global ` +
          "singleton. Register this shader on a RendererContext-scoped registry instead.",
      );
      def = ShaderRegistry._instance.get(id);
    }

    return def;
  }

  /**
   * Registers a shader chunk for a specific language.
   * @param id The ID of the chunk (e.g., "LIGHTING_PHONG").
   * @param code The source code of the chunk.
   * @param lang The language of the code.
   */
  public registerChunk(id: string, code: string, lang: ShaderLanguage): void {
    if (!this._chunks.has(id)) {
      this._chunks.set(id, new Map());
    }
    this._chunks.get(id)!.set(lang, code);
  }

  /**
   * Gets a shader chunk by its ID and language.
   * @param id The ID of the chunk.
   * @param lang The language of the chunk.
   * @returns The source code of the chunk or undefined if not found.
   */
  public getChunk(id: string, lang: ShaderLanguage): string | undefined {
    CoreShaderChunks.init(this);
    const chunk = this._chunks.get(id)?.get(lang);
    if (undefined === chunk && this !== ShaderRegistry._instance && ShaderRegistry._instance) {
      console.warn(
        `[ShaderRegistry] Chunk "${id}" not cached on instance registry -- falling back to the global ` +
          "singleton. Register this chunk on a RendererContext-scoped registry instead.",
      );
      return ShaderRegistry._instance.getChunk(id, lang);
    }
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
