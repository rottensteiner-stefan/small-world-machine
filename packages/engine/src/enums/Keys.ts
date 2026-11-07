/**
 * Key codes for user input.
 */
export const Keys = {
  /** Up arrow key. */
  UP: "ArrowUp",
  /** Down arrow key. */
  DOWN: "ArrowDown",
  /** Left arrow key. */
  LEFT: "ArrowLeft",
  /** Right arrow key. */
  RIGHT: "ArrowRight",
  /** Space bar. */
  SPACE: "Space",
  /** Enter key. */
  ENTER: "Enter",
  /** Escape key. */
  ESCAPE: "Escape",
  /** Tab key. */
  TAB: "Tab",
  /** Backspace key. */
  BACKSPACE: "Backspace",
  /** Left shift key. */
  SHIFT_L: "ShiftLeft",
  /** Right shift key. */
  SHIFT_R: "ShiftRight",
  /** Left control key. */
  CTRL_L: "ControlLeft",
  /** Right control key. */
  CTRL_R: "ControlRight",
  /** Left alt key. */
  ALT_L: "AltLeft",
  /** Right alt key. */
  ALT_R: "AltRight",
  /** Digit 0. */
  D0: "Digit0",
  /** Digit 1. */
  D1: "Digit1",
  /** Digit 2. */
  D2: "Digit2",
  /** Digit 3. */
  D3: "Digit3",
  /** Digit 4. */
  D4: "Digit4",
  /** Digit 5. */
  D5: "Digit5",
  /** Digit 6. */
  D6: "Digit6",
  /** Digit 7. */
  D7: "Digit7",
  /** Digit 8. */
  D8: "Digit8",
  /** Digit 9. */
  D9: "Digit9",
  /** Key A. */
  A: "KeyA",
  /** Key B. */
  B: "KeyB",
  /** Key C. */
  C: "KeyC",
  /** Key D. */
  D: "KeyD",
  /** Key E. */
  E: "KeyE",
  /** Key F. */
  F: "KeyF",
  /** Key G. */
  G: "KeyG",
  /** Key H. */
  H: "KeyH",
  /** Key I. */
  I: "KeyI",
  /** Key J. */
  J: "KeyJ",
  /** Key K. */
  K: "KeyK",
  /** Key L. */
  L: "KeyL",
  /** Key M. */
  M: "KeyM",
  /** Key N. */
  N: "KeyN",
  /** Key O. */
  O: "KeyO",
  /** Key P. */
  P: "KeyP",
  /** Key Q. */
  Q: "KeyQ",
  /** Key R. */
  R: "KeyR",
  /** Key S. */
  S: "KeyS",
  /** Key T. */
  T: "KeyT",
  /** Key U. */
  U: "KeyU",
  /** Key V. */
  V: "KeyV",
  /** Key W. */
  W: "KeyW",
  /** Key X. */
  X: "KeyX",
  /** Key Y. */
  Y: "KeyY",
  /** Key Z. */
  Z: "KeyZ",
} as const;

/** Type definition for Keys. */
export type Keys = (typeof Keys)[keyof typeof Keys];
