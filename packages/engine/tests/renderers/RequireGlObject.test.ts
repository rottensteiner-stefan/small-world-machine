import { describe, expect, it } from "vitest";
import { requireGlObject } from "../../src/renderers/gl/requireGlObject.js";
import { WebGL2FrameBuffer } from "../../src/renderers/WebGL2/index.js";

describe("requireGlObject", () => {
  it("returns the object unchanged", () => {
    const texture = {} as WebGLTexture;
    expect(requireGlObject(texture, "texture")).toBe(texture);
  });

  it("names the resource when the context handed back null (lost context)", () => {
    expect(() => requireGlObject(null, "framebuffer")).toThrow(/Failed to create framebuffer/);
  });

  it("makes a framebuffer created on a lost context fail with that message, not a later TypeError", () => {
    const lostGl = {
      createFramebuffer: () => null,
      bindFramebuffer: () => {},
    } as unknown as WebGL2RenderingContext;
    expect(() => new WebGL2FrameBuffer(lostGl, { width: 4, height: 4 })).toThrow(
      /Failed to create framebuffer/,
    );
  });
});
