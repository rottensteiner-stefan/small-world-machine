# Decal-System: Plan, Messungen und Fahrplan (2026-10-12)

> **Status:** Phase 0 und 1 umgesetzt und auf echter GPU geprüft (WebGPU und WebGL2, WebGL1 ignoriert Decals). Phase 2 in Arbeit, Phasen 3 bis 6 offen.
> **Datum:** 2026-10-12
> **Referenzen:** [ADR 0028 (Normal-Buffer)](../adr/0028-thin-normal-buffer-mrt.md), [ADR 0029 (Decal-System)](../adr/0029-decal-system.md), [Decal-Guide](../guides/decals.md), `REFERENCES.md`, Probe `apps/showcases/decal-probe`, Prüfskript `npm run test:decals`.

Ursprung ist ein `/collaborate`-Board mit vier Rollen (Board `.agents/collaborate/decal-system.md`, Konsens 3/3). Dieses Dokument ersetzt die lokalen Arbeitsnotizen. Die getroffenen Architekturentscheidungen stehen im ADR 0029, hier stehen Fahrplan, Messwerte und offene Punkte.

## Ausgangslage und Richtung

Die Engine ist Forward mit Clustered Lighting, ohne G-Buffer. Unreal-/Unity-DBuffer-Decals scheiden damit aus. Gewählt wurde das Box-Decal aus der Tiefe (Unity „Screen Space“, Unreal Deferred Decals), das die Engine selbst beleuchtet und mit eigener Normal-Map auf die Normale der Unterlage legt. Voraussetzung war ein dünner Normal-Buffer (ADR 0028). Entscheidungen des Nutzers: WebGL1 nur als Mesh-Decal, beleuchtete Decals, Receiver-Layer-Maske später.

## Architektur in Kürze (Details im ADR 0029)

- Eigene Liste `RenderList.decals` und eigener Sub-Pass nach Opaque, vor Transparent. Statische, kameraunabhängige Reihenfolge (Priorität, Volumen, Erstellung).
- `Decal` (Einheitswürfel, Projektion entlang lokal −Y, UV = Box x/z), `DecalMaterial`, Entprojektion über `clipToBox` pro Decal.
- Eingaben: Opaque-Tiefe und eine pro Frame kopierte Normal-Textur. Drei Tiefen-Taps pro Achse liefern Normale (Fallback) und UV-Gradienten.
- Offscreen-Targets überspringen Decals, WebGL1 ignoriert sie, keine Decals auf Transparenten.

## Messungen (Phase 0 und 1)

| Prüfung | Ergebnis |
|---|---|
| Keine Validierungs-/GL-Fehler (beide Backends, Kamera im Würfel, Stress) | bestanden |
| Normale unter halbtransparentem, geneigtem Decal | WebGPU (0,389, 0,921, −0,005), WebGL2 (0,384, 0,923, −0,001) |
| Kosten, 3 normale Decals bei 5600×2968 | nicht messbar |
| Kosten, Stress mit 32 großen überlappenden Lit-Decals | 211 ms, mit frühem Discard 172 ms |
| HBAO mit und ohne Normal-Buffer | identisch (`check-decals`) |

Die Stresskosten skalieren mit abgedeckten Pixeln mal Überlappung. **Korrektur (Phase 2):** Die absoluten Zeiten waren nicht belastbar: dieselbe Szene lag in späteren Läufen zwischen 96 und 374 ms (Faktor 4, GPU-Takt/Last). Stabil ist nur das Verhältnis innerhalb einer Sitzung: unlit ≈ 0,5 × lit. Der frühere Budgetvorschlag („etwa 2 Vollbild-Äquivalente, rund 4 ms“) war aus einem einzelnen Lauf hochgerechnet und ist **zurückgezogen**; es gibt vorerst nur eine qualitative Richtlinie.

## Gelöste Fragen und Befunde unterwegs

- **Plane-UV:** Eine `Plane` mit `StandardMaterial` zeigt Bilder vertikal gekippt (Probe und Prolog). Das Decal zeigt sie aufrecht. Die Prolog-Migration korrigiert damit sichtbar die Schilder.
- **HBAO war bei hoher Auflösung falsch** (absoluter Schwellwert, Normale zeigte weg) und nutzt jetzt immer die flache geometrische Normale mit Nachbarwahl. Der Normal-Buffer ist für HBAO bewusst keine Eingabe (Quelle: Turánszki 2019).
- **Pipeline-Cache** baute Pipelines jeden Frame neu, wenn ein Objekt in zwei Targets gezeichnet wurde. Behoben.
- **Spot-Schatten** auf Decals sind auf beiden Backends richtig. Der WebGL2-Renderer legte die Schattenkamera nie lazy an. Behoben.
- **ORM-Reihenfolge der Engine:** R = AO, G = Roughness, B = Metallic. **Vertex-Alpha:** Das Attribut ist RGBA, wird aber nirgends gelesen.
- **Quellenprüfung:** „RNM-equivalent“ war eine Übertreibung (TBN-Rotation statt Shortest-Arc). Der Wicked-Engine-Artikel von 2017 beschreibt unsere Technik nur als den einfachen Deferred-Weg.

## Fahrplan

Jede Phase endet mit `npm run lint:fix`, `build:lib`, `test`, `lint:wgsl` und `npm run test:decals`.

