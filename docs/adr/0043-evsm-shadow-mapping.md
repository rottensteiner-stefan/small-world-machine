# 0043: EVSM/EVSSM — Exponenzial-Varianz-Schatten als opt-in-Verfahren

> **Status note (2026-10-22, 0.116.0):** Dieses ADR protokolliert die Architektur-Entscheidung und die
> Umsetzungsumfänge. Die WebGPU-Seite (Momenten-Pass + Auswertung) ist umgesetzt und live gegated
> (Mode-Flag-Lane + fehlerfreier Lauf). Die WebGL2-Seite ist umgesetzt (eigener RGBA32F-Momenten-Atlas
> hinter `EXT_color_buffer_float`-Gate mit ehrlichem Fallback) und rendert — der in der Diagnose
> beobachtete schwarze EVSM-Frame wurde in 0.116.0 auf **zwei reale Engine-State-Bugs** zurückgeführt
> und behoben (fehlerhafte Sampler-Rückbindung + Cluster-Grid-Unit-Kollision; Details in Abschnitt 3).
> Der Default bleibt in jedem Zustand bytes-identisch `pcss`.

- **Status:** Accepted
- **Date:** 2026-10-22
- **Status of:** Soft-Shadow-Roadmap Phase 2 (EVSM/EVSSM), ADR 0043
- **Decision Makers:** Small World Machine Architecture Team (human-approved 2026-10-22)

---

## Context & Motivation

