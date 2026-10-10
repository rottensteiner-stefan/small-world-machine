# 2.5D-Bühnen-Zonen: Eine neue `SWM_stage_zone`-glTF-Erweiterung, kein zweites Format

## Kontext & Problem

`StageZone` und `StageMovementBehavior` (hinzugefügt beim Bau von "And Now?"s Szenen `flakturm-tunnel` und `character-diorama`, siehe `docs/guides/2-5d-scenes.md`) lassen eine Szene einen gemalten oder echten Boden als Handvoll `(u, v, scale)`-Polygonpunkte definieren, aus denen die Blickrichtung einer Figur auf dem Bildschirm und ihre erzwungene Perspektivgröße zur Laufzeit abgeleitet werden. Heute bedeutet das Erstellen einer Zone, `DEFAULT_ZONE_POINTS`-Literale direkt in der `showcase.ts` einer Szene von Hand zu schreiben und sie im Browser-Tab gegen die Hintergrundkunst über den Daumen zu peilen — es gibt kein visuelles Werkzeug, und nichts an einer Zone kann außerhalb des TypeScript-Quellcodes gespeichert oder neu geladen werden.

Maker (ADR 0010) hat die allgemeine Version dieses Problems für 3D-Welten bereits gelöst: glTF 2.0 als Basisformat, Engine-spezifische Daten (Behaviors, Physik-Konfiguration, Nicht-PBR-Materialfelder) in `SWM_*`-Vendor-Erweiterungen transportiert, `WorldWriter`/`GltfLoader` als Lese-/Schreib-Paar. Die Frage, die dieser ADR beantwortet, ist enger gefasst: Wie fügen sich 2.5D-Bühnen-Erstellungsdaten — die überhaupt kein glTF-Äquivalent haben — in dieselbe Pipeline ein, ohne sie in ein zweites, paralleles Speicherformat zu verzweigen.

Drei Dinge an der heutigen Laufzeit-Form passen nicht direkt:

1. **`StageZone` ist reine Daten ohne Szenengraph-Präsenz.** Ihre `(u, v, scale)`-Punkte sind an kein `Object3D` angehängt — eine Zone kann nicht ausgewählt, in einem Hierarchie-Panel gelistet oder über eine Objekt-ID referenziert werden, wie alles andere in Maker es kann.
2. **`StageZone.points` ist auf exakt vier Ecken fixiert** (`StageZoneOptions.points: [P, P, P, P]`), passend zu jeder bisher von Hand geschriebenen Zone — aber nicht das, was ein allgemeines Zeichenwerkzeug bieten sollte. Klassische 2.5D-Walk-Boxen (SCUMM, Grim Fandango) sind beliebige *n*-Ecke, und ein fixes Viereck erzwingt unbeholfene Kompromisse, sobald eine begehbare Form kein sauberes Viereck ist.
3. **`StageMovementBehavior.uvToWorld` ist eine beliebige Closure, keine Daten.** Jede bestehende Szene übergibt eine andere, von Hand geschriebene Funktion (`flakturm-tunnel`s bäckt Breite/Höhe/Z einer gemalten Ebene ein; `character-diorama`s — in dieser selben Sitzung hinzugefügt — bäckt die Halbausdehnung eines echten Bodens ein). Eine Closure kann nicht als JSON geschrieben und zurückgelesen werden; Maker könnte eine von ihm gespeicherte Bühnen-Szene nie tatsächlich rekonstruieren.

## Entscheidung

### 1. Jede `StageZone` wird zu einem leichtgewichtigen glTF-Node, der `SWM_stage_zone` trägt

Eine Zone erhält ihren eigenen Marker-Node in der glTF-Node-Hierarchie (kein Mesh, passend dazu, wie Maker bereits nicht renderbare Helfer darstellt), mit:

```json
{
  "name": "zone_a",
  "extensions": {
    "SWM_stage_zone": {
      "displayName": "ZONE A: HAUPTBÜHNE (VORPLATZ)",
      "points": [
        { "u": 0.459, "v": 0.895, "scale": 1.0 },
        { "u": 0.825, "v": 0.893, "scale": 1.0 },
        { "u": 0.774, "v": 0.82, "scale": 1.0 },
        { "u": 0.509, "v": 0.823, "scale": 1.0 }
      ]
    }
  }
}
```

