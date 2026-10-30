/**
 * TerminalModal — Das Amts-Terminal 2100 & Amtsrat 4.1 UI
 *
 * Ein taktischer, robuster Vorkriegs-Feldcomputer mit bernsteinfarbenem
 * LC-Display, Scanlines, Pixelfehlern und mechanischen Druckknöpfen (Non-Touch).
 */

import type { TextResolver } from "./TextResolver.js";

export interface TerminalData {
  caseId: string;
  deceasedName: string;
  birthYear: number;
  deathYear: number;
  sector: string;
  storageSlot: string;
  disposalDeadline: string;
  assignedOfficer: string;
  authorizingBureaucrat: string;
  radiationLevel: string;
  notes: string[];
}

export const DEFAULT_TERMINAL_DATA: TerminalData = {
  caseId: "GZ 2100-AZS/S-3/STERBEFALL-0815",
  deceasedName: "František Novotny",
  birthYear: 2005,
  deathYear: 2100,
  sector: "Sektor 0 (Unterer Maschinenstrang / Kühlbereich)",
  storageSlot: "Kältekammer Fach K-42",
  disposalDeadline: "48:00 Stunden bis chemische Verwertung",
  assignedOfficer: "Ober-Inspektor Pollak (Schleusenwache Arenberg)",
  authorizingBureaucrat: "Hofrat Brandstätter (Zentralreferat Rossauer Kaserne)",
  radiationLevel: "0.12 mSv/h (Kühlstrang kontaminiert)",
  notes: [
    "Todesursache offiziell: 'Herz-Kreislauf-Versagen im Alter'.",
    "Asservate: Alle Habseligkeiten konfisziert & in Kanzlei gesperrt.",
    "Glitch-Fragment [Ref. B-2050]: Akteneinsicht für Angehörige strengstens untersagt.",
  ],
};

export function createDefaultTerminalData(texts: TextResolver): TerminalData {
  return {
    caseId: "GZ 2100-AZS/S-3/STERBEFALL-0815",
    deceasedName: "František Novotny",
    birthYear: 2005,
    deathYear: 2100,
    sector: texts.t("terminal.case.sector"),
    storageSlot: texts.t("terminal.case.storageSlot"),
    disposalDeadline: texts.t("terminal.case.disposalDeadline"),
    assignedOfficer: texts.t("terminal.case.assignedOfficer"),
    authorizingBureaucrat: texts.t("terminal.case.authorizingBureaucrat"),
    radiationLevel: texts.t("terminal.case.radiationLevel"),
    notes: [
      texts.t("terminal.case.note.0"),
      texts.t("terminal.case.note.1"),
      texts.t("terminal.case.note.2"),
    ],
  };
}

export class TerminalModal {
  private _container: HTMLDivElement | null = null;
  private _isOpen: boolean = false;
  private _activeTab: "case" | "logbook" | "diagnostics" = "case";
  private _data: TerminalData;
  private readonly _texts: TextResolver;
  private _onCloseCallbacks: (() => void)[] = [];

  constructor(texts: TextResolver, data?: TerminalData) {
    this._texts = texts;
    this._data = data ?? createDefaultTerminalData(texts);
    this._createModal();
    this._bindGlobalKey();
  }

  public get isOpen(): boolean {
    return this._isOpen;
  }

  public onClose(cb: () => void): void {
    this._onCloseCallbacks.push(cb);
  }

  public open(tab: "case" | "logbook" | "diagnostics" = "case"): void {
    if (!this._container) return;
    this._activeTab = tab;
    this._renderScreenContent();
    this._container.style.display = "flex";
    this._isOpen = true;
  }

  public close(): void {
    if (!this._container) return;
    this._container.style.display = "none";
    this._isOpen = false;
    this._onCloseCallbacks.forEach((cb) => cb());
  }

