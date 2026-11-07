// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbstractShowcase } from "../../../src/core/showcase/AbstractShowcase.js";
import { makeMockAudioContext } from "../../audio/mockAudioContext.js";

let origAudioContext: unknown;
const installAudioMock = (): void => {
  origAudioContext = (window as unknown as { AudioContext: unknown }).AudioContext;
  (window as unknown as { AudioContext: unknown }).AudioContext = class {
    constructor() {
      return makeMockAudioContext();
    }
  };
};
const restoreAudioMock = (): void => {
  (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
};

/** Minimal concrete showcase: the constructor wires the nav buttons without starting a renderer. */
class NavShowcase extends AbstractShowcase {
  protected override async setupScene(): Promise<void> {}
  protected override update(_deltaTime: number): void {}
}

// jsdom implements no layout-based `innerText`; the production code assigns it, so it survives as a
// plain property there (a real browser mirrors it into textContent).
const buttonTexts = (): string[] =>
  Array.from(document.body.querySelectorAll("button")).map((b) => b.innerText);

function mountHeader(attrs: Record<string, string>): void {
  const header = document.createElement("header");
  header.id = "info";
  for (const [key, value] of Object.entries(attrs)) header.setAttribute(key, value);
  document.body.appendChild(header);
}

describe("AbstractShowcase prev/next navigation (data-prev / data-next on #info)", () => {
  const created: NavShowcase[] = [];
  const build = (): NavShowcase => {
    const showcase = new NavShowcase();
    created.push(showcase);
    return showcase;
  };

  beforeEach(() => {
    installAudioMock();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    restoreAudioMock();
    for (const showcase of created.splice(0)) {
      window.removeEventListener("keydown", showcase["_showcaseKeyDownHandler"]);
    }
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders both buttons when the header carries both attributes", () => {
    mountHeader({ "data-prev": "../44/index.html", "data-next": "../24/index.html" });
    build();
    expect(buttonTexts()).toEqual(["◀", "▶"]);
  });

  it("renders only the buttons whose attribute is present", () => {
    mountHeader({ "data-next": "../24/index.html" });
    build();
    expect(buttonTexts()).toEqual(["▶"]);
  });

  it("renders no buttons for a page without tour attributes or without a header", () => {
    mountHeader({});
    build();
    expect(buttonTexts()).toEqual([]);

    document.body.innerHTML = "";
    build();
    expect(buttonTexts()).toEqual([]);
  });

  it("navigates to the resolved path of the clicked direction, dropping any ?rendererType query", () => {
    mountHeader({ "data-prev": "../44/index.html", "data-next": "../24/index.html" });
    const location = {
      href: "https://example.test/apps/showcases/45/index.html?rendererType=webgl1",
    };
    vi.stubGlobal("location", location);
    build();
    const [prev, next] = Array.from(document.body.querySelectorAll("button"));

    next!.click();
    expect(location.href).toBe("/apps/showcases/24/index.html");

    location.href = "https://example.test/apps/showcases/45/index.html";
    prev!.click();
    expect(location.href).toBe("/apps/showcases/44/index.html");
  });
});
