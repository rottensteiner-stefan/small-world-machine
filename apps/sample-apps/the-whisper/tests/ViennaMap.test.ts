/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { VIENNA_LOCATIONS, ViennaMapModal, type MapLocation } from "../ui/ViennaMapModal.js";
import type { TextResolver } from "../ui/TextResolver.js";

function createTexts(overrides: Record<string, string> = {}): TextResolver {
  return {
    t: (id: string): string => overrides[id] ?? id,
  };
}

describe("ViennaMap & Locations Data Model", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  it("should contain all key Vienna 2100 canonical locations", () => {
    const ids = VIENNA_LOCATIONS.map((loc) => loc.id);
    expect(ids).toContain("flakturm_arenberg");
    expect(ids).toContain("koje_42");
    expect(ids).toContain("bermudadreieck");
    expect(ids).toContain("prater_riesenrad");
    expect(ids).toContain("rossauer_kaserne");
    expect(ids).toContain("zentralfriedhof");
    expect(ids).toContain("safehouse_schellein");
    expect(ids).toContain("character_diorama");
  });

  it("should validate that all locations have valid coordinates and notes", () => {
    VIENNA_LOCATIONS.forEach((loc: MapLocation) => {
      expect(loc.xPercent).toBeGreaterThanOrEqual(0);
      expect(loc.xPercent).toBeLessThanOrEqual(100);
      expect(loc.yPercent).toBeGreaterThanOrEqual(0);
      expect(loc.yPercent).toBeLessThanOrEqual(100);

      expect(loc.title.length).toBeGreaterThan(3);
      expect(loc.district.length).toBeGreaterThan(2);
      expect(loc.grandfatherNote.length).toBeGreaterThan(10);
      expect(loc.transitText.length).toBeGreaterThan(10);
      expect(loc.faction.length).toBeGreaterThan(3);
    });
  });

  it("should correctly identify available travel targets", () => {
    const available = VIENNA_LOCATIONS.filter((l) => l.status === "available");
    expect(available.length).toBeGreaterThanOrEqual(2);

    available.forEach((loc) => {
      expect(loc.targetUrl).toBeDefined();
      expect(typeof loc.targetUrl).toBe("string");
    });
  });

  it("should toggle open and closed state on ViennaMapModal instance", () => {
    const modal = new ViennaMapModal(createTexts(), "flakturm_arenberg");
    expect(modal.isOpen).toBe(false);

    modal.open();
    expect(modal.isOpen).toBe(true);

    modal.close();
    expect(modal.isOpen).toBe(false);

    modal.toggle();
    expect(modal.isOpen).toBe(true);

    modal.destroy();
  });

  it("should render top bar, pins, and drawer content through injected TextResolver", () => {
    const modal = new ViennaMapModal(createTexts(), "flakturm_arenberg");
    modal.open();

    const root = document.getElementById("viennaMapModalContainer");
    expect(root).not.toBeNull();
    expect(root?.innerHTML).toContain("ui.map.title");
    expect(root?.innerHTML).toContain("ui.map.subtitle");
    expect(root?.innerHTML).toContain("ui.map.closeHint");

    // Check that pin overlays resolve location titles
    expect(root?.innerHTML).toContain("map.flakturm_arenberg.title");

    // Drawer should display currently selected location (flakturm_arenberg)
    const drawer = document.getElementById("drawerContent");
    expect(drawer?.innerHTML).toContain("map.flakturm_arenberg.district");
    expect(drawer?.innerHTML).toContain("map.flakturm_arenberg.statusLabel");
    expect(drawer?.innerHTML).toContain("map.flakturm_arenberg.grandfatherNote");
    expect(drawer?.innerHTML).toContain("ui.map.controllingFaction");
    expect(drawer?.innerHTML).toContain("ui.map.threatLabel");
    expect(drawer?.innerHTML).toContain("ui.map.noteTag");
    expect(drawer?.innerHTML).toContain("ui.map.currentLocation");

    modal.destroy();
  });
});
