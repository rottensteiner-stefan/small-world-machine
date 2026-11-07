import type { ValidationReport } from "../types.js";
import { ensureIoStyles } from "./ioStyles.js";

/** Lists the findings of an import (errors, warnings, infos); closes on button, backdrop click or Escape. */
export class ValidationReportModal {
  public static show(
    report: ValidationReport,
    title: string,
    doc: Document = document,
  ): Promise<void> {
    ensureIoStyles(doc);
    return new Promise<void>((resolve) => {
      const backdrop: HTMLElement = doc.createElement("div");
      backdrop.className = "sw-io-modal-backdrop";
      const modal: HTMLElement = doc.createElement("div");
      modal.className = "sw-io-modal";
      modal.setAttribute("role", "dialog");

      const heading: HTMLElement = doc.createElement("h2");
      heading.textContent = title;
      const list: HTMLElement = doc.createElement("ul");
      for (const issue of report.issues) {
        const item: HTMLElement = doc.createElement("li");
        item.dataset["severity"] = issue.severity;
        const severity: HTMLElement = doc.createElement("strong");
        severity.className = "sw-io-sev";
        severity.textContent = `${issue.severity.toUpperCase()} `;
        item.append(severity, issue.message);
        if (issue.path) {
          const path: HTMLElement = doc.createElement("span");
          path.className = "sw-io-path";
          path.textContent = issue.path;
          item.appendChild(path);
        }
        list.appendChild(item);
      }
      const close: HTMLButtonElement = doc.createElement("button");
      close.textContent = "Close";

      const finish = (): void => {
        doc.removeEventListener("keydown", onKey);
        backdrop.remove();
        resolve();
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === "Escape") finish();
      };
      close.addEventListener("click", finish);
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) finish();
      });
      doc.addEventListener("keydown", onKey);

      modal.append(heading, list, close);
      backdrop.appendChild(modal);
      doc.body.appendChild(backdrop);
      close.focus();
    });
  }
}
