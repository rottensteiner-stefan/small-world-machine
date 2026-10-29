import type { RenderManifest } from "@small-world-machine/engine";
import {
  BlendingMode,
  Color,
  CullMode,
  StandardMaterial,
  Texture,
} from "@small-world-machine/engine";

/**
 * Configuration options for {@link EmberSpriteMaterial}.
 */
export interface EmberSpriteMaterialOptions {
  /** Radial point-sprite texture (RGB falloff baked in, alpha 1). Optional in headless tests. */
  sprite?: Texture | undefined;
}

const SPRITE_SIZE = 32;

/**
 * Soft additive point sprite for ember/glutt particles. Deliberately a `StandardMaterial` with
 * additive blending (and no emissive): the engine multiplies per-instance color into the FINAL
 * output (`Standard.frag.glsl`/WGSL `tint`), so the per-particle cooling tint reaches the pixel
 * intact. Emissive would add flat across the quad and paint a bright square, so it stays black —
 * the sprite is lit by the fire's own point light, which reads as exactly the "glow near the
 * flame, cool as it drifts away" an ember needs. The texture bakes its falloff into RGB, because
 * additive `ONE, ONE` blending ignores alpha; the quad's dark edge adds nothing.
 */
export class EmberSpriteMaterial extends StandardMaterial {
  public static readonly TYPE = "EmberSpriteMaterial";

  /** @domain radial point-sprite texture (RGB falloff, alpha 1); undefined = solid square. */
  public sprite: Texture | undefined;

  constructor(options: EmberSpriteMaterialOptions = {}) {
    super({
      color: new Color(1, 1, 1, 1),
      diffuseMap: options.sprite,
      metallic: 0,
      roughness: 1,
      transparent: true,
    });
    this.sprite = options.sprite;
    this.cullMode = CullMode.NONE;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    const manifest = super.getRenderManifest();
    // `_syncBaseManifestState` re-derives the state every call, so the overrides must be set
    // here each time (idempotent). CPU-side per-instance billboarding (see `ParticleMeshRenderer`)
    // cannot be reproduced by the shared depth pre-pass pipeline — same exclusion as the flame.
    manifest.state!.blending = BlendingMode.ADDITIVE;
    manifest.state!.skipDepthPrePass = true;
    return manifest;
  }
}

/**
 * Radial point sprite with the falloff baked into RGB (alpha stays 1). Returns `undefined` when
 * no canvas is available (headless tests), so the material still constructs and renders as a
 * solid square — the emitter and its tests never require a real texture.
 */
export function createEmberSpriteTexture(): Texture | undefined {
  // Headless test environments have no DOM; the material then renders as a solid additive square.
  if (typeof document === "undefined") {
    return undefined;
  }
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    return undefined;
  }
  const image = context.createImageData(SPRITE_SIZE, SPRITE_SIZE);
  const center = (SPRITE_SIZE - 1) / 2;
  const max = center / 2.4; // tighter than the quad border so the square never shows
  for (let y = 0; y < SPRITE_SIZE; y++) {
    for (let x = 0; x < SPRITE_SIZE; x++) {
      const dx = (x - center) / max;
      const dy = (y - center) / max;
      const falloff = Math.exp(-(dx * dx + dy * dy));
      const offset = (y * SPRITE_SIZE + x) * 4;
      image.data[offset] = Math.round(255 * falloff);
      image.data[offset + 1] = Math.round(255 * falloff);
      image.data[offset + 2] = Math.round(255 * falloff);
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return Texture.fromCanvas(canvas);
}