Das macht eine Zone zu einem erstklassigen, auswählbaren Objekt in Makers bestehendem Hierarchie-Panel und Picking-System — konsistent damit, dass alles andere Editierbare in Maker ein Node ist —, statt eines unsichtbaren Klumpens, der am Behavior hängt, das zufällig auf sie verweist.

### 2. `StageZone.points` wird zu einem Polygon beliebiger Länge, kein festes 4-Tupel

`StageZoneOptions.points` ist aktuell als `[StagePoint2D, StagePoint2D, StagePoint2D, StagePoint2D]` typisiert — exakt vier Ecken. Die *Engine*, aus der dieses Muster stammt (SCUMM, 1987), ist längst tot, aber das Muster selbst — ein begehbares Polygon mit beliebig vielen Seiten, direkt auf die Kunst gezeichnet, kein festes Viereck — ist kein Retro-Artefakt, das nur aus Trägheit noch herumhängt; es ist dasselbe Primitiv unter anderen Namen in jedem aktuellen Werkzeug, das dasselbe Problem lösen muss (eine flache oder nahezu flache begehbare Grundfläche): Unitys `PolygonCollider2D`/gebackene NavMesh, Godots `NavigationPolygon`, und — näher an genau diesem Genre — die aktiv gepflegten AGS und Visionaire Studio, die beide einen Wegbereich immer noch als von Hand gezeichnetes Polygon direkt auf dem Hintergrundbild zeichnen. Ein Korridor, der sich krümmt, eine schräg geschnittene Türöffnung oder ein unregelmäßiger Schutthaufen brauchen alle mehr als vier Punkte, um akkurat gezeichnet zu werden, und ein Viereck einer solchen Form aufzuzwingen erzeugt genau die Art "Kante schneidet durch die Kunst"-Fehler, die der Zone-C-Fix (siehe `.agents/notes/backlog.md`, 2026-09-11) bereits einmal *innerhalb* eines Vierecks aufgefangen hat. Der Typ wird zu `StagePoint2D[]` (Minimum 3), auf dem naheliegenden Weg in Maker erstellt: Punkt 1, 2, 3, … *n* der Reihe nach am Umfang anklicken, das Polygon schließt sich beim Abschluss automatisch zurück zu Punkt 1 — kein separater "Schleife schließen"-Schritt.

Zwei von `StageZone`s drei Algorithmen behandeln eine beliebige Punktzahl bereits ohne jede Änderung:
- **`containsPoint`** (Ray-Casting/Even-Odd-Regel) und **`clampToPolygon`** (nächstgelegener Punkt über alle Kanten) laufen beide schon über `for (i = 0..points.length)` — nichts an beiden ist heute vierecksspezifisch.

Der dritte, **`getScaleAt`**, ist aktuell ein Fächer aus exakt zwei Dreiecken ab `P0` (`P0-P1-P2`, dann `P0-P2-P3`) — ein fester Sonderfall der Fächer-Triangulation, kein grundlegend nur-für-Vierecke-Algorithmus. Ihn auf einen Fächer aus `points.length - 2` Dreiecken ab `P0` zu verallgemeinern (jedes der Reihe nach probieren, das nehmen, das den Abfragepunkt enthält) ist eine direkte Erweiterung des bestehenden Codes, bleibt bei `O(n)` pro Abfrage — dieselben asymptotischen Kosten, die `containsPoint` schon zahlt — und **ist bei `n = 4` exakt das heutige Verhalten**, sodass jede bestehende Zone (`zone_a`/`zone_b`/`zone_c`, der Diorama-Boden) mit byte-identischen Ergebnissen durch die verallgemeinerte Version läuft. Keine neue Mathematik, keine Migration.

### 3. `getLocalAxes()`s feste Vorwärts-/Rechts-Basis wird durch einen Skalierungs-Gradienten pro Punkt ersetzt

