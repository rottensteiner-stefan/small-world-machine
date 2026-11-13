import { describe, expect, it } from "vitest";
import { pickHdrColorFormat } from "../../src/renderers/WebGL2/index.js";

const C = {
  RGBA: 0x1908,
  RGBA8: 0x8058,
  RGBA16F: 0x881a,
  HALF_FLOAT: 0x140b,
  UNSIGNED_BYTE: 0x1401,
};

function fakeGl(hasFloatExt: boolean): WebGL2RenderingContext {
  return {
    ...C,
    getExtension: (name: string) => (name === "EXT_color_buffer_float" && hasFloatExt ? {} : null),
  } as unknown as WebGL2RenderingContext;
}

describe("pickHdrColorFormat", () => {
  it("uses RGBA16F / HALF_FLOAT when EXT_color_buffer_float exists", () => {
    expect(pickHdrColorFormat(fakeGl(true))).toEqual({
      internalFormat: C.RGBA16F,
      format: C.RGBA,
      type: C.HALF_FLOAT,
    });
  });

  it("falls back to RGBA8 instead of an unrenderable float target when the extension is missing", () => {
    expect(pickHdrColorFormat(fakeGl(false))).toEqual({
      internalFormat: C.RGBA8,
      format: C.RGBA,
      type: C.UNSIGNED_BYTE,
    });
  });
});
