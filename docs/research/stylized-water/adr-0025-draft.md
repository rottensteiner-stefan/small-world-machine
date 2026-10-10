# ADR 0025 (ENTWURF): Stilisierte Wasser-Looks — Engine-Kern vs. Extension-Paket

> Status: DRAFT (Dave, T3, Session showcase-10-ghibli). Nicht in docs/adr/ eingecheckt. Sprache: Deutsch wie die uebrigen ADRs.

## Kontext & Problem

ADR 0013 etabliert "ein Kernmechanismus, Looks als Presets" fuer Fluessigkeiten. Der Moderator will
jetzt mehrere Varianten stilisierten Wassers (Fokus: typischer Ghibli-Look: weich, handgemalt, ruhig),
**ein Teil als Engine, ein Teil als Extension**. Dafuer fehlt eine Regel — und ein Mechanismus: heute
gibt es Extension-Pakete nur fuer Daten/Geometrie/Physik/VFX/Tools (ADR 0014/0017/0018/0021/0022/0024),
**keines liefert Shader-Assets oder haengt sich in ein Material ein**.

Belegte Randbedingungen (Stand v0.95.2):

- `StandardWebGPULayout`/`ObjectUniforms` ist voll; `LiquidWaveMaterial` hat jedes Feld umgewidmet (ADR 0013).
- `ObjectUniforms` (`structs.wgsl`, einzige Quelle) belegt 224 Byte; der Object-Ring-Slot hat >= 256 Byte
  (`GPUObjectRingBuffer`, `_scratchObjBufferData = Float32Array(64)`). Es passen **zwei vec4 (32 B) ohne
  Stride-Aenderung** hinein.
- `AbstractMaterial` akzeptiert `MaterialType | string`; `registerMaterialShaderProvider()` ist
  **first-wins pro Typ-String** — eine Subklasse mit demselben Typ wuerde den Engine-Look ueberschreiben/verdraengen.
- Opaque-Depth/Color-Capture wird allein ueber die Deklaration in `layout.textures` ausgeloest
  (`requiresOpaqueDepth`, GPUPipelineCache) — Extension-Materialien bekommen es ohne Engine-Aenderung.
- GL-Backends binden Uniforms per Introspektion; nur WebGPU hat das feste Struct.
- ESLint verbietet nur Engine -> Apps; Engine -> Extension-Pakete ist nicht maschinell verboten.

## Entscheidung

### 1. Kriterien Engine vs. Extension

Ein Look/Feature gehoert in die **Engine**, wenn mindestens eines gilt UND es prozedural, asset-frei,
3-Backend-paritaetisch (GLSL300/GLSL100/WGSL) und im Kostenbudget ist:
 (E1) braucht Engine-Interna (Uniform-Slots, Capture-Texturen, Passes, Renderer-Haken);
 (E2) ist reine Mathe, die >= 2 Engine-Materialien nutzen (Shared Chunk);
 (E3) ist eine Stufe der Stil-Leiter selbst (Parameter-Vektor auf dem Kern, ADR 0013), keine eigene Shader-Pfad-Variante.
Es gehoert in eine **Extension**, wenn es ADDITIV ist (komponiert ueber die Engine-Hooks, ersetzt keinen
Engine-Pfad) und mindestens eines gilt: (X1) eigene Art-Direction/Nischen-Publikum; (X2) externe Assets,
Lizenzen oder Abhaengigkeiten; (X3) Kosten > Engine-Budget oder Backend-Teilmenge (z.B. kein GLSL100);
(X4) schnelle Iteration ohne Engine-Semver-Last (ADR 0015 spiegelbildlich).
**Tie-Breaker:** im Zweifel zuerst Extension; Promotion in die Engine bei zweitem Konsumenten oder wenn
E1 eintritt (Richtung Extension -> Engine ist abwaertskompatibel, die Gegenrichtung ein Breaking Change).
Abhaengigkeitsrichtung strikt Extension -> Engine (ADR 0021), per ESLint erzwungen.

### 2. Aufteilung (erste Zuordnung; Moderator-Entscheidungen R1-R5 vom 2026-10-03)