Eine einzelne, feste "Vorwärts"-Richtung pro Zone (heute: abgeleitet davon, welches Paar der 4 Ecken in welche Richtung zeigt) hat keine wohldefinierte Verallgemeinerung auf ein beliebiges Polygon — ein Fünfeck hat keine eindeutige "gegenüberliegende Kante". Statt eine Erstellungs-Konvention zu erfinden, um eine vorzutäuschen (z. B. "Punkt 0/1 sind immer die Nahkante"), leitet `StageMovementBehavior` die lokale Laufrichtung aus denselben Skalierungsdaten ab, die die Zone bereits trägt: An der aktuellen Position der Figur ist **"vorwärts" die Richtung, in der die interpolierte Skalierung am schnellsten abnimmt** (der Gradient des Skalierungsfelds, berechnet aus derselben Fächer-Triangulation, die `getScaleAt` ohnehin schon macht — billig, keine zusätzlichen Daten), und "rechts" ist diese Richtung um 90° gedreht. Das ist *korrekter* als eine feste Basis pro Zone, sogar für die bestehenden Vierecke, da es auf die wahre lokale Form des Skalierungsabfalls an jedem Punkt reagiert statt auf eine gemittelte Richtung für die ganze Zone, und es kostet nichts Neues zu berechnen — das Skalierungsfeld ist schon da.

### 4. `StageMovementBehaviorOptions.uvToWorld` wechselt von einer Funktion zu Daten

Das ist die eine wirklich bahnbrechende Änderung, die dieser ADR einführt, und der Grund, warum es ein ADR ist statt einer Routine-Ergänzung. `uvToWorld` wird statt eines Callbacks zu einer kleinen getaggten Union:

```typescript
type StageProjection =
  | { mode: "flat-plane"; width: number; height: number; z: number; centerY: number }
  | { mode: "custom" }; // Fluchtluke, siehe Konsequenzen
```

`"flat-plane"` deckt jede heute existierende Szene ab — sowohl `flakturm-tunnel`s gemalte Hintergrundebene als auch `character-diorama`s echtes quadratisches Bodenstück reduzieren sich auf exakt dieselbe lineare Formel (`x = (u - 0.5) * width`, `z`/`y` analog), nur mit unterschiedlichen Konstanten. Die Engine berechnet das tatsächliche `(x, y, z)` intern aus diesen vier Zahlen; nichts an der *Form* der Mathematik muss mehr pro Szene von Hand geschrieben werden, nur ihre Parameter — genau das, was ein Maker-Eigenschaftspanel bearbeitet.

### 5. Fluchtpunkt-Referenzlinien werden ebenfalls gespeichert, nicht nur als flüchtiger Editor-Zustand

Das interaktive Fluchtpunkt-Werkzeug (zwei Referenzlinien zeichnen, ihren Schnittpunkt erhalten — siehe die praktischen Schritte in `docs/guides/2-5d-scenes.md` §4) erzeugt genau die Art Begründung, die die eigene Praxis eines ADRs wertschätzt: *warum* eine Zonenkante dort sitzt, wo sie sitzt. Sie beim Schließen zu verwerfen würde bedeuten, sie jedes Mal, wenn eine Zone erneut geprüft werden muss, wieder von Auge herzuleiten (wie es für den Zone-C-Fix in dieser Sitzung von Hand geschah). Eine kleine `SWM_stage_vanishing_point`-Erweiterung (Referenzlinien-Endpunkte + der berechnete Punkt) reitet auf ihrem eigenen Marker-Node, genauso wie Zonen — optional, additiv und zur Laufzeit rein eine Provenienz-/Nachprüfungshilfe (nichts liest sie außerhalb des Editors).

### Verworfene Alternativen

