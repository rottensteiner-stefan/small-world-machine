---
status: accepted
---

# 0053: Feuer-VFX-Schichten Rauch, Glutbett & Ruß — Welt-verankerte Partikel, Emissiv-Brennstoffbett und Decal-Grundierung

- **Status:** Accepted (human-approved 2026-10-29)
- **Date:** 2026-10-29
- **Anlass:** Feuer-Plan (Punkte 1 „Rauch", 2 „Glutbett + Ruß-Decal", 4 „ADR/Guide" der offenen Liste) und externes Review: Ein Feuer braucht über Flammenkörper (P1), Licht (P2) und Glutfunken (P3) hinaus die physikalisch ehrlichen Sekundär-Effekte — eine lösende Rauchfahne über der Flamme, das glühende Brennstoffbett darunter und die Ruß-/Aschengrundierung am Boden —, damit das Gesamtbild nicht wie eine schwebende Lichtquelle aussieht. Industrie-Benchmark (Niagara, VFX Graph, GPUParticles3D): diese Schichten sind getrennte, budgetierbare Systeme, kein einziges Monster-Effekt.

## Entscheidung

Drei neue, **eigenständige Feuer-Schichten** in `@small-world-machine/vfx-extras` (Engine-Kern unberührt, ADR 0022-Grenze), jede mit eigenem Rendering-Vertrag, eigener Determinismus-Garantie und eigenen Tests:

1. **Rauch (`FireSmokeEmitter` + `SmokeSpriteMaterial`)** — **Welt-verankerte** Plume über die bestehende `ParticleSystem`-Kette (Auftrieb + Drag + `SizeGrowthAffector` + `ColorOverLifeAffector`), gerendert als instanzierte Billboards durch ein **texturloses, alpha-geblendetes** Custom-Material (GLSL300/GLSL100/WGSL): weicher radialer Blob, durch scrollendes Value-Noise zu zerfasernden Wisps zerrieben, beim Verblassen dissoziierend — niemals ein harter Quad. Der Per-Instance-Buffer wird direkt gelesen: **rgb = Tönung, a = Opazität**. Weil Alpha hier Opazität und **keine** Größenfaltung ist, läuft der Renderer mit dem neuen Opt-in `ParticleMeshRenderer({ foldAlphaIntoScale: false })`; der Default bleibt `true` (bestehende Funken-Nutzer byte-identisch). Wind wird der Plume über `update(dt, anchor, camera, wind)` zugeführt (`windInfluence`), aus dem **gleichen** Windvektor, in den die Flamme lehnt.
2. **Glutbett (`EmberBed`)** — **opakes**, emissives `StandardMaterial`-Zylinderbett unter dem Feuer (ganzes Lagerfeuer, kleiner Fackelkranz, Kerze ohne) mit **langsamem**, geseedetem Noise-Atmen aus `FireFlickerProfile` (≈0,35 Hz, `breathStrength`-Klammer, kein Heartbeat) innerhalb einer autorisierten Emissiv-Bandbreite. Bewusst **kein** Custom-Kohle-Shader (Dokumentierte HIGH-Tier-Option).
3. **Ruß/Asche (`createSootDecalTexture` + `Decal`)** — prozedurale Scorch-Textur (deterministischer Hash, kein `Math.random`; Deckkraft in **Alpha**, Helligkeit in RGB; headless `undefined`) als **Box-projiziertes Decal exakt nach ADR 0029**: nativ auf WEB_GPU/WEB_GL2, **nur WEB_GL1** bäckt `bakeSceneDecals` in den Boden (die dort keine Opaque-Depth-Box-Decals haben). Unlit, statisch, **kein Laufzeit-Zustand** — die Grundierungsmarke eines echten Feuers.

Gemeinsame Verträge aller Schichten: **Determinismus/Golden-Freundlichkeit** (geseadetes mulberry32, dt=0 friert exakt ein, `enabled=false` sperrt; statisches Baked-Zeug hat gar keinen Zustand), **Welt-Verankerung** (bewegte Feuer lassen Rauch/Funken zurück), **Zero-GC** (SoA-TypedArrays, Scratch-Objekte), **ein Draw-Call pro Schicht**.

## Abgelehnte Alternativen

- **Rauch als Volumen-System (Froxel/SDF) in V1:** Maximale Qualität, aber teuer und erst auf WEB_GPU durchgängig; die instanzierte Billboards-Plume liefert 80 % des Looks für Null Engine-Eingriff. Volumetrischer Rauch bleibt dokumentierte HIGH-Tier-Option (könnte später ADR 0031-Kanäle nutzen).
- **Soft Particles / Depth-Fade für Rauch jetzt:** Die Industrie-Lösung gegen hartes Clipping von Billboards an Geometrie. Bewusst **aufgeschoben** (HIGH-Tier-Folge): die prozeduralen Weichkanten + Alpha-Dissolution ersetzen den harten Quad-Schnitt bereits, und die vollständige Lösung braucht eine Tiefe-Textur im vfx-extras-Shaderpfad (ADR-0028-Muster). Ehrlicher Verzicht, dokumentiert — nicht stillschweigend weggelassen.
- **Glutbett mit eigenem Kohle-Shader:** Ein prozeduraler Kohle-Look ist verlockend, aber das opake `StandardMaterial`-Emissiv liefert das Glühen ohne neue Shader-Paritätspflicht. Kohle-Shader als HIGH-Tier-Option dokumentiert.
- **Ruß als dynamisches Dezal / zweites Licht:** Das Decal ist statisch und gebacken bzw. nativ box-projiziert — es flackert nicht und beansprucht keinen Budget-Slot. Ein dynamisches Rußsystem (wachsende Rußflecken) bliebe für ein eigenes Feature („verrußte Umgebung") offen.
- **Ruß-Bakening auf allen Tiers:** Weicht von ADR 0029 ab (dort: nativ auf WEB_GPU/WEB_GL2, WEB_GL1 bäckt) und ersetzt die echte Box-Projektion durch einen flachen Clip. Korrekt ist der tier-differenzierte Pfad.
- **Deterministisches RNG über die Engine-`Noise`/`Math.random`:** `Noise` ist mit `Math.random` initialisiert und damit nicht reproduzierbar; die zweizeilige mulberry32-Kopie in jedem Emitter garantiert plattformidentische Goldens (wie `FireEmberEmitter`).

## Konsequenzen

- `packages/vfx-extras/src/fire/` wächst um `FireSmokeEmitter`, `SmokeSpriteMaterial` (+ 3 Shader-Dialekte), `EmberBed`, `soot.ts`; `affectors/` um `SizeGrowthAffector`; `ParticleMeshRenderer` bekommt das byte-identische Opt-in `foldAlphaIntoScale=false`.
- `apps/showcases/45` integriert alle drei Schichten (Skalierung aus der Flammengröße: Kerze minimale Wisp, Lagerfeuer dichte Plume/ganzes Bett), HUD-Schalter `R` (Rauch) und `B` (Glutbett) im Vorher/Nachher-Block; Wind-Slider speist die Plume.
- Sichtbarkeit des Ruß-Decals ist beleuchtungsabhängig (ehrlich): im Nachtschatten liest es als Schatten, bei Tageslicht klar sichtbar — physikalisch korrekt; dokumentiert.
- Goldens: Rauch/Funken/Glutbett-Atmen sind geseedet-deterministisch, Ruß ist statisch — der Golden-Gate (Punkt 5, antigravity) kann die volle Szene mit Toleranz aufnehmen. **Hinweis:** Welches Feuer den zweiten Punktschatten-Slot bekommt, kann mit dem Licht-Jitter wechseln (bestehende ADR-0052-Beobachtung).

## Doctrine Compliance

- **Neue öffentliche Hot-Scope-Parameter (Klassifikation):** Alle Konfigurationen sind `@domain` (Autorier-Werte der Emitter: `rate`, `capacity`, `lifeRange`, `speedRange`, `sizeRange`, `spawnRadius`, `growthRate`, `maxScale`, `buoyancy`, `drag`, `windInfluence`, `startColor`/`endColor`, `billboard`, `material`, `seed`; `EmberBed`-`radius`/`height`/`emissiveIntensity`/`breathStrength`/`seed`; `SmokeSpriteMaterial.time`/`churn`; `ParticleMeshRenderer.foldAlphaIntoScale`). Konstanten sind `@fixed` (mulberry32-Konstanten, Standardgrößen) bzw. `@derived` (aus `spec.height`/`spec.width` skalierte Emissionsbudgets im Showcase).
- **Geteilte Abstraktion ≥3 Konsumenten?** `SizeGrowthAffector` startet mit einem semantischen Konsumenten (Rauch); wie `GravityAffector` gilt er als ADR-0038-Infrastruktur-ähnlicher Baustein der vfx-extras-Kette (die `ParticleSystem`-Affektoren sind ein geteilter Vertrag, nicht eine Fachabstraktion). `foldAlphaIntoScale` ist ein Opt-in-Flag mit Default-Byte-Identität, kein neuer Modus.
- **Modeful Objekt?** Keine neuen Modi: `enabled` sperrt die Emission (Seiteneffekt-frei), `dt=0` friert ein — beides im Transition–Test (freeze on `dt=0`/`disabled`) geprüft, keine Zustands-Schleichwege.
- **Mathematische Behauptungen:** Multiplikatives Größenwachstum erhält Größenvarianten-Relationen (ratio-Gate im Test); das Atmungsband liegt garantiert in `[1−breathStrength, 1]×Intensity` (metamorpher Band-Test); Selektions-/Billboard-Mathe folgt `FireEmberEmitter`-Präzedenz. Keine Registry-ID beansprucht (keine neue engine-weite Invariante).
- **Fail-Closed / Honest Fallback:** headless `undefined` für Texturen ist derselbe dokumentierte Vertrag wie `createEmberSpriteTexture`; Tier-Lücke „Soft Particles" ist eine **kosmetische** (nicht render-kritische) Verschiebung mit dokumentiertem Ersatz (ADR-0043-Kalibrierung), ebenso der Verzicht auf Volumenrauch und Kohle-Shader.
- **Ausnahmen:** keine.

## Umsetzungsplan

0. **Gemeinsamer Vertrag:** `mulberry32`-Kopie (mit Sync-Kommentar) und dt=0-Freeze-Regel in beiden Emittern; Tests als Spezifikation.
1. **Rauch:** `FireSmokeEmitter`, `SmokeSpriteMaterial` + GLSL300/GLSL100/WGSL, `SizeGrowthAffector`, `ParticleMeshRenderer.foldAlphaIntoScale`-Opt-in; `FireSmoke.test.ts` (Determinismus, Emission, Physik, Rendering-Vertrag).
2. **Glutbett:** `EmberBed` (opak, Emissiv, Noise-Atmen); `EmberBed.test.ts` (Determinismus, Band, Freeze).
3. **Ruß:** `createSootDecalTexture`, `Decal`-Integration in Showcase 45 mit ADR-0029-konformem Tier-Pfad (nativ WEB_GPU/WEB_GL2, `bakeSceneDecals` nur WEB_GL1).
4. **Showcase 45:** Rig-Erweiterung (smoke/emberBed per Feuer), HUD-Schalter `R`/`B`, Wind-Kopplung an die Plume.
5. **Browser-Abnahme:** alle drei Schichten auf allen drei Tiers (WEB_GPU/WEB_GL2/WEB_GL1) geprüft — `check-showcases.js 45` grün, keine Konsolenfehler; Ruß-Sichtbarkeit bei Tageslicht verifiziert.
6. **Doku:** `docs/guides/vfx-fire.md`, ADR-Index, CHANGELOG; `FireSmoke`/`EmberBed`/`SizeGrowthAffector` in REFERENCES/CONTEXT.
