/**
 * Compiles an `IAssetSource.list(pattern)` glob into an anchored RegExp. Only `*` is a
 * wildcard (matches any run of characters, including `/`); every other character is literal,
 * so `.`, `+`, `(` ... in a file name never act as regex syntax and `*.png` does not match
 * `a.png.bak`.
 */
export function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`);
}
