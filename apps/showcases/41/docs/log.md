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