Die PCSS-Kontakt-Härtung (ADR 0006, 0.115.6/0.115.7) demonstriert und gated das
„scharf am Caster, weich in der Distanz"-Signaturverhalten für dünne Occluder. Die Roadmap
(`.agents/notes/backlog.md`, Phase 2+) fordert darüber hinaus **variance-basierte Verfahren**
(„EVSM/EVSSM, MSM"), die zwei strukturelle Grenzen von PCSS/PCF aufbrechen:

1. **Kern-Stabilität:** PCF/PCSS sind Sample-Zähl-Beschränkungen unterworfen — große Filter
   kosten Zyklen und bleiben bandbreiten-begrenzt. Variance-Techniken filtern **Momente
   vorab** (eine Aufweichung im Momenten-Raum, unabhängig vom späteren Kernel), sodass große,
   weiche Penumbras ohne 3×3-..Kernel-Kaskaden darstellbar sind.
2. **Exotische Filter:** Weil in der Auswertung nur Momente ankommen, sind später anschließende
   Post-Filter (z. B. bilaterales/aufweitendes Momenten-Filter, MSM-Hierarchien) auf einer
   gemeinsamen Datenbasis möglich.

### Zu entscheidende Punkte

1. **Verfahrenstyp:** EVSM (exponentiell-gewarpte Varianzmomente) vs. EVSSM (mit zusätzlicher
   Reduktion/-Schicht) vs. MSM (bereits mehrere Ordnungen). Entscheidung → EVSM mit dynamischem
   Varianz-Floor und Light-Bleed-Reduktion; MSM bleibt als spätere Stufe auf derselben Atlas-/Lane-
  -Grundlage möglich.
2. **Backend-Scope:** Ist EVSM an die GPU-API-Generation gebunden? → Nein, siehe
   Tiered-Renderer-Werkzeuge (Unabhängigkeit der API-Stufe von der Implementierungstiefe).
3. **Opt-in-Kopplung:** Soll EVSM das Default-Verfahren werden? → Nein; `pcss` bleibt Default
   (bytes-identisch, per `EvsmGlslGuards`-Tests abgesichert), EVSM ist `quality.shadowMode="evsm"`.
4. **WebGL2-Fallback:** Ohne `EXT_color_buffer_float` kann der Momenten-Atlas nicht als
   RGBA32F-Ziel gerendert werden → ehrlicher Fallback auf das Default-Schattenverfahren + Warnung.

---

## Architectural Decision

Der Mensch hat am 2026-10-22 die folgenden verbindlichen Entscheidungen getroffen
(in künftigen Session-Sitzungen nicht neu aufrollen):

1. **EVSM (Filament-Stil), opt-in — nicht Default:**
   - Exponenzielle Gewichtung `e^{c·d}` mit `d ∈ [-1,1]` und `c = 40` (Filament-`vsm-exponent`),
     gespeichert als 4 Momente `(e^{c·d}, e^{2c·d}, -e^{-c·d}, e^{-2c·d})` (positive UND negative
     Gewichtung für die zweiseitige obere Schranke).
   - Einseitiger **Chebyshev-upper-bound** mit **dynamischem** Varianz-Floor `y·µ₁²` (Multiplikator,
     kein fester Sockel — die Warp-Weitung macht feste Sockel falsch) und **Light-Bleed-Reduktion**
     (LBR-Remap).
   - Tuning-Lanes `[216..218]` im WebGPU-GlobalUniforms-Block (`evsmParams`): Mode-Flag,
     Varianz-Floor-Multiplikator (Default 0.002), LBR-Anteil (Default 0.004). WebGL2 spiegelt dieselben
     Werte über ein äquivalentes Uniform-Slot-Paar.
2. **WebGPU = Momenten-Pass + Auswertung** (umgesetzt, live gegated):
   - `CascadedShadowPassGPU._renderEvsmCascades` rendert die Momente in ein
     `texture_2d_array`-`rgba32float`-Ziel (Kaskaden-Ebenen, volle Auflösung).
   - Der Momenten-Zugriff erfolgt über **`textureLoad`** (Texel-Loads sind im nicht-uniformen
     Kaskaden-Kontrollfluss legal; `textureSample` dagegen nicht — nur Depth-Compare-Sampling ist
     dort befreit). Das Bind-Group-Layout (Bind 16) ist **unfilterable-float**, da RGBA32Float ohne
     das `float32-filterable`-Feature nur unfilterable TEXEL-Loads erlaubt.
   - Auswertung über `chebyshevUpperBoundEVSM`/`getEVSM`-Dispatcher in `pbr_math.wgsl`; Einzug in
     die Licht-Schleifen (`lighting|lighting_pbr|glass_pbr_loops|dir_shadow.wgsl`).
   - CPU→GPU-Verdrahtung: `GlobalUniformWriter` schreibt die `evsmParams`-Lane; das Showcase-42-Gate
     liest sie zurück (Lane 216 = 1 ⇔ EVSM aktiv) und prüft fehlerfreien Lauf.
3. **WebGL2 = eigener Momenten-Atlas mit ehrlichen Grenzen:**
   - Getrennter RGBA32F-Atlas (`rgba32float`, gleiche Kaskaden-Grid-Packung wie der Tiefen-Atlas),
     Rendering hinter **`EXT_color_buffer_float`-Gate**; das Gate ist Teil des Schatten-Renderers, nicht
     des Pfads: Ohne die Extension fällt EVSM ehrlich auf das Default-Verfahren zurück (Warnung).
   - GLSL-Auswertung in `base_fragment_header`/`light_calc`-Chunks (`chebyshevUpperBoundEVSM`,
     `evalEVSMDir`, Zell-geklemmter 3×3-Box-Filter). Der **Default-Pfad bleibt bytes-identisch** —
     abgesichert durch `EvsmGlslGuards.test.ts` (Quelltext-Regression) + den goldenen Default-Lauf.
   - **Stage-C-Befund UND -Lösung (0.116.0):** Der anfangs beobachtete schwarze EVSM-Frame auf WebGL2
     war **kein Treiber-/Sampling-Hardware-Problem**, sondern zwei reale Engine-State-Bugs, die in
     Stage C per Shader-/Bind-Instrumentierung + Wurzel-Analyse gefunden und behoben wurden:
     1. `_bindSubgroupTextures()` re-pointete `u_dirEVSMMap` (ein `sampler2D`, regulär im
        Material-Sampler-Pfad) nach der korrekten Atlas-Bindung erneut auf eine dynamisch
        vergebene Einheit und deponierte dort das 1×1-weiße `defaultTexture` → der EVSM-Shader
        tastete **Weiß** statt des Atlas ab → `chebyshev≈0` → schwarzes Bild (nur ganz schwaches
        Ambient). Fix: `u_dirEVSMMap` wird wie die IBL-Maps aus der Material-Sampler-Schleife
        ausgenommen.
     2. `_EVSM_MAP_UNIT = 14` war identisch mit `CLUSTER_GRID_UNIT = 14`: Der Atlas verdrängte die
        RG32UI-Cluster-Grid-Textur; jeder `u_clusterGrid`-Zugriff las eine Float-Textur durch einen
        Integer-Sampler (`GL_INVALID_OPERATION` pro Draw). Fix: Bindung auf die pro-Programm
        exklusiv für `u_dirEVSMMap` reservierte Sampler-Einheit (Fallback die fixe Einheit).
     - Der Default-Pfad bleibt davon strukturell unberührt (early-return außerhalb `evsm`, goldener
       Lauf). Auch die Diagnose-Beweiskette schließt die Shader-Mathematik ausdrücklich aus:
       Float32-Simulation gegen die realen farClear-Momente liefert über den gesamten
       Tiefen-Sweep `min(p,n) = 1.0` (LIT).
4. **Tiered-Renderer-Autonomie (keine API-Parity-Kappung):** EVSM ist NICHT „weil tier-bedingt"
   auf eine API-Stufe beschränkt. Jede API-Stufe, die einen RGBA32F-Momenten-Atlas rendern und
   abtasten kann, führt ihr maximal mögliches EVSM aus. Die Performance-Stufe kann Budgets skalieren
   (Atlas-Auflösung, Filteranzahl), deaktiviert aber kein Verfahren.

---

## Konsequenzen

- **Opt-in ohne Default-Risiko:** Der evsm-Zweig ist in jedem Shader-Dialekt hinter einem
  Mode-Flag-Test geschützt; der Default-Pfad ist bytes-identisch (Quelltext-Guards + goldener Test).
- **WebGPU braucht kein Feature-Gate:** RGBA32Float-Texel-Loads sind Kern-WebGPU; `textureLoad` +
  unfilterable-float-Bind umgehen das optionale `float32-filterable`-Feature vollständig.
- **WebGL2 braucht das `EXT_color_buffer_float`-Gate:** ohne sie kann der Atlas nicht gerendert
  werden → ehrlicher Fallback statt kaputtem Frame. Die Bind-Disziplin ist dabei kritisch:
  renderer-eigene Sampler müssen aus der Material-Sampler-Schleife ausgenommen und auf einer
  kollisionsfreien Einheit gebunden werden (siehe die behobenen Stage-C-Bugs oben).
- **Messbarkeit:** Das Showcase-42-Gate (
  `scripts/check-swm42-evsm.mjs`) prüft: (a) fehlerfreier Lauf (keine Pipeline-/Kompilier-Fehler),
  (b) Mode-Flag-Lane `evsmParams[0] = 1` unter `shadowMode=evsm` und `= 0` unter dem pcss-Default,
  (c) plausibler Frame (keine leere/aufgeblasene Bühne, Schattenpräsenz oberhalb Toleranz).
- **Tuning-Look:** Der WebGPU-EVSM-Look ist Stand 0.116.0 ausgewaschen (flache Kontakt-Tiefe,
  `near≈0.006` / `far≈0.219`); die LBR-Senke von 0.004 greift kaum. Das ist ein Kalibrierungs-Thema
  der Defaults (Varianz-Floor/LBR), keine Architektur-Lücke — die Lanes sind dafür die
  dokumentierte Schnittstelle.

---

## Alternativen

- **EVSSM/MSM direkt:** Die zweiseitige Gewichtung (EVSSM) ist hier bereits implizit (positive +
  negative Momente). Ein reines MSM mit höheren Ordnungen wäre auf derselben Atlas-/Lane-Basis als
  spätere Stufe möglich, wurde aber nicht als Einstiegs-Verfahren gewählt (Implementierungs- und
  Kalibrierungs-Aufwand, kein nachgewiesener Nutzen für die aktuellen Proben).
- **EVSM als Default:** Abgelehnt — unkalibrierter Look darf den byte-identischen PCSS-Default
  nicht gefährden; Opt-in hält das Golden-Test-Versprechen.
- **WebGL2 ohne `EXT_color_buffer_float` simulieren (RGBA16F/UNORM-Näherung):** Die große
  Warp-Spanne (e^±40) passt nicht in 16F/SRGB-Speicher; verworfen zugunsten des ehrlichen
  Fallbacks.
