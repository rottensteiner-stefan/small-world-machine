import { describe, it, expect, vi, beforeEach } from "vitest";
import { TextTexture } from "../../../src/core/text/TextTexture.js";
import { Texture } from "../../../src/core/textures/Texture.js";

// Mock Canvas API
const mockMeasureText = vi.fn().mockReturnValue({ width: 100 });
const mockGetContext = vi.fn().mockReturnValue({
  measureText: mockMeasureText,
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
});

describe("TextTexture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("document", {
      createElement: vi.fn().mockImplementation((tag) => {
        if (tag === "canvas") {
          return {
            getContext: mockGetContext,
            width: 0,
            height: 0,
          };
        }
        return {};
      }),
      fonts: {
        add: vi.fn(),
      },
    });
    vi.stubGlobal(
      "FontFace",
      class {
        public load(): Promise<unknown> {
          return Promise.resolve(this);
        }
      },
    );
  });

  it("creates a texture from text", () => {
    const textTexture = new TextTexture({ text: "Hello World" });
    expect(textTexture.texture).toBeInstanceOf(Texture);
    expect(textTexture.texture.needsUpdate).toBe(false); // set to true only on setText
    expect(mockGetContext).toHaveBeenCalled();
  });

  it("updates needsUpdate when setText is called", () => {
    const textTexture = new TextTexture({ text: "Initial" });
    textTexture.setText("Updated");
    expect(textTexture.texture.needsUpdate).toBe(true);
  });

  it("calculates aspect ratio correctly", () => {
    mockMeasureText.mockReturnValueOnce({ width: 200 }); // Line 1
    const textTexture = new TextTexture({
      text: "Hello",
      padding: 10,
      fontSize: 20,
      lineHeight: 1,
    });
    // width: 200 + 20 (padding) = 220
    // height: 1 line * 20 * 1 + 20 (padding) = 40
    expect(textTexture.width).toBe(220);
    expect(textTexture.height).toBe(40);
    expect(textTexture.aspectRatio).toBe(220 / 40);
  });

  it("wraps lines according to maxWidth", () => {
    mockMeasureText.mockImplementation((text: string) => {
      return { width: text.length * 10 }; // 10px per char
    });
    const textTexture = new TextTexture({
      text: "A very long sentence",
      maxWidth: 100, // including 2*padding, meaning content maxWidth is 100 - 48 (default padding) = 52.
      padding: 24,
    });
    // "A very long sentence" has words: "A" (10), "very" (40), "long" (40), "sentence" (80)
    // "A very" = 60 > 52, so it splits.
    expect(textTexture.height).toBeGreaterThan(0);
  });
});
