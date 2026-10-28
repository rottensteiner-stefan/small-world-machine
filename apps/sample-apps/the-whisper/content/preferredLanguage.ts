/**
 * Wählt die App-Inhaltssprache aus den deklarierten Content-Sprachen (ADR 0041 Stufe 4/5).
 * Sprache ist eine Einstellung, kein Spielinhalt: Der Browser-Wunsch wird gegen die verfügbaren
 * Pakete geprüft; nicht unterstützte Sprachen fallen auf die primäre Inhaltssprache zurück.
 * Der Default-Satz spiegelt `content.languages` von the-whisper in `app.json`.
 */
export function preferredLanguage(available: readonly string[] = ["de", "en"]): string {
  const requested =
    typeof navigator !== "undefined" ? navigator.language.split("-")[0]?.toLowerCase() : "";
  return requested && available.includes(requested) ? requested : "de";
}