  public toggle(): void {
    if (this._isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private _bindGlobalKey(): void {
    window.addEventListener("keydown", (e) => {
      if (e.key === "t" || e.key === "T") {
        // Toggle terminal with 'T'
        this.toggle();
      } else if (e.key === "Escape" && this._isOpen) {
        this.close();
      }
    });
  }

  private _createModal(): void {
    const existing = document.getElementById("terminal-modal-root");
    if (existing) existing.remove();

    const root = document.createElement("div");
    root.id = "terminal-modal-root";
    root.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(4, 5, 8, 0.88);
      backdrop-filter: blur(12px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      font-family: var(--font-mono, "JetBrains Mono", monospace);
      color: #ffb84d;
      user-select: none;
    `;

    // Tactical Rugged Housing
    const casing = document.createElement("div");
    casing.style.cssText = `
      position: relative;
      width: 90%;
      max-width: 680px;
      background: #181b22;
      border: 3px solid #323846;
      border-radius: 16px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.9), inset 0 2px 4px rgba(255, 255, 255, 0.1);
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.2rem;
    `;

    // Header with Model Tag & Screws
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid #2a303c;
      padding-bottom: 0.8rem;
    `;
    header.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.8rem;">
        <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 10px #22c55e;"></span>
        <strong style="color: #e2e8f0; font-size: 0.95rem; letter-spacing: 1px;">${this._texts.t("terminal.header.title")}</strong>
      </div>
      <span style="font-size: 0.75rem; color: #64748b; letter-spacing: 1px;">${this._texts.t("terminal.header.serial")}</span>
    `;
    casing.appendChild(header);

    // Screen Area (Monochrome Amber CRT/LCD with scanlines)
    const screenFrame = document.createElement("div");
    screenFrame.style.cssText = `
      position: relative;
      background: #0d0f12;
      border: 2px solid #282e3a;
      border-radius: 8px;
      padding: 1.25rem;
      min-height: 280px;
      overflow: hidden;
      box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.9);
    `;

    // Scanlines Effect
    const scanlines = document.createElement("div");
    scanlines.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.35) 50%);
      background-size: 100% 4px;
      pointer-events: none;
      z-index: 5;
    `;
    screenFrame.appendChild(scanlines);

    const screenBody = document.createElement("div");
    screenBody.id = "terminal-screen-content";
    screenBody.style.cssText = `
      position: relative;
      z-index: 2;
      font-size: 0.9rem;
      line-height: 1.6;
      color: #ffb84d;
      text-shadow: 0 0 8px rgba(255, 184, 77, 0.5);
    `;
    screenFrame.appendChild(screenBody);
    casing.appendChild(screenFrame);

    // Hardware Button Bar (Physical Click Buttons)
    const btnBar = document.createElement("div");
    btnBar.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.8rem;
    `;

    const tabsGroup = document.createElement("div");
    tabsGroup.style.cssText = "display: flex; gap: 0.6rem;";

    const btnCase = this._createHwButton(this._texts.t("ui.terminal.akte"), () => {
      this._activeTab = "case";
      this._renderScreenContent();
    });
    const btnLog = this._createHwButton(this._texts.t("ui.terminal.logbuch"), () => {
      this._activeTab = "logbook";
      this._renderScreenContent();
    });
    const btnDiag = this._createHwButton(this._texts.t("ui.terminal.status"), () => {
      this._activeTab = "diagnostics";
      this._renderScreenContent();
    });

    tabsGroup.appendChild(btnCase);
    tabsGroup.appendChild(btnLog);
    tabsGroup.appendChild(btnDiag);
    btnBar.appendChild(tabsGroup);

    const btnClose = this._createHwButton(
      this._texts.t("ui.terminal.close"),
      () => this.close(),
      true,
    );
    btnBar.appendChild(btnClose);

    casing.appendChild(btnBar);
    root.appendChild(casing);
    document.body.appendChild(root);
    this._container = root;

    // Close on backdrop click
    root.addEventListener("click", (e) => {
      if (e.target === root) this.close();
    });
  }

  private _createHwButton(label: string, onClick: () => void, isDanger = false): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.innerText = label;
    btn.style.cssText = `
      background: ${isDanger ? "#2c1a1a" : "#222733"};
      color: ${isDanger ? "#f87171" : "#cbd5e1"};
      border: 1px solid ${isDanger ? "#7f1d1d" : "#3b4457"};
      border-bottom: 3px solid ${isDanger ? "#450a0a" : "#1e232d"};
      border-radius: 6px;
      padding: 0.6rem 1rem;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 1px;
      font-family: monospace;
      cursor: pointer;
      transition: all 0.1s ease;
    `;
    btn.addEventListener("mousedown", () => {
      btn.style.transform = "translateY(2px)";
      btn.style.borderBottomWidth = "1px";
    });
    btn.addEventListener("mouseup", () => {
      btn.style.transform = "none";
      btn.style.borderBottomWidth = "3px";
    });
    btn.addEventListener("click", onClick);
    return btn;
  }

  private _renderScreenContent(): void {
    const el = document.getElementById("terminal-screen-content");
    if (!el) return;

    if (this._activeTab === "case") {
      el.innerHTML = `
        <div style="border-bottom: 1px dashed rgba(255, 184, 77, 0.4); padding-bottom: 0.5rem; margin-bottom: 0.8rem; display: flex; justify-content: space-between;">
          <span>${this._texts.t("terminal.case.header")}</span>
          <span style="color: #ef4444; font-weight: bold;">${this._texts.t("terminal.case.sealed")}</span>
        </div>
        <div style="margin-bottom: 0.4rem;"><strong>${this._texts.t("terminal.case.lblCaseId")}</strong> ${this._data.caseId}</div>
        <div style="margin-bottom: 0.4rem;"><strong>${this._texts.t("terminal.case.lblCitizen")}</strong> ${this._data.deceasedName} (*${this._data.birthYear} — †${this._data.deathYear})</div>
        <div style="margin-bottom: 0.4rem;"><strong>${this._texts.t("terminal.case.lblSector")}</strong> ${this._data.sector}</div>
        <div style="margin-bottom: 0.4rem; color: #fbbf24;"><strong>${this._texts.t("terminal.case.lblStorage")}</strong> ${this._data.storageSlot}</div>
        <div style="margin-bottom: 0.8rem; color: #f87171;"><strong>${this._texts.t("terminal.case.lblDeadline")}</strong> ${this._data.disposalDeadline}</div>
        <div style="margin-bottom: 0.4rem; font-size: 0.8rem; color: #94a3b8;"><strong>${this._texts.t("terminal.case.lblOfficer")}</strong> ${this._data.assignedOfficer}</div>
        <div style="margin-bottom: 0.8rem; font-size: 0.8rem; color: #94a3b8;"><strong>${this._texts.t("terminal.case.lblAuthority")}</strong> ${this._data.authorizingBureaucrat}</div>
        <div style="border-top: 1px dashed rgba(255, 184, 77, 0.3); padding-top: 0.6rem; font-size: 0.82rem; color: #fdba74;">
          ${this._data.notes.map((n) => `<div>&bull; ${n}</div>`).join("")}
        </div>
      `;
    } else if (this._activeTab === "logbook") {
      el.innerHTML = `
        <div style="border-bottom: 1px dashed rgba(255, 184, 77, 0.4); padding-bottom: 0.5rem; margin-bottom: 0.8rem;">
          <span>${this._texts.t("terminal.logbook.header")}</span>
        </div>
        <div style="margin-bottom: 0.8rem;">
          <span style="color: #22c55e;">${this._texts.t("terminal.logbook.active")}</span> <strong>${this._texts.t("terminal.logbook.task1.title")}</strong><br/>
          &rarr; ${this._texts.t("terminal.logbook.task1.line0")}<br/>
          &rarr; ${this._texts.t("terminal.logbook.task1.line1")}
        </div>
        <div style="margin-bottom: 0.8rem;">
          <span style="color: #94a3b8;">${this._texts.t("terminal.logbook.pending")}</span> <strong>${this._texts.t("terminal.logbook.task2.title")}</strong><br/>
          &rarr; ${this._texts.t("terminal.logbook.task2.line0")}
        </div>
        <div style="font-size: 0.82rem; color: #94a3b8; border-top: 1px dashed rgba(255, 184, 77, 0.3); padding-top: 0.6rem;">
          ${this._texts.t("terminal.logbook.hint")}
        </div>
      `;
    } else {
      el.innerHTML = `
        <div style="border-bottom: 1px dashed rgba(255, 184, 77, 0.4); padding-bottom: 0.5rem; margin-bottom: 0.8rem;">
          <span>${this._texts.t("terminal.diag.header")}</span>
        </div>
        <div style="margin-bottom: 0.5rem;"><strong>${this._texts.t("terminal.diag.lblStatus")}</strong> ${this._texts.t("terminal.diag.statusVal")}</div>
        <div style="margin-bottom: 0.5rem;"><strong>${this._texts.t("terminal.diag.lblRad")}</strong> ${this._data.radiationLevel}</div>
        <div style="margin-bottom: 0.5rem;"><strong>${this._texts.t("terminal.diag.lblAi")}</strong> ${this._texts.t("terminal.diag.aiVal")}</div>
        <div style="margin-bottom: 0.8rem; color: #fbbf24;"><strong>${this._texts.t("terminal.diag.lblPower")}</strong> ${this._texts.t("terminal.diag.powerVal")}</div>
        <div style="border-top: 1px dashed rgba(255, 184, 77, 0.3); padding-top: 0.6rem; font-size: 0.82rem; color: #64748b;">
          ${this._texts.t("terminal.diag.msg")}
        </div>
      `;
    }
  }
}
