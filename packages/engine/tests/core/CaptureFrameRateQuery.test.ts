// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { getCaptureFrameRateFromQuery } from "../../src/core/showcase/AbstractShowcase.js";

describe("getCaptureFrameRateFromQuery", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  const withQuery = (query: string): number | undefined => {
    window.history.replaceState({}, "", `/${query}`);
    return getCaptureFrameRateFromQuery();
  };

  it("is undefined without the parameter", () => {
    expect(withQuery("")).toBeUndefined();
  });

  it("reads a positive number", () => {
    expect(withQuery("?captureFps=60")).toBe(60);
    expect(withQuery("?rendererType=WEB_GPU&captureFps=24")).toBe(24);
  });

  it("ignores zero, negative and non-numeric values", () => {
    expect(withQuery("?captureFps=0")).toBeUndefined();
    expect(withQuery("?captureFps=-30")).toBeUndefined();
    expect(withQuery("?captureFps=abc")).toBeUndefined();
    expect(withQuery("?captureFps=")).toBeUndefined();
  });
});
