import { describe, it, expect } from "vitest";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { PostProcessingGroup } from "../../src/renderers/post/PostProcessingGroup.js";
import { ToneMappingElement } from "../../src/renderers/post/elements/ToneMappingElement.js";
import { VignetteElement } from "../../src/renderers/post/elements/VignetteElement.js";
import { LightShaftsElement } from "../../src/renderers/post/elements/LightShaftsElement.js";
import { VolumetricFogElement } from "../../src/renderers/post/elements/VolumetricFogElement.js";
import { BloomElement } from "../../src/renderers/post/elements/BloomElement.js";
import { PostProcessPassGL } from "../../src/renderers/post/passes/PostProcessPassGL.js";

describe("PostProcessPassGL Shader Signature & Rebuild Isolation", () => {
  it("does not alter shader signature when continuous tuning values change", () => {
    const glPass = new PostProcessPassGL({} as WebGL2RenderingContext, true, new ShaderRegistry());
    const getSig = (
      glPass as unknown as { _getSignature: (g: PostProcessingGroup) => number }
    )._getSignature.bind(glPass);

    const group = new PostProcessingGroup();
    const tm = new ToneMappingElement();
    tm.exposure = 1.0;
    tm.gamma = 2.2;

    const vig = new VignetteElement();
    vig.offset = 0.8;
    vig.darkness = 0.5;
    vig.roundness = 2.0;

    const bloom = new BloomElement();
    bloom.intensity = 1.0;

    group.add(tm);
    group.add(vig);
    group.add(bloom);

    const sig1 = getSig(group);

    // Tweak slider values (continuous tuning)
    tm.exposure = 2.5;
    tm.gamma = 1.8;
    vig.offset = 0.3;
    vig.darkness = 0.9;
    vig.roundness = 4.0;
    bloom.intensity = 3.0;

    const sig2 = getSig(group);
    expect(sig2).toBe(sig1);

    // Structural change: toggle bloom off
    bloom.enabled = false;
    const sig3 = getSig(group);
    expect(sig3).not.toBe(sig1);
  });

  it("bakes shafts/fog/HBAO into the shader only when their texture exists this frame", () => {
    const glPass = new PostProcessPassGL({} as WebGL2RenderingContext, true, new ShaderRegistry());
    const internals = glPass as unknown as {
      _getSignature: (g: PostProcessingGroup) => number;
      _hasShaftsTexture: boolean;
      _hasFogTexture: boolean;
      _hasHbaoTexture: boolean;
    };
    const group = new PostProcessingGroup();
    const shafts = new LightShaftsElement();
    const fog = new VolumetricFogElement();
    shafts.enabled = true;
    fog.enabled = true;
    group.add(shafts);
    group.add(fog);

    // Elements enabled, but the upstream passes produced nothing (e.g. sun without shadows):
    // an enabled define would sample the HDR colour on unit 0 as if it were shafts/fog.
    const noTextures = internals._getSignature(group);

    internals._hasShaftsTexture = true;
    const withShafts = internals._getSignature(group);
    internals._hasFogTexture = true;
    const withBoth = internals._getSignature(group);

    expect(withShafts).not.toBe(noTextures);
    expect(withBoth).not.toBe(withShafts);
  });
});
