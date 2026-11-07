/**
 * Wires a range input: on `input` parses the value, optionally writes `format(value)` into the
 * label and forwards the number. Missing elements are skipped (panels may omit controls).
 */
export function bindRange(
  input: HTMLInputElement | null,
  label: HTMLElement | null,
  format: ((value: number) => string) | null,
  onValue: (value: number) => void,
): void {
  if (!input) return;
  input.addEventListener("input", () => {
    const value = parseFloat(input.value);
    if (label && format) label.textContent = format(value);
    onValue(value);
  });
}
