# Config-Unterstrukturen verwenden benannte Schlüssel, keine `{ type, ... }`-Arrays

Wenn ein Config-Objekt mehrere "Arten" von Einstellungen gruppiert (Post-Processing-Effekte,
Renderer-Backends), schlüsseln wir sie nach Namen (`effects: { bloom: {...}, vignette: {...} }`,
`renderer: { WEB_GPU: {...}, WEB_GL2: {...} }`) statt über ein `type`-getaggtes Array
(`effects: [{ type: "bloom", ... }]`). Das kam in einer Session zweimal vor
(`PostProcessingConfig.effects`, `EngineOptions.renderer`), und beide Male war die Array-Form
aktiv irreführend: sie suggerierte eine Reihenfolge, die der Code gar nicht nutzte — die
Post-Processing-Effektkette ist fest im Shader verdrahtet (Bloom → HBAO → Tonemapping → Vignette
→ Grain → Quantize), unabhängig von der Config-Reihenfolge, und die Renderer-Fallback-Kette
(WebGPU → WebGL2 → WebGL1) ist in `RendererFactory` hartkodiert, wobei das Array nur je über
`.find(x => x.type === ...)` abgefragt wurde — ein Keyed-Lookup im Kostüm einer geordneten Liste.
Benannte Schlüssel geben zusätzlich Typsicherheit pro Art, ganz ohne diskriminierte Union, und
schließen strukturell doppelte/widersprüchliche Einträge für dieselbe Art aus.

**Wann das nicht gilt:** Wenn die Reihenfolge tatsächlich semantisch bedeutsam ist (z. B. eine
echte, sequenziell durchlaufene Prioritäts-Fallback-Liste), ist ein Array die richtige, ehrliche
Wahl — nicht reflexhaft alles in benannte Schlüssel zwingen. Erst prüfen, ob der Code die
Reihenfolge des Arrays tatsächlich liest, bevor man es annimmt.
