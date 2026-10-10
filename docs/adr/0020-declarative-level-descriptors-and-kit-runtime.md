# ADR 0020: Deklarative Level-Deskriptoren & Instanzbasierte Kit-Runtime (`KitRegistry`)

## Kontext & Problem

In der initialen Entwicklung von 3D-Szenen (exemplarisch im Prolog *Koje 42* von *The Whisper*) wurden Requisiten, Lichter, PBR-Materialanpassungen und Hotspots imperativ im TypeScript-Code aufgebaut:
- **Metadaten-Redundanz:** Die in `meta.json` (ADR 0011) deklarierten physikalischen Prefab-Eigenschaften (`recommendedScale`, Sockets wie `FlameGlow` an der Kerosinlampe mit Lichtfarbe `#d49a3d` und Intensität 3.5) wurden im Scene-Code manuell wiederholt.
- **Monolithische Kopplung:** Dressing (wo welcher Tisch steht, welche Skala die Lampe hat) und interaktive Story-Logik (Kamerafahrten, Dialoge, Modals) waren in einer 1770-zeiligen Datei vermischt.
- **Editor-Inkompatibilität:** Jede visuelle Verschiebung eines Props erforderte Codeänderungen und Re-Kompilierung, statt deklarativ ausgetauscht oder von einem visuellen Editor wie Maker (ADR 0010) exportiert werden zu können.

## Entscheidung

Wir führen eine zweistufige, deklarative Level-Pipeline im Engine-Kern ein:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│              Zweistufige Level-Pipeline & Kit-Runtime (ADR 0020)                 │
├───────────────────────────────────────┬──────────────────────────────────────────┤
│ 1. Kit-Prefab-Ebene (meta.json)       │ 2. Level-Deskriptor (*.level.json)       │
│  • model.glb (Geometrie)              │  • props[] (Instanzplatzierung & Overrides)│
│  • recommendedScale                   │  • lights[] (Narrative Szenenlichter)    │
│  • sockets[] (Mountpoints & Defaults) │  • hotspots[] (Interaktions-Trigger)     │
│  • PBR-Standardmaterialien            │  • stageZone (2.5D / 3D Bewegungsraum)   │
├───────────────────────────────────────┴──────────────────────────────────────────┤
│ Engine Runtime: KitRegistry (Instanzbasiert, Dependency Injection, kein Singleton) │
│  ├── loadProp(kitPropId, options) ──> Resolves meta, scales, mounts socket lights │
│  └── loadLevel(levelUrl, scene)   ──> Parallel loading, builds scene graph        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 1. Instanzbasierte `KitRegistry` (Kein globaler Singleton)
- Entsprechend der Kern-Architekturregel von Small World Machine gibt es keine globalen Singletons.
- `KitRegistry` wird via Constructor Injection oder Scene Context instanziiert (`new KitRegistry({ basePath, assetManager, gltfLoader })`).
- `loadProp("bunker/kerosene_lantern")` lädt asynchron das glTF-Modell, liest `meta.json`, wendet `recommendedScale` an und instanziiert automatisch `PointLight`- oder `SpotLight`-Instanzen an definierten `sockets[]`.

### 2. Prefab-Defaults vs. Level-Instance-Overrides (Unity/Unreal-Paradigma)
- `meta.json` liefert die physikalischen Standardwerte des Props (z. B. Laterne: Scale `0.35`, Socket `FlameGlow` bei `[0, 0.16, 0]`, Farbe `#d49a3d`, Intensität `3.5`).
- Der Level-Deskriptor (`koje42.level.json`) besitzt explizites Override-Recht:
  - `scale`: Überschreibt `recommendedScale`.
  - `lightOverrides`: Überschreibt Farbe, Intensität oder deaktiviert das Licht (`false`).
  - `materialOverrides`: Überschreibt PBR-Eigenschaften (`roughness`, `metallic`, `emissiveIntensity`, `emissiveColor`) zur feinen Lichtabstimmung.

### 3. Deklaratives Level-Schema & Validierung
- Jedes Level wird als `*.level.json` definiert und gegen `public/schemas/level.schema.json` (JSON Schema Draft 2020-12) validiert.
- Unit-Tests (`LevelValidation.test.ts`) stellen sicher, dass alle Level-Manifeste schema-konform sind.

### 4. Trennung von Dressing und Story-Controller
- **Dressing (Daten/JSON):** Raumgeometrie, Prop-Platzierung, PBR-Overrides, Lichter und Hotspot-Konfigurationen leben in `koje42.level.json`.
- **Story & Gameplay (TypeScript):** Der Szenen-Controller (`prologue.ts`) lädt das Level deklarativ (`await this._kitRegistry.loadLevel(...)`) und konzentriert sich ausschließlich auf State-Machine-Abläufe, Timeline, Dialoge, Modals und Area-Transitions.

## Konsequenzen

- **Dramatisch sauberer Code:** Szenen-Controller schrumpfen um Hunderte Zeilen redundanten Boilerplates.
- **Hohe Iterationsgeschwindigkeit:** Requisiten und Lichter können im JSON editiert werden, ohne TS-Code anfassen zu müssen.
- **Maker-Kompatibilität:** Visuell in Maker platzierte Kits können direkt als `.level.json` exportiert und ohne Code-Anpassung in Spiele geladen werden.
- **Robuste Typensicherheit:** 100 % Strict TypeScript (`exactOptionalPropertyTypes`) ohne `any`.
