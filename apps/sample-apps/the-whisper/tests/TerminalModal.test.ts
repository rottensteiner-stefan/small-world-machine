/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { TerminalModal, DEFAULT_TERMINAL_DATA } from "../ui/TerminalModal.js";
import type { TextResolver } from "../ui/TextResolver.js";

/** Identity-Resolver: jede ID wird zum eigenen Namen — beweist, dass Button-Labels aus dem
 *  injizierten Resolver kommen und nicht hartkodierte Literale sind (ADR 0041 Stufe 4). */
function createTexts(overrides: Record<string, string> = {}): TextResolver {
  return {
    t: (id: string): string => overrides[id] ?? id,
  };
}

describe("TerminalModal Component", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("should initialize and render modal container in DOM", () => {
    const modal = new TerminalModal(createTexts());
    expect(modal).toBeDefined();
    expect(modal.isOpen).toBe(false);

    const root = document.getElementById("terminal-modal-root");
    expect(root).not.toBeNull();
    expect(root?.style.display).toBe("none");
  });

  it("should open and close correctly", () => {
    const modal = new TerminalModal(createTexts(), DEFAULT_TERMINAL_DATA);
    modal.open("case");
    expect(modal.isOpen).toBe(true);

    const root = document.getElementById("terminal-modal-root");
    expect(root?.style.display).toBe("flex");

    const content = document.getElementById("terminal-screen-content");
    expect(content?.innerHTML).toContain(DEFAULT_TERMINAL_DATA.deceasedName);
    expect(content?.innerHTML).toContain("Pollak");
    expect(content?.innerHTML).toContain("Brandstätter");

    modal.close();
    expect(modal.isOpen).toBe(false);
    expect(root?.style.display).toBe("none");
  });

  it("should switch tabs to logbook and diagnostics", () => {
    const modal = new TerminalModal(createTexts());
    modal.open("logbook");
    const content = document.getElementById("terminal-screen-content");
    expect(content?.innerHTML).toContain("terminal.logbook.header");
    expect(content?.innerHTML).toContain("terminal.logbook.task1.title");

    modal.open("diagnostics");
    expect(content?.innerHTML).toContain("terminal.diag.header");
    expect(content?.innerHTML).toContain("terminal.diag.powerVal");
  });

  it("should trigger onClose callbacks", () => {
    const modal = new TerminalModal(createTexts());
    const onCloseSpy = vi.fn();
    modal.onClose(onCloseSpy);

    modal.open();
    modal.close();
    expect(onCloseSpy).toHaveBeenCalledTimes(1);
  });

  it("renders hardware button labels through the injected resolver", () => {
    const modal = new TerminalModal(createTexts());
    expect(modal.isOpen).toBe(false);
    const root = document.getElementById("terminal-modal-root");
    const labels = Array.from(root?.querySelectorAll("button") ?? []).map(
      (btn) => (btn as HTMLButtonElement).innerText,
    );
    expect(labels).toContain("ui.terminal.akte");
    expect(labels).toContain("ui.terminal.logbuch");
    expect(labels).toContain("ui.terminal.status");
    expect(labels).toContain("ui.terminal.close");
  });

  it("renders casing header and case file fields through the injected resolver", () => {
    const modal = new TerminalModal(createTexts());
    modal.open("case");
    const root = document.getElementById("terminal-modal-root");
    expect(root?.innerHTML).toContain("terminal.header.title");
    expect(root?.innerHTML).toContain("terminal.header.serial");

    const content = document.getElementById("terminal-screen-content");
    expect(content?.innerHTML).toContain("terminal.case.header");
    expect(content?.innerHTML).toContain("terminal.case.sealed");
    expect(content?.innerHTML).toContain("terminal.case.lblCaseId");
    expect(content?.innerHTML).toContain("terminal.case.lblCitizen");
    expect(content?.innerHTML).toContain("terminal.case.sector");
    expect(content?.innerHTML).toContain("terminal.case.storageSlot");
    expect(content?.innerHTML).toContain("terminal.case.disposalDeadline");
    expect(content?.innerHTML).toContain("terminal.case.assignedOfficer");
    expect(content?.innerHTML).toContain("terminal.case.authorizingBureaucrat");
    expect(content?.innerHTML).toContain("terminal.case.note.0");

    modal.open("diagnostics");
    expect(content?.innerHTML).toContain("terminal.diag.lblRad");
    expect(content?.innerHTML).toContain("terminal.case.radiationLevel");
  });
});
