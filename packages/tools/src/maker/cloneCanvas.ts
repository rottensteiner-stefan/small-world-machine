/** Independent pixel copy of `source` (new canvas, same size). Returns the copy even when the 2D
 *  context is unavailable (then it stays blank) so callers never receive the live source. */
export function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext("2d")?.drawImage(source, 0, 0);
  return copy;
}
