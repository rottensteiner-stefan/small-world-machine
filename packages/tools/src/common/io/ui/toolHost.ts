/**
 * Whether `root` belongs to the tool that should react to window-level input (drops, pastes,
 * keys). Inside a Forge window that is the topmost visible window; outside a Forge window the
 * tool is always the active host. Window-level listeners of several tools share one document, so
 * every one of them must ask this before acting.
 */
export function isActiveToolHost(root: HTMLElement): boolean {
  const own = root.closest<HTMLElement>(".swf-window");
  if (null === own) return true;
  if (0 === own.getClientRects().length) return false; // window or Forge overlay hidden
  const zIndexOf = (el: HTMLElement): number => parseInt(el.style.zIndex || "0", 10);
  for (const other of document.querySelectorAll<HTMLElement>(".swf-window")) {
    if (other === own || 0 === other.getClientRects().length) continue;
    if (zIndexOf(other) > zIndexOf(own)) return false;
  }
  return true;
}
