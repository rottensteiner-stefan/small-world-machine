# ADR 0045: Linien-Caster werfen Schatten mit Weltbreite

- **Status:** Accepted (2026-10-24, vom Nutzer freigegeben)

Ein Objekt mit `LINE_LIST`-Material (`WireframeMaterial`) und `castShadow` zeichnete seine Kanten als
1-px-Linien in die Shadow-Map. Damit war der Schatten immer **ein Shadow-Texel** breit: dick und perlig
bei 1024 px, fast unsichtbar bei 8192 px, je Cascade unterschiedlich, und bei EVSM ein Kammmuster,
weil das breite Filtergitter eine 1-Texel-Linie überspringt. Wir zeichnen die Kanten deshalb **nur im
Shadow-Pass** als Quads mit einer Breite in Weltmetern (`WireframeMaterial.shadowWidth`), mindestens
1,5 Texel. Der Main-Pass bleibt bei 1-px-Linien.

## Abgelehnte Alternativen

- **Gizmo-Konvention (Linien werfen nie):** richtig für Overlays, bleibt über `castShadow` (Default
  `false`) erhalten. Ein Draht, der Schatten werfen soll, braucht aber einen Weg dafür.
- **three.js (`wireframe = true` wirft den Vollkörper-Schatten):** ein Gitter mit massivem Schatten
  sieht wie ein Bug aus.
- **Echte Röhren-Geometrie:** physikalisch korrekt, aber Dreieckskosten, und der Draht müsste als Mesh
  im Asset existieren.
- **Coverage-/Alpha-Schatten:** wäre auch unter 1 Texel abschwächbar, braucht aber eine eigene
  Coverage-Map. Overengineering für Drahtgitter.

## Umsetzung

- `LineShadowRibbon` baut pro Geometrie und `WireframeMode` einmal 6 Vertices pro Kante: eigener
  Endpunkt (Slot 0), Gegen-Endpunkt (Normal-Slot), Seite/Ende (UV-Slot). Gecacht in `GPUGeometryCache`
  bzw. `Mesh`, nach `needsUpdate` in place neu geschrieben.
- `LineShadow.vert.wgsl` / `.glsl` (identische Mathe): Kantenrichtung in NDC, Normale senkrecht dazu,
  Welt→Clip-Skala = Länge der `vp`-Zeilen. Das gilt für Ortho-Cascades und perspektivische Spots ohne
  lichtspezifischen Code. `u_extraParams = [1, alphaTest, Texel in NDC, halbe Breite]`.
- Eigene Shader-Varianten `DepthMaterial.LINE_QUADS_SHADER_ID` / `EvsmMomentMaterial.LINE_QUADS_SHADER_ID`
  (TRIANGLE_LIST, Culling aus). `RenderBatch.shadowWidth` entscheidet in den Passes
  (`usesLineQuadShadow`). Gilt auf beiden Tiers für CSM, Spot, EVSM und `InstancedMesh`.
- `shadowWidth = 0` (Default) lässt alles byte-identisch zum 1-Texel-Pfad.

## Konsequenzen

- Unter 1,5 Texeln gewinnt die Mindestbreite: Der Schatten wird dann wieder auflösungsabhängig, nur
  ohne Löcher.
- EVSM braucht etwa 5 Texel Breite, bis das Kammmuster verschwindet (Eigenschaft von ADR 0043).
- Skinned Linien-Caster bekommen keine Ribbon-Variante (Joints für beide Endpunkte fehlen). Sie
  würden bei `shadowWidth > 0` falsch transformiert und sind ausdrücklich nicht unterstützt.
