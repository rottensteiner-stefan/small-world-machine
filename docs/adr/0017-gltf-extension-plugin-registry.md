# glTF-Extension-Plugin-Registry statt hartkodierter if/else-Zweige

## Kontext & Problem

`GltfLoader`/`WorldWriter` kennen bislang genau zwei Vendor-/Community-Extensions —
`KHR_lights_punctual` (Khronos-ratifiziert) und `SWM_prefab_instance` (eigene Vendor-Extension,
ADR 0010) — jeweils als direkt in die Klassen einprogrammierte if/else-Zweige: ein Pre-Pass im
Loader, der `KHR_lights_punctual.lights[]` indiziert, eine Entscheidung in der
Node-Erzeugungsschleife, welche `Object3D`-Unterklasse instanziiert wird, und im Writer ein
`instanceof`-Zweig plus ein Root-Level-Array-Akkumulator.

ADR 0016 fügt mit `SWM_stage_zone` eine dritte Extension hinzu. Ein dritter hartkodierter Zweig
wäre die billigste Lösung gewesen, aber sie skaliert nicht: glTFs eigenes Erweiterungsmodell ist
genau dafür gemacht, dass beliebig viele Parteien eigene `EXT_*`/herstellerspezifische
Extensions definieren, ohne dass Khronos oder irgendein zentraler Maintainer sie kennen muss —
`EXT_mesh_gpu_instancing` (Cesium/AGI) oder `MSFT_texture_dds` sind Beispiele für Extensions, die
sich als De-facto-Standard durchgesetzt haben, ohne je `KHR_` zu werden. Eine Engine, die jede
neue Extension nur durch Anfassen ihres eigenen Loader-/Writer-Codes unterstützen kann, schließt
genau dieses Muster aus.

## Entscheidung

Ein generischer, in sich geschlossener Plugin-Mechanismus ersetzt die hartkodierten Zweige:

```typescript
interface GltfExtensionPlugin {
  readonly name: string;
  prepareRead?(ctx: GltfReadContext): void;
  readNode?(nodeIndex: number, nodeDef: GltfNodeDef, name: string, ctx: GltfReadContext): Object3D | undefined;
  applyNode?(obj: Object3D, nodeDef: GltfNodeDef, ctx: GltfReadContext): void;
  writeNode?(obj: Object3D, node: GltfNodeJson, ctx: GltfWriteState): void;
  finalizeWrite?(ctx: GltfWriteContext): void;
}
```

`registerGltfExtension(plugin)` (`GltfExtensionRegistry.ts`) trägt ein Plugin in eine einfache
Liste ein; `GltfLoader`/`WorldWriter` iterieren über diese Liste statt über eigene if/else-Ketten.
Drei eingebaute Plugins (`packages/engine/src/loaders/gltf/extensions/`) registrieren sich per
Seiteneffekt-Import selbst: `KhrLightsPunctual.ts`, `SwmPrefabInstance.ts` (beide 1:1 aus dem
vorherigen hartkodierten Code migriert) und `SwmStageZone.ts` (neu, ADR 0016). Später kommt `SwmDecal.ts` hinzu (ADR 0029): sein `readNode` liefert ein textur-loses `Decal`, die Maps lädt asynchron `KitRegistry.hydrateDecal`, weil `readNode` synchron bleibt.

**Zwei Kontext-Typen statt einem**, weil `writeNode` pro Node während des rekursiven
Tree-Walks läuft — bevor das fertige Dokument überhaupt existiert —, während `finalizeWrite`
erst danach läuft: `GltfWriteState` (nur `state: Map<string, unknown>`, für
Root-Level-Akkumulatoren wie `KHR_lights_punctual`s `lights[]`) für `writeNode`,
`GltfWriteContext` (`state` + `doc`) für `finalizeWrite`. Analog trägt `GltfReadContext`
(`json` + `state`) die zwischen `prepareRead` und späteren `readNode`/`applyNode`-Aufrufen
geteilten Daten — bewusst NICHT als Instanzfeld auf dem Plugin-Objekt selbst, da Plugins einmal
registriert und über beliebig viele Ladevorgänge hinweg wiederverwendet werden; Zustand auf dem
Plugin-Objekt würde sich bei zwei gleichzeitig laufenden Parses gegenseitig überschreiben.

**`extensionsUsed` wird jetzt korrekt befüllt.** Ein Nebenfund beim Bau: `WorldWriter` hat
`extensionsUsed`/`extensionsRequired` (glTFs eigener, spec-konformer Weg, im Dokument-Root zu
deklarieren, welche Extension-Namen tatsächlich vorkommen) nie geschrieben — auch nicht für die
zwei längst bestehenden Extensions. `WorldWriter._finalize()` sammelt jetzt die tatsächlich in
`doc.nodes`/`doc.extensions` vorkommenden Extension-Namen und schreibt sie in
`doc.extensionsUsed`.

## Verworfene Alternativen

- **Dritter hartkodierter if/else-Zweig für `SWM_stage_zone`.** Billigste Lösung für genau diesen
  einen Fall, verschiebt aber dasselbe Problem auf jede künftige Extension — inkonsistent mit
  glTFs eigenem Erweiterungsmodell, das explizit auf Parteien ausgelegt ist, die Khronos nicht
  kennt.
- **Die eingebauten drei Extensions in ein separates `@small-world-machine/gltf-extensions`-Package
  auslagern.** Erzeugt eine echte Zirkelabhängigkeit: Diese drei sind Default-Verhalten, das
  `GltfLoader`/`WorldWriter` selbst beim Laden/Schreiben brauchen (ein Licht/Prefab/eine Zone
  soll ohne Zusatzschritt korrekt erkannt werden), brauchen aber zwingend Engine-interne Typen
  (`Object3D`, `PointLight`, `StageZone`). Ein separates Package müsste von `@small-world-machine/engine`
  abhängen; die Engine müsste umgekehrt das Package importieren, um ihre eigenen Defaults zu
  registrieren — Zirkel. Ein externes Package bleibt der richtige Ort für echt optionale,
  nicht-Default-Extensions (z. B. eine spätere Handvoll bekannter `EXT_*`-Community-Extensions
  als Beispiel), die dieselbe öffentliche `registerGltfExtension()`-API von außen nutzen würden —
  aber nicht für Verhalten, das die Engine selbst immer braucht.
- **Plugin-Zustand als Instanzfeld statt Kontext-Map.** Einfacher zu schreiben, aber nicht sicher
  bei überlappenden Ladevorgängen (Plugin-Objekte werden einmal registriert und über beliebig
  viele `load()`/`write()`-Aufrufe hinweg wiederverwendet).

## Konsequenzen

- **Reines Refactoring für die zwei migrierten Extensions.** Jeder bestehende
  Licht-/Prefab-Roundtrip-Test blieb unverändert grün — der Beweis, dass die Registry keine
  Verhaltensänderung ist, nur eine Umstrukturierung.
- **Neue Extensions brauchen keinen Eingriff in `GltfLoader`/`WorldWriter` mehr**, nur eine neue
  Plugin-Datei + eine Zeile in `extensions/index.ts`.
- **Reihenfolge zählt nur zwischen `readNode`-Plugins**, die dieselbe Node-Klasse-Entscheidung
  beanspruchen könnten — bei den drei eingebauten Plugins sind die Bedingungen disjunkt
  (Licht/Zone schließen sich gegenseitig aus), daher aktuell irrelevant, aber ein künftiges Plugin
  mit überlappenden Bedingungen müsste die Registrierungsreihenfolge bewusst berücksichtigen.
