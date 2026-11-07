export function parseImageData(imageStr: string): { mimeType: string; data: string } {
  if (imageStr.startsWith("data:")) {
    const matches = imageStr.match(/^data:([^;]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      const mimeType = matches[1];
      const data = matches[2];
      if (mimeType !== undefined && data !== undefined) {
        return { mimeType, data };
      }
    }
  }
  return { mimeType: "image/png", data: imageStr };
}

type ModelToken = { type: "version"; numbers: number[] } | { type: "string"; text: string };

function tokenizeModelName(name: string): ModelToken[] {
  let clean = name.replace(/^models\//i, "");
  clean = clean.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$1$2$3");
  clean = clean.replace(/([a-zA-Z])-(\d+)-(\d+)(?=-|[a-zA-Z]|$)/g, "$1-$2.$3");

  const tokens: ModelToken[] = [];
  const regex = /(\d+(?:\.\d+)*)|([a-zA-Z]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(clean)) !== null) {
    if (match[1] !== undefined) {
      const numbers = match[1].split(".").map((n) => parseInt(n, 10));
      tokens.push({ type: "version", numbers });
    } else if (match[2] !== undefined) {
      tokens.push({ type: "string", text: match[2].toLowerCase() });
    }
  }

  return tokens;
}

export function compareModelsDescending(a: string, b: string): number {
  const tokensA = tokenizeModelName(a);
  const tokensB = tokenizeModelName(b);

  const minLen = Math.min(tokensA.length, tokensB.length);
  for (let i = 0; i < minLen; i++) {
    const tA = tokensA[i];
    const tB = tokensB[i];

    if (tA === undefined || tB === undefined) {
      return tokensA.length - tokensB.length;
    }

    if (tA.type === "version" && tB.type === "version") {
      const maxK = Math.max(tA.numbers.length, tB.numbers.length);
      for (let k = 0; k < maxK; k++) {
        const numA = tA.numbers[k] ?? 0;
        const numB = tB.numbers[k] ?? 0;
        if (numA !== numB) {
          return numB - numA;
        }
      }
    } else if (tA.type === "string" && tB.type === "string") {
      if (tA.text !== tB.text) {
        return tA.text.localeCompare(tB.text, undefined, { sensitivity: "base" });
      }
    } else {
      return tA.type === "version" ? -1 : 1;
    }
  }

  if (tokensA.length !== tokensB.length) {
    return tokensA.length - tokensB.length;
  }

  return a.localeCompare(b);
}

export function sortModelsDescending(models: string[]): string[] {
  return [...models].sort(compareModelsDescending);
}
