/**
 * Minimaler Vertrag für Text-ID → String-Auflösung (ADR 0041 Stufe 4).
 *
 * UI-Chrome hängt von dieser Schnittstelle ab, nie von einem konkreten Content-Paket: Die App
 * injiziert einen an die Manifest-`content.languages` gebundenen `ContentPackage`, Tests
 * injizieren Plain-Object-Fixtures. Es gibt keine Fallback-Quelle — ein Baustein, der einen
 * Resolver hält, MUSS darüber auflösen (kein Dual-Source, keine hartkodierten Literale).
 */
export interface TextResolver {
  /** Löst eine stabile Text-ID zu ihrem String auf. Fail-fast bei unbekannter ID. */
  t(id: string): string;
}

/**
 * Ersetzt `{key}`-Platzhalter in einer Vorlage durch die übergebenen Werte. Unbekannte
 * Platzhalter bleiben sichtbar, damit Tippfehler im Text-Deskriptor nie still verschluckt werden.
 */
export function formatText(
  template: string,
  params: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match: string, key: string): string => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}
