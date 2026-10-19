# ADR 0042: Tropfen auf Flüssigkeiten als System, Splash als Shader-Illusion

> **Status: ACCEPTED** — 2026-10-19 (Maintainer-Entscheidung). Ausdrücklich als **revidierbar** markiert:
> alle drei Entscheidungen sollen bei Bedarf überprüft und erweitert werden (Auslöser unten).

## Kontext

`RainPuddleMaterial` (liquid-extras) rendert Regenringe physikalisch, ist aber ein einzelnes
Oberflächen-Material und fest auf Wasser eingestellt (σ/ρ, Viskosität, IOR als Shader-Konstanten).
Ziel ist das allgemeine Phänomen „Tropfen trifft Flüssigkeit" für beliebige Paarungen (Regen, Blut,
Säure, Öl … auf Wasser, Blut, Öl …).

Die Analyse zeigt: Die Ringgeometrie ist über Flüssigkeiten hinweg fast gleich (kleinste
Ringwellenlänge ≈ 11–17 mm, Mindestgeschwindigkeit ≈ 0,18–0,23 m/s für Wasser, Blut, Öl,
Quecksilber). Was eine Flüssigkeit kennzeichnet, ist ihre **Zähigkeit**. Sie bestimmt über vier
Größenordnungen die Ring-Lebensdauer (`τ = 1/(2νk²)`: Quecksilber ~7 s, Wasser ~0,8 s, Blut ~0,25 s,
Öl ~10 ms) und über die Ohnesorge-Zahl `Oh = μ/√(ρσD)` das Aufprall-Regime (Krone, Rückstoßstrahl,
Tochtertropfen, Blasen ja/nein). Daraus folgt: **gleiche Gleichungen, andere Stoffwerte**, kein
Sondermaterial je Flüssigkeit.

## Entscheidungen

1. **System statt Material.** Tropfen-Einschläge werden ein eigenes System: ein Ereignisfeld
   (wo, wann, welcher Tropfen), Stoffwerte für Flüssigkeit und Tropfen (Dichte, Oberflächenspannung,
   Viskosität, IOR, Absorption, mischbar ja/nein) und ein Material, das daraus die Oberfläche
   rendert. Das System lässt sich an beliebige Flüssigkeitsflächen hängen (Pfütze, Becken, Lache,
   Wanne). `RainPuddleMaterial` wird darin aufgehen bzw. zum Spezialfall Wasser + Regen.
   *Abgelehnt:* weiter ein Material pro Anwendungsfall. Grund: Ereignisse, Stoffwerte und Regime
   wären in jedem Material dupliziert, Paarungen (Blut auf Wasser, Wasser auf Öl) nicht abbildbar.
2. **Reihenfolge: Tropfen auf Flüssigkeit zuerst.** Ringe, Regime aus Oh/We, Tochtertropfen,
   Blasen, opake Flüssigkeiten. *Zurückgestellt:* Flüssigkeit auf fester Fläche (Lachen-Dickenfeld,
   Farbe nach Beer–Lambert, Spritzmuster, Antrocknen).
3. **Krone und Rückstoßstrahl als Shader-Illusion.** Krone, Jet und Sprühtröpfchen werden in der
   Oberfläche vorgetäuscht (Normalen, Glanz, kurze Billboard-/Flächeneffekte), nicht als echte,
   kurzlebige Geometrie. *Abgelehnt (vorerst):* Instancing-Geometrie. Grund: deutlich teurer,
   der Nutzen zeigt sich erst in extremer Nahsicht.

4. **Paarungen sind Daten, Phänomene sind Code** (Ergänzung 2026-10-19). Gleichartige Paarungen
   (Wasser auf Wasser, Blut auf Blut, Öl auf Öl, Säure auf Säure) unterscheiden sich nur in
   Stoffwerten: Dichte, Oberflächenspannung, Viskosität (Ringe, Dämpfung, Regime über Oh), IOR
   (Glanz) und Absorption je Farbkanal (klar vs. opak/farbig). Kombinationen erzeugen dagegen
   qualitativ neue Phänomene, die sich nicht über andere Zahlen in derselben Formel ausdrücken
   lassen. Diese Phänomene werden je **einmal** als Baustein implementiert und **ausschließlich über
   Werte der Paarung ausgewählt**: Mischbarkeit, Dichteverhältnis Tropfen/Becken und
   Spreitkoeffizient `S = σ_Becken − σ_Tropfen − σ_Grenzfläche` (plus ein Reaktions-Flag).

   | Bedingung (aus Werten) | Phänomen-Baustein | Beispiel |
   |---|---|---|
   | mischbar | absinkende Farbwolke, Diffusion | Blut in Wasser |
   | nicht mischbar, Tropfen dichter | sinkende Kugel | Wasser in Öl |
   | nicht mischbar, Tropfen leichter, S > 0 | spreitender Dünnfilm (Interferenzfarben, dämpft Kapillarwellen) | Öl auf Wasser |
   | nicht mischbar, Tropfen leichter, S < 0 | schwimmende Linse | manche Öle auf Wasser |
   | reaktiv | Gasbläschen, Verfärbung | Säure auf Kalkwasser |

   Es gibt keinen paarungsspezifischen Code (kein `if (blood && water)`); eine neue Paarung ist ein
   neuer Datensatz.

   **Umsetzungsreihenfolge:** (a) gleichartige Paarungen: die festen Wasser-Konstanten im Shader
   werden Parameter, Absorption/Opazität kommen hinzu, danach sind Wasser, Blut, Öl und Säure reine
   Presets; (b) Kombinationen: die Phänomen-Bausteine der Tabelle nacheinander.

## Konsequenzen

- Aus der Nähe (Makro-Kamera, flacher Blick) wirken Krone und Jet nicht plastisch; Silhouetten
  fehlen.
- Stoffwerte werden Laufzeit-Parameter statt Konstanten. Shader-Kosten ändern sich dadurch kaum,
  die Konstanten wandern in Uniforms.
- Werte einzelner Referenzfotos fließen nicht ein; Presets kommen aus Stoffdaten.

## Überprüfen, wenn …

- Makro-/Nahaufnahmen von Einschlägen gefordert sind → Entscheidung 3 (echte Geometrie für Krone/Jet).
- Lachen, Spritzer oder Blutspuren auf Flächen gebraucht werden → Entscheidung 2 (zweite Hälfte nachziehen).
- Das System für nur eine Flüssigkeit/eine Szene zu schwer wird → Entscheidung 1.

## Umsetzungsstand

- **2026-10-19, Phase (a) umgesetzt** (`packages/liquid-extras/src/drops/`, `RainPuddleMaterial`): Stoffwerte als Daten
  (`FluidProperties`/`FLUID_PRESETS`, `DropProperties`), Regime aus Weber/Ohnesorge in `DropRegime` (stufenlose
  Log-Rampen, keine Flüssigkeits-Namen im Code), Verteilung über `DropImpactSystem` an `DropImpactSurface`s,
  Shader mit Beer-Lambert-Absorption, Streu-Körperfarbe, Blasen (WebGPU/WebGL2) und Krone/Jet-Illusion (alle Tiers).
  Im Browser auf WebGPU, WebGL2 und WebGL1 geprüft (Showcase 30, Taste `F`).
- **Offen:** Kombinationen (Entscheidung 4, Bausteine Farbwolke, sinkende Kugel, Dünnfilm, Linse, Reaktion), Flüssigkeit auf
  Fläche (Entscheidung 2, zweite Hälfte). Vorläufige Annahme in den Presets: Altöl-Optik und Öl/Wasser-Grenzflächenspannung
  sind Schätzungen.
