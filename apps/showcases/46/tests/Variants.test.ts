import { describe, expect, it } from "vitest";
import { resolveVariant } from "../Variants.js";

describe("46 Variants", () => {
  it("resolveVariant degrades unknown, empty and nullish input to overview", () => {
    expect(resolveVariant("smoke").id).toBe("smoke");
    expect(resolveVariant("nope").id).toBe("overview");
    expect(resolveVariant("").id).toBe("overview");
    expect(resolveVariant(null).id).toBe("overview");
    expect(resolveVariant(undefined).id).toBe("overview");
    expect(resolveVariant("toString").id).toBe("overview");
  });
});