Engine (`StylizedWaterMaterial`, ein Kern, Parameter-Vektor + Stil-Tabelle): flat, toon (Default,
**unveraendert**, pixel-identisch; der Legacy-Kaustikpfad bleibt vorerst bestehen, keine Loeschung — R2),
bold (Legacy-Alias), **soft** (Fokus; ruhig-malerisches Meer, Referenz Film "Spirited Away"; eine
dunklere/neblige Stimmung nach Referenz-Spiel "Dredge" ist ein *Preset* von soft, kein eigener Look — R1)
und **sparkle** (Kaustik-Netz + Glint + gestufte Zeit). Oeffentliche Style-IDs neutral; "Ghibli" nur intern
in Docs/Kommentaren (Marke — R5). Geteilte Engine-Chunks: `liquid_caustics` (F1-SmoothF1), `liquid_glint`,
Rampe/Wash, gestufte Zeit. Sparkle ist per E2/E3 Engine (kein Pass/Sampler/Asset noetig — R4).
Extension (`@small-world-machine/liquid-extras`, R3): erster Inhalt ist das **noir-Pack** (Hook-basiert, Posterize/
Tintenwasch ueber `[WATER_EXT_SURFACE]`, keine Assets — R4); es beweist zugleich den Mechanismus.
Asset-basierte Packs (Papier-/Pinselkorn, X2) spaeter. Semi-real bleibt `OpenWaterMaterial`.

Migrationsregel: `u_styleA/u_styleB` defaulten auf 0 und `styleId == 0` bedeutet "Legacy-Pfad" — dadurch
rendert jede bestehende Szene ohne Aenderung wie heute; nur soft/sparkle setzen styleId > 0 und nutzen den
neuen Kaustikpfad (uniform-gesteuerte Verzweigung, keine Ableitungen/Samples darin). Folge: zwei Kaustikpfade
koexistieren bis der Moderator die Loeschung freigibt (Konsequenz siehe unten).

### 3. Mechanismus (minimale Engine-Haken)

H1 Style-Slots: zwei `vec4` (`u_styleA`, `u_styleB`, Default 0) am Ende von `ObjectUniforms`/`StandardWebGPULayout`.
H2 Hook-Tokens im Stylized-Frag (`[WATER_EXT_DECL]`, `[WATER_EXT_SURFACE]`, Default = leerer Chunk) plus
   exportierte, typisierte `composeStylizedWaterSources(ext?)`.
H3 `StylizedWaterMaterial` bekommt einen geschuetzten Typ-Parameter (Default `MaterialType.STYLIZED_WATER`),
   damit Extension-Subklassen einen eigenen Shader-Typ registrieren.
H4 ESLint-Grenzregel: Engine darf keine Ecosystem-Pakete importieren.
Keine Registry, keine Singletons: Komposition passiert pro Material-Klasse per String-Zusammenbau.

### 4. Budgets, Backends, Migration — siehe Board-Finding "DRAFT PROPOSAL P1 (Dave)".

## Verworfene Alternativen

- Runtime-Registry fuer Wasser-Looks (`registerWaterLook`): globaler Zustand (Verstoss gegen "keine Singletons"), mehr API-Flaeche.
- Alle Varianten in die Engine: waechst bei jedem Look; widerspricht ADR 0014/0021.
- Alle Varianten als Extension: soft/sparkle brauchen E1 (Slots) und sind der erklaerte Fokus.
- Eigener Shader-Fork je Look: widerspricht ADR 0013 (5-vs-3-Wellen-Drift).
- Struct-Erweiterung ueber 256 B: Stride-Aenderung, hoher Wirkungsradius — nicht noetig.
- Gebackene Kaustik-Textur: kostet Sampler-Slot; siehe Bob F16.

## Konsequenzen

+ Look-Bugs im Kern werden einmal behoben; Extensions bleiben duenn (Preset + Hook-Code).
+ Erstes Extension-Paket mit Shader-Assets setzt das Muster fuer Lava-/Slime-/Noir-Packs.
- Neue Pflicht: Hook-Tokens muessen in allen drei Sprachen einen Default haben.
- 8 Float-Lanes sind danach das harte Limit fuer Stil-Parameter (Rest: Shader-Konstanten pro Extension-Typ).
- Zwei Kaustikpfade koexistieren (toon-Legacy + neu): groesserer Shader (GLSL100-Instruktionslimit/Compile pruefen), Loeschung des Legacy-Pfads nur nach expliziter Moderator-Freigabe.

Ueberdenken, falls: ein Look braucht einen eigenen Pass (z.B. echte Kaustik-Projektion, FFT-Ozean) -> eigener ADR.
