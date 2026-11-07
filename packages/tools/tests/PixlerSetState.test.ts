// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { Pixler } from "../src/Pixler.js";

describe("Pixler.setState", () => {
  it("reports a failing loadFromBase64 via console.error instead of an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // Bypass the DOM-heavy constructor: setState only needs loadFromBase64.
    const pixler = Object.create(Pixler.prototype) as Pixler;
    vi.spyOn(pixler, "loadFromBase64").mockRejectedValue(new Error("broken"));

    pixler.setState("data:image/png;base64,###");
    await new Promise((r) => setTimeout(r, 10));

    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
