// Trailing `//…` comments on the directive line must not break parsing (H02): a future
// `#endif // USE_X` must not silently pass to WGSL, where it would be an uppercase-identifier
// chunk token and rebalance the shader.
const DIRECTIVE = /^\s*#\s*(ifdef|ifndef|else|endif)\b\s*(\w*)\s*(?:\/\/[^\n]*)?$/;

interface ConditionalFrame {
  /** The enclosing blocks are all active. */
  parentActive: boolean;
  /** This branch is active. */
  active: boolean;
  /** Some branch of this block already matched, so a later `#else` stays off. */
  matched: boolean;
}

/**
 * Minimal `#ifdef` / `#ifndef` / `#else` / `#endif` preprocessor for shader languages without one (WGSL),
 * keyed on the material's compile flags. Directive lines are removed and the lines of inactive branches
 * are dropped, so an unused feature costs no compile time (the GLSL tiers get the same effect from the
 * `#define` each flag becomes). Nesting is supported; every other line, including any `#` line that is not
 * one of these four directives, passes through untouched.
 * @param source The assembled shader source.
 * @param defined The flags that count as defined.
 * @returns The source with only the active branches left.
 */
export function preprocessConditionals(
  source: string,
  defined: ReadonlySet<string> | readonly string[],
): string {
  const isDefined = (name: string): boolean =>
    Array.isArray(defined) ? defined.includes(name) : (defined as ReadonlySet<string>).has(name);

  const stack: ConditionalFrame[] = [];
  const out: string[] = [];
  let active = true;
  for (const line of source.split("\n")) {
    const directive = DIRECTIVE.exec(line);
    if (!directive) {
      if (active) out.push(line);
      continue;
    }
    const kind = directive[1];
    const name = directive[2]!;
    if (kind === "ifdef" || kind === "ifndef") {
      const value = kind === "ifdef" ? isDefined(name) : !isDefined(name);
      stack.push({ parentActive: active, active: value, matched: value });
      active = active && value;
    } else if (kind === "else") {
      const frame = stack[stack.length - 1];
      if (!frame) throw new Error("[preprocessConditionals] #else without #ifdef/#ifndef");
      frame.active = !frame.matched;
      frame.matched = true;
      active = frame.parentActive && frame.active;
    } else {
      const frame = stack.pop();
      if (!frame) throw new Error("[preprocessConditionals] #endif without #ifdef/#ifndef");
      active = frame.parentActive;
    }
  }
  if (stack.length > 0) throw new Error("[preprocessConditionals] unterminated #ifdef/#ifndef");
  return out.join("\n");
}