- **Ein zweites, nur für 2.5D gedachtes Speicherformat.** Verworfen aus demselben Grund, aus dem ADR 0010 ein eigens entworfenes 3D-Format verworfen hat: Es würde Makers einzige Speicher-/Lade-Pipeline in zwei inkompatible Welten aufspalten, sobald ein Projekt sowohl eine 3D-Welt als auch eine 2.5D-Bühne braucht (heute bereits der Fall — "And Now?" hat beides).
- **Zonenpolygone als echte glTF-Mesh-/Accessor-Geometrie kodieren** (ein buchstäbliches Viereck-Mesh pro Zone). Verworfen — Zonen sind keine renderbare Geometrie, sie durch Mesh-/Accessor-/BufferView-Maschinerie zu zwingen passt schlechter als eine schlichte, kleine JSON-Erweiterung, und es würde die `(u, v, scale)`-Form, die die Laufzeit tatsächlich konsumiert, hinter einer Übersetzungsschicht bei jedem Laden verbergen.
- **`uvToWorld` auf unbestimmte Zeit als beliebige Funktion beibehalten, von Maker nicht unterstützt.** Verworfen — das ist die eine Option, die am eigentlichen Ziel scheitert: Maker könnte die Punkte einer Zone bearbeiten, aber nie selbst eine funktionierende Szene erzeugen, da es keine Möglichkeit hat, die Projektion zu erstellen, gegen die die Punkte gesetzt sind.
- **Das feste 4-Punkte-Viereck beibehalten, keine Unterstützung für beliebige Polygone.** Verworfen — kurzfristig billiger, aber genau die Einschränkung, die sich in jedem künftigen unregelmäßig geformten Wegbereich sichtbar als Erstellungs-Kompromiss zeigen würde (eine zusätzliche, unnötige Zonen-Teilung nur, um die "immer 4 Ecken"-Grenze zu umgehen), ohne echte Ersparnis: Wie oben gezeigt, kostet die Verallgemeinerung keinen neuen Algorithmus, nur einen erweiterten Typ und eine erweiterte Schleifengrenze.
- **Eine feste Erstellungs-Konvention für "vorwärts" statt des Skalierungs-Gradienten** (z. B. "Punkte 0/1 sind immer die Nahkante, Punkte am Mittelindex sind immer die Fernkante"). Verworfen — wohldefiniert für ein Viereck, aber willkürlich und zerbrechlich für echte *n*-Ecke (welche zwei von fünf Punkten sind "gegenüberliegend"?), und es würde die *Reihenfolge* der Ecken tragend machen, auf eine Weise, die leicht subtil falsch wird, wenn eine Form von Hand gezeichnet wird.

### Stufenweise Umsetzung

0. **Engine-Voraussetzung** — `StageZone.points` erweitert sich von einem festen 4-Tupel zu `StagePoint2D[]` (§2), `getScaleAt` verallgemeinert sich zu einem `n - 2`-Dreiecks-Fächer (§2), `getLocalAxes()` wird durch die Skalierungs-Gradienten-Richtung pro Punkt ersetzt (§3), `uvToWorld` wird zur `StageProjection`-Union (§4). `StageMovementBehavior` erhält einen befüllten `static inspector` (erster echter Nutzer des Reflection-Vertrags, den ADR 0010 §1 definiert hat, den aber bisher keine konkrete `Behavior`-Unterklasse tatsächlich befüllt). `flakturm-tunnel` und `character-diorama` werden auf `"flat-plane"` portiert; beide durchlaufen jeden verallgemeinerten Algorithmus oben mit identischem Ergebnis, da beide bereits der Fall `n = 4` sind.
1. **Format** — `SWM_stage_zone`-Lesen/Schreiben in `GltfLoader`/`WorldWriter`, Roundtrip-Test gegen eine von Hand geschriebene Fixture (ein Viereck und ein 6-Punkte-Polygon, um den allgemeinen Fall zu prüfen).
2. **Maker-UI** — ein Hintergrundbild auf eine `Plane` importieren, Zonenpolygone direkt darauf zeichnen (Punkt 1, 2, 3, … *n* anklicken, schließt sich automatisch), `scale`-Feld pro Punkt, Zonen im Hierarchie-Panel wie jeder andere Node gelistet und auswählbar.
3. **Perspektiv-Werkzeuge** — das interaktive Fluchtpunkt-Werkzeug (§5 oben) und optionales Snapping (auf eine Fluchtlinie, auf die Tiefe einer benachbarten Zone, auf waagerecht), aufgebaut auf 1-2.
4. **KI-Chat-Panel.** Für diesen ADR explizit außerhalb des Umfangs — ein szenen-bewusstes Assistenz-Panel ist ein eigenes Anliegen (UI-Oberfläche + sein eigener Tool-Aufruf-Vertrag), das auf einem funktionierenden Speicherformat aufbaut, keine Voraussetzung dafür.

## Konsequenzen