| Phase | Inhalt | Stand |
|---|---|---|
| 0 | Spike WebGPU | erledigt |
| 1 | Kern auf beiden Backends, Tests, Probe, GPU-Skript | erledigt |
| 2 | Qualität: Mip-Schärfe gemessen (`mipBias` bleibt bei 0), `USE_DECAL_UNLIT` (`unlit`), normal-mapped Empfänger in der Probe gemessen; offen: Anisotropie der Decal-Texturen, ms-Budget auf Zielgeräten | weitgehend erledigt |
| 3 | Daten: `KitDecalItem` (size, normal, orm, emission), `LevelDescriptor.decals[]`, Schema, Validator, `loadLevel`, Migration der 6 Prolog-Decals | offen |
| 4 | Maker-Stempelwerkzeug (modal: `D` an, Klick stempelt, `R` dreht, Pfeile schieben, `Shift` skaliert, `Esc` aus), Speicherung über `SWM_decal` | offen |
| 5 | Mesh-Decal-Baker (Load-Zeit, CPU, Sutherland-Hodgman gegen die Box, statische Empfänger) für WebGL1 | umgesetzt |
| 6 | 6a Plane-Fit (Maker, `DecalPlaneFit.ts`), 6b Nässe als Kit-Decal `flakturm/wet_puddle` (kein Engine-Feature), 6c Laufzeit-`DecalPool`; 6d Decal-Sockets (`LevelDecalPlacement.socket`, `KitSocket.rotation`) | umgesetzt (2026-10-13) |

## Phase 3: Hinweise für die Umsetzung

- **Datenpfad:** `LevelDescriptor.decals[]` (id, kitDecal, position, rotation, size, fade, opacity, priority, tags, parent) ist primär. `SWM_decal` (glTF, ADR 0017) folgt für den Maker mit demselben Payload. Der Maker hat keinen `level.json`-Writer.
- **Strikte Schemas** (`additionalProperties: false`) und `loadLevel` ignoriert bisher `environment.surfaces`: Schema, Validator und Loader müssen zusammen geändert werden, mit einem Test, dass jeder Schema-Abschnitt verbraucht wird.
- **ORM:** `DecalMaterial` braucht `u_ormMap` und ein `USE_DECAL_ORM`-Flag (R = AO, G = Roughness, B = Metallic), Zeilen in beiden Decal-Shadern.
- **Prolog-Migration:** Wanddecals mit Rotation (π/2, Gierwinkel, 0), `flipX()` entfällt, Texture-Repeat und -Offset ignoriert das Decal.
- **Mirrored Scale** dreht die Windung um und lässt das Decal verschwinden: negative Skalierung ablehnen.

## Phase 6: Umsetzung (2026-10-13)

- **6a Plane-Fit:** Vier Rays an den Footprint-Ecken, Normale als Kreuzprodukt der Diagonalen, Box-Tiefe wächst um die Höhenstreuung. Rückfall auf die Einzel-Normale bei weniger als drei Treffern oder einer Abweichung über 35 Grad (Ecke, Kante, Stufe); `Alt` schaltet den Fit pro Klick aus. Nur Maker, kein Engine-Code.
- **6b Nässe:** Ein ORM-Decal kann die Roughness der Unterlage nicht überschreiben (Forward-Lit), deshalb ein dunkles, glänzendes Overlay als Kit-Decal. Gemessen im Probe (`?wet=1`): bare floor Luma 120, dunkel allein 57/63 (WebGL2/WebGPU), mit ORM-Roughness 0,05 62/69. Der Glanz ist bei schwachem Licht klein.
- **6c Akkumulator:** `DecalPool` (feste Slots, nur `isVisible` wird umgeschaltet, ältestes Decal wird recycelt, `Decal.restack()`, Fade am Lebensende, `attachTo`). Probe `?pool=1` plus `poolChecks`.
- **6d Decal-Sockets:** erst zurückgestellt, dann doch umgesetzt (Wunsch des Nutzers). `LevelDecalPlacement.socket` (braucht `parent`) hängt das Decal an den vorhandenen Socket-Anker des Props, `position`/`rotation` sind Offsets zum Socket; `KitSocket.rotation` ist neu und optional, für Decals zeigt die lokale +Y-Achse des Sockets aus der Fläche. Schema (`dependentRequired`), Level-Validierung und `loadLevel` prüfen es; kein bestehender Prop nutzt es bisher, ein Beispiel-Socket mit Rotation fehlt im Content.

## Bewusst vertagt oder offen

- Kosten und Normal-Buffer auf Mobile und Tile-Based-GPUs, andere GPUs.
- Spot-Schatten auf Decals nur visuell bestätigt, keine Pixelmessung.
- Ein stark normal-mapped Empfänger ist weder für HBAO noch für das Decal-Blending gemessen (Phase 2).
- Mip-Schärfe ist gemessen (Decal/Plane-Verhältnis 0,99 bis 1,06 bei `mipBias` 0, nur die nächste Zone 0,89 wegen Vergrößerung und Kantenfade; negativer Bias übersättigt und flimmert). Gemessen mit Anisotropie 1: ob der Sampler für Decal-Texturen Anisotropie nutzt, ist offen.
- Keine ms-Budgetschwelle, bis auf Zielgeräten gemessen wurde.
- Offene Maker-Entscheidungen (modale Tasten und `SWM_decal`) sind getroffen: Empfehlung übernommen.

## Risiken

Offscreen-Targets haben keinen Normal-Buffer (Decals dort übersprungen). Die Opaque-Tiefenkopie läuft nur, wenn Decals, Transparente oder HBAO sie brauchen. Der Overdraw beleuchteter Decals ist die Hauptkostenquelle (Gegenmittel: `USE_DECAL_UNLIT`, enge Boxen).
