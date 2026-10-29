# Showcase 41: Metal Wall Relief & Assemblage Art — Dev Log

## Herkunft & Selbstverständnis (Kontext)

Inspiriert von physischen 3D-Metall-Wandreliefs und Mixed-Media Assemblagen (geschweißtes/gehämmertes Blech, gespannte Stahldrähte, Streckmetall-Gitter, dicker Spachtelauftrag/Impasto und kontrastreiches Color-Pop wie knallrote Regenschirme oder Seilbahnen auf rohem Eisen).

Dieses Showcase dient als Referenz- und Verifikationsapp für das neue Extra-Package `@small-world-machine/artistic-extras`. Es demonstriert die Symbiose aus prozeduralen Shader-Formeln (Voronoi-Facetten, Schleifspuren, Kantenkrümmungs-Glanz) und echtem 2.5D-Diorama-Parallaxing mit interaktiver Kamera.

---

## 2026-10-20 — Erstellung & Vollwertige Integration

Showcase 41 wurde erstellt und nahtlos in die Showcase-Architektur eingebunden.

### Vorgenommene Änderungen

- **Extra-Package:** `@small-world-machine/artistic-extras` unter `packages/artistic-extras/` erstellt (`MetalReliefMaterial`, `MetalReliefPostProcessor`, `ArtisticColorUtils`).
- **Showcase 41 App:** `apps/showcases/41/` angelegt mit `index.html`, `showcase.ts`, `docs/concept-dossier.html` und `docs/log.md`.
- **Mode-Toggle (2.5D Diorama vs. Full-Screen Canvas Shader):**
  - Live-Umschaltung im HUD zwischen geometrischem 3D-Blechrelief mit Orbit-Kamera und 2D Full-Screen Canvas Shader mit prozeduraler Kanten-Extrusion (Sobel), Schleifspuren und selektivem Color-Pop.
  - Motiv-Presets (Paris Rain, Alpine Cable Car, Nordic Harbor).
- **Standardisiertes Control-Panel & Footer-Button (Referenz Sponza / Showcase 29):**
  - Kein unpassendes Floating-Overlay mehr: Pannel als Slide-in Drawer (`#reliefTuningHud`, `height: calc(100vh - 36px)`, Backdrop-Blur) direkt am Sponza-Muster ausgerichtet.
  - Standardisierter Open/Toggle-Button `.swm-inspector-btn` (`⚙`) unten rechts in der `.app-footer`-Leiste verankert.
  - Tastaturkürzel `I` (`KeyI`) zum Ein-/Ausklappen mit Input-Leak-Isolation (Kamera-Orbit wird bei Interaktion mit Slidern und Maus-Hover im Panel pausiert).
  - Aufgeräumtes `index.html` ohne Inline-CSS/HTML-Overlays.
- **Navigation-Ring:**
  - `40/index.html`: `next` → `../41/index.html`
  - `41/index.html`: `prev` → `../40/index.html`, `next` → `../1/index.html`
  - `1/index.html`: `prev` → `../41/index.html`
- **Build & Tests:**
  - `vite.config.ts`: `showcase41` im Rollup-Input registriert.
  - `scripts/check-showcases.js`: `"41"` in `numberedShowcases` aufgenommen.
  - `VALID_SHOWCASE_IDS` in `AbstractShowcase.ts` um `40, 41` ergänzt.
  - `public/index.html`: Showcase 41 in die Showcase-Galerie eingetragen.

---

## 2026-10-20 — Photo-to-Metal Relief Converter & Before/After Wipe-Slider

Ausbau von Showcase 41 zum vollwertigen Foto-zu-Metallrelief-Konverter mit authentischen realistischen Fotografien und Direktvergleich:

### Vorgenommene Änderungen

- **Realistische Ausgangsfotografien:**
  - 3 hochauflösende Fotografien als Ausgangsbasis generiert und integriert: `paris_photo.jpg` (Pariser Boulevard im Regen mit rotem Regenschirm & Eiffelturm), `alps_photo.jpg` (alpine Schneelandschaft mit roter Seilbahngondel), `harbor_photo.jpg` (nordischer Hafen mit rotem Segelboot).
- **Split-Screen Wipe Shader (`MetalReliefScreenMaterial`):**
  - Shader-Uniform `u_styleB.x` als Split-Position implementiert (in GLSL300, GLSL100 und WGSL).
  - Bei `splitPosition >= 0.0`: Linke Seite zeigt das unberührte Originalfoto (`centerTex.rgb`), rechte Seite zeigt das plastische Metallwandrelief mit Sobel-Prägung, Spachtel-Facetten, Schleifspuren und Kanten-Glanz; getrennt durch eine präzise 2px-Trennlinie.
  - WebGL1- und WebGL2-Shader-Pfade gehärtet (unconditional `u_diffuseMap`-Sampling ohne inaktive Defines).
- **Interaktiver Wipe-Slider & Drag-Handle:**
  - Schwebender vertikaler Trennstrich mit zentriertem Anfasser `[ ◀ ❘ ▶ ]` und Floating-Badges (`ORIGINAL PHOTO` links, `3D METAL RELIEF` rechts).
  - Direktes horizontales Ziehen mit der Maus auf der Canvas oder am Handle verschiebt den Split in Echtzeit.
  - HUD-Regler und Schnellwahltasten (`50% Split`, `100% Photo`, `100% Metal`).
- **Universal Drag & Drop & Upload:**
  - Beliebige Bilddateien (`.png`, `.jpg`, `.webp`) können direkt aus dem Finder/Desktop auf das Browserfenster gedroppt werden.
  - Automatisches Laden via `Texture.fromUrl()`, Ermitteln der Original-Aspect-Ratio und Anpassung des Meshs ohne Verzerrung.
  - Datei-Auswahldialog ("📁 Drop photo or browse") im Drawer-Panel integriert.
- **Tastatursteuerung & Verifikation:**
  - `Space` / `KeyW`: Schnelles Umschalten zwischen 50%-Split und Vollansicht.
  - `KeyM`: Wechsel zwischen Foto-Konverter und 2.5D-Assemblage-Diorama.
  - `1-3`: Direktwahl der drei Fotomotive.
  - Volle Verifikation via Puppeteer in WebGPU, WebGL2 und WebGL1 erfolgreich bestanden.

---

## 2026-10-29 — Seitenpanel nach `Hud.ts` ausgelagert

- Das „Metal Relief Lab“-Panel lebt jetzt in `apps/showcases/41/Hud.ts` (Klasse `MetalReliefHud`) auf dem gemeinsamen Baustein `apps/showcases/shared/ShowcaseDrawer.ts` (Drawer-Markup, Event-Abschirmung, Footer-Button, I/H).
- `showcase.ts` behält Szene, Materialien und Hover-/Orbit-Logik; das Panel meldet sich über das Host-Interface `MetalReliefHudHost` (`setMode`, `setParam`, `onPanelClosed` …) und synchronisiert per `syncMode`/`syncSplit`/`syncPreset`.
- Entfernt: eigenes Panel-/Button-CSS (Duplikate von `shared.css`). Behalten: dichtere Zeilen/Buttons, Select-Rahmen, Tool-Theme-Akzent am Footer-Button (`#reliefPanelOpenBtn`, Icon ⚙), Drop-Zone. Alle Element-IDs unverändert; neu ist nur `H` als zweite Panel-Taste.