- **Bahnbrechende Änderung an `StageMovementBehaviorOptions`.** Jede Szene, die `uvToWorld` für etwas nutzt, das die `"flat-plane"`-Form nicht ausdrücken kann, braucht die `"custom"`-Fluchtluke (ein von Hand geschriebener Callback, genau wie heute, nur explizit gewählt) — akzeptiert, da beide heute existierenden Szenen exakt in `"flat-plane"` passen, ohne Verhaltensverlust.
- **Szenen im `"custom"`-Modus bleiben außerhalb von Makers Roundtrip.** Eine Szene, die die Fluchtluke nutzt, kann von der Engine *geladen*, aber von Maker nicht originalgetreu *neu gespeichert* werden (die Closure sind keine Daten) — eine explizite, benannte Einschränkung statt einer stillen.
- **Ein neuer, nicht renderbarer Node-Typ in Makers Hierarchie.** Zonen- und Fluchtpunkt-Marker brauchen ihr eigenes Icon und eine eigene Picking-Behandlung (sie haben kein Mesh) — eine kleine, eingegrenzte Ergänzung zu Makers bestehender Node-Typ-Behandlung, kein neues Subsystem.
- **Erweiterungs-Namensraum-Disziplin, genau wie ADR 0010 §5.** `SWM_stage_zone`/`SWM_stage_vanishing_point` folgen derselben additiven, sorgfältig namensraum-getrennten Vendor-Erweiterungs-Hygiene, die bereits etabliert ist; keine neue Risikoklasse eingeführt.
- **Kein Regressionsrisiko durch die Polygon-/Gradienten-Verallgemeinerung.** Jede Algorithmus-Änderung (§2, §3) ist eine strikte Verallgemeinerung, die sich bei `n = 4` auf das exakte heutige Verhalten reduziert; beide bestehenden Szenen sind dieser Fall, daher wird das mit einem Roundtrip-/Ausgabe-Gleichheitstest gegen sie ausgeliefert, statt sich allein auf Durchsicht zu verlassen.

**Status (2026-09-12):** Phase 0 und Phase 1 umgesetzt und verifiziert (`tsc`/`eslint`/`vitest`
752/752, `npm run build` grün). Abweichung von der ursprünglichen Annahme in §4/Konsequenzen:
"beide heute existierenden Szenen passen exakt in `flat-plane`" stimmte bei genauerer Prüfung
NICHT für `character-diorama` — dessen Formel mappt `v` auf Welt-Z bei fixem Y (ein
Boden-Mapping), während `"flat-plane"` `v` auf Welt-Y bei fixem Z mappt (ein
Hintergrundwand-Mapping). `character-diorama` läuft daher weiterhin über `projection: {mode:
"custom"}` mit seiner bestehenden Closure als `customUvToWorld` — funktional unverändert, aber
(noch) nicht Maker-roundtrip-fähig, genau die in den Konsequenzen benannte Einschränkung für
`"custom"`-Szenen. Nur `flakturm-tunnel` läuft über `"flat-plane"`.
Zusätzlich (User-Wunsch während der Umsetzung, nicht ursprünglich Teil dieser ADR): `SWM_stage_zone`
wurde nicht als dritter hartkodierter if/else-Zweig in `GltfLoader`/`WorldWriter` ergänzt, sondern
über einen neuen generischen Extension-Plugin-Mechanismus, der auch `KHR_lights_punctual` und
`SWM_prefab_instance` migriert hat — siehe ADR 0017.
**Update (2026-09-12, später am selben Tag):** Phase 2 (Maker-UI) ebenfalls umgesetzt und
live verifiziert — `StageZoneGizmoManager` (Anzeige/Auswahl, direktes Vorbild
`LightGizmoManager`), ein Punktlisten-Editor im PropertyPanel, `BackgroundPlane`/
`BackgroundImportPanel` (Referenzbild-Import mit erzwungenem Seitenverhältnis) und
Klick-zum-Zeichnen (`Z`/`Enter`/`Escape`) + Viewport-Punkt-Ziehen, beide über
`StageProjectionResolver`s Ray/Ebenen-Schnitt. Damit ist **ADR 0016 vollständig umgesetzt**
(Phase 0/1/2); Phase 3 (Fluchtpunkt-Werkzeug/Snapping) und Phase 4 (KI-Chat-Panel) bleiben wie
oben beschrieben bewusst außerhalb des Umfangs. Ein echter, vorbestehender Rendering-Bug wurde
dabei gefunden und behoben: `BasicMaterial` synct `transparent` nie in `state.blending`, wodurch
halbtransparente `BasicMaterial`-Flächen unter keinem Renderer sichtbar transparent wurden (siehe
Commit-Historie/Backlog für Details) — betraf die geplante halbtransparente Zonen-Füllfläche.
