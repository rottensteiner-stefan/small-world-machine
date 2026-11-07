import { describe, expect, it } from "vitest";
import { pickHdrColorFormat, WebGL2FrameBuffer } from "../../src/renderers/WebGL2/index.js";

const C = {
  RGBA: 0x1908,
  RGBA8: 0x8058,
  RGBA16F: 0x881a,
  HALF_FLOAT: 0x140b,
  UNSIGNED_BYTE: 0x1401,
  FRAMEBUFFER: 0x8d40,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  RENDERBUFFER: 0x8d41,
  DEPTH24_STENCIL8: 0x88f0,
  DEPTH_STENCIL_ATTACHMENT: 0x821a,
  COLOR_ATTACHMENT0: 0x8ce0,
  TEXTURE_2D: 0x0de1,
};

function fakeGl(hasFloatExt: boolean): { gl: WebGL2RenderingContext; renderbuffers: () => number } {
  let renderbuffers = 0;
  const gl = {
    ...C,
    getExtension: (name: string) => (name === "EXT_color_buffer_float" && hasFloatExt ? {} : null),
    createFramebuffer: () => ({}),
    createTexture: () => ({}),
    createRenderbuffer: () => {
      renderbuffers++;
      return {};
    },
    bindFramebuffer: () => {},
    bindTexture: () => {},
    bindRenderbuffer: () => {},
    texImage2D: () => {},
    texParameteri: () => {},
    framebufferTexture2D: () => {},
    framebufferRenderbuffer: () => {},
    renderbufferStorage: () => {},
    checkFramebufferStatus: () => C.FRAMEBUFFER_COMPLETE,
    deleteFramebuffer: () => {},
    deleteRenderbuffer: () => {},
    deleteTexture: () => {},
  } as unknown as WebGL2RenderingContext;
  return { gl, renderbuffers: () => renderbuffers };
}

describe("pickHdrColorFormat", () => {
  it("uses RGBA16F / HALF_FLOAT when EXT_color_buffer_float exists", () => {
    expect(pickHdrColorFormat(fakeGl(true).gl)).toEqual({
      internalFormat: C.RGBA16F,
      format: C.RGBA,
      type: C.HALF_FLOAT,
    });
  });

  it("falls back to RGBA8 instead of an unrenderable float target when the extension is missing", () => {
    expect(pickHdrColorFormat(fakeGl(false).gl)).toEqual({
      internalFormat: C.RGBA8,
      format: C.RGBA,
      type: C.UNSIGNED_BYTE,
    });
  });
});

describe("WebGL2FrameBuffer depth option", () => {
  it("attaches a depth/stencil renderbuffer by default", () => {
    const { gl, renderbuffers } = fakeGl(true);
    new WebGL2FrameBuffer(gl, { width: 4, height: 4 });
    expect(renderbuffers()).toBe(1);
  });

  it("skips the renderbuffer for pure post-process targets and still resizes/destroys cleanly", () => {
    const { gl, renderbuffers } = fakeGl(true);
    const fb = new WebGL2FrameBuffer(gl, { width: 4, height: 4, depth: false });
    expect(renderbuffers()).toBe(0);
    expect(() => fb.resize(8, 8)).not.toThrow();
    expect(() => fb.destroy()).not.toThrow();
  });
});
