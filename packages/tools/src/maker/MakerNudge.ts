/**
 * Pure key -> delta resolution for the Maker arrow-key nudge (extracted from
 * `MakerApp.nudgeSelection`). No engine or DOM state: the caller supplies the step size
 * (already snap- and Shift-adjusted) and, for translation, the camera's forward direction.
 * A zero delta means "this key does nothing in this mode".
 */

export interface NudgeDelta {
  x: number;
  y: number;
  z: number;
}

const ZERO: NudgeDelta = { x: 0, y: 0, z: 0 };

/** Rotate mode: PageUp/Down = roll (z), Left/Right = yaw (y), Up/Down = pitch (x). */
export function nudgeRotationDelta(key: string, angle: number): NudgeDelta {
  switch (key) {
    case "PageUp":
      return { x: 0, y: 0, z: angle };
    case "PageDown":
      return { x: 0, y: 0, z: -angle };
    case "ArrowLeft":
      return { x: 0, y: angle, z: 0 };
    case "ArrowRight":
      return { x: 0, y: -angle, z: 0 };
    case "ArrowUp":
      return { x: -angle, y: 0, z: 0 };
    case "ArrowDown":
      return { x: angle, y: 0, z: 0 };
    default:
      return { ...ZERO };
  }
}

/** Scale mode: PageUp/Down = height (y), Left/Right = width (x), Up/Down = depth (z). */
export function nudgeScaleDelta(key: string, step: number): NudgeDelta {
  switch (key) {
    case "PageUp":
      return { x: 0, y: step, z: 0 };
    case "PageDown":
      return { x: 0, y: -step, z: 0 };
    case "ArrowLeft":
      return { x: -step, y: 0, z: 0 };
    case "ArrowRight":
      return { x: step, y: 0, z: 0 };
    case "ArrowUp":
      return { x: 0, y: 0, z: -step };
    case "ArrowDown":
      return { x: 0, y: 0, z: step };
    default:
      return { ...ZERO };
  }
}

/**
 * Translate mode with camera-cardinal alignment: the arrow directions match the on-screen
 * perspective by snapping the camera's ground-plane forward vector (`camForwardX/Z`) to the
 * dominant world axis. A degenerate forward (looking straight down) falls back to -Z.
 */
export function nudgeTranslateDelta(
  key: string,
  step: number,
  camForwardX: number,
  camForwardZ: number,
): NudgeDelta {
  let fx = camForwardX;
  let fz = camForwardZ;
  if (fx * fx + fz * fz < 0.0001) {
    fx = 0;
    fz = -1;
  }
  let fwdX = 0;
  let fwdZ = 0;
  let rgtX = 0;
  let rgtZ = 0;
  if (Math.abs(fz) >= Math.abs(fx)) {
    fwdZ = fz > 0 ? 1 : -1;
    rgtX = -fwdZ;
  } else {
    fwdX = fx > 0 ? 1 : -1;
    rgtZ = fwdX;
  }
  switch (key) {
    case "PageUp":
      return { x: 0, y: step, z: 0 };
    case "PageDown":
      return { x: 0, y: -step, z: 0 };
    case "ArrowLeft":
      return { x: -rgtX * step, y: 0, z: -rgtZ * step };
    case "ArrowRight":
      return { x: rgtX * step, y: 0, z: rgtZ * step };
    case "ArrowUp":
      return { x: fwdX * step, y: 0, z: fwdZ * step };
    case "ArrowDown":
      return { x: -fwdX * step, y: 0, z: -fwdZ * step };
    default:
      return { ...ZERO };
  }
}

export function isZeroDelta(d: NudgeDelta): boolean {
  return 0 === d.x && 0 === d.y && 0 === d.z;
}
