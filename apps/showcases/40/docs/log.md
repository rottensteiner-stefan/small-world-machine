# Showcase 40: Decal Probe — Dev Log

## Herkunft & Selbstverständnis (Kontext)

Die Decal Probe begann als Verifikationsseite des Decal-Systems — gebaut als
`apps/showcases/decal-probe` parallel zu [ADR 0028 (Thin Normal Buffer MRT)](../../../docs/adr/0028-thin-normal-buffer-mrt.md)
und [ADR 0029 (Decal-System)](../../../docs/adr/0029-decal-system.md). Ihre Aufgabe war nie
„schön anzuschauen", sondern kontrollierte GPU-Fragestellungen auf echter Hardware zu beantworten:
Normal-Buffer-Integrität unter Decals, TBN-Normalen-Blending, Backend-Parität zwischen WebGPU,
WebGL2 und WebGL1, das Recycling-Verhalten von `DecalPool`, den Mesh-Decal-Baker für WebGL1 und
die ORM-/Emissiv-/Nass-Pfade. Die Szenen-Varianten werden über Abfrageparameter umgeschaltet und
von den Prüfskripten `npm run test:decals` (`scripts/check-decals.mjs`) und
`node scripts/measure-decal-mips.mjs` headless aufgerufen. Beide Skripte teilen sich die
Weltkoordinaten mit den Szenen-Modulen (`poolScene.ts`, `ormScene.ts`, `wetScene.ts`, `mipScene.ts`)
— Layout-Änderungen dort brauchen eine Skript-Anpassung.

Bis zum 2026-10-19 gab es für diese App kein `docs/`; die Historie ist über
Git-History, CHANGELOG, ADR 0028/0029 und `docs/guides/decals.md` rekonstruierbar.

---

## 2026-10-19 — Vollwertige Integration als Showcase 40

Die Probe wurde per `git mv` nach `apps/showcases/40` umbenannt und als Showcase 40 vollwertig in
die Showcase-Struktur integriert (Nummer 40 war frei; höchste bisherige Nummer: 39).

### Vorgenommene Änderungen (path-scoped)

- **Rename:** `apps/showcases/decal-probe/` → `apps/showcases/40/` (`git mv`, History erhalten).
- **Register & Build:** `vite.config.ts` — Eingang `decalProbe` → `showcase40`
  (`apps/showcases/40/index.html`); der `showcase-layout`-Transform greift jetzt (vorher fehlten
  `prev`/`next` im Tag, daher wurde kein Header/Footer injiziert).
- **Navigation-Ring:** `39/index.html` `next` → `../40/index.html`;
  `40/index.html` `prev` `../39/index.html` + `next` `../1/index.html`;
  `1/index.html` `prev` → `../40/index.html` (schließt den zuvor seit Showcase 39 veralteten Ring).
- **Check-Skripte:** `scripts/check-showcases.js` führt `40` mit; `scripts/check-decals.mjs` und
  `scripts/measure-decal-mips.mjs` zeigen auf `apps/showcases/40/index.html`.
- **Galerie & README:** `public/index.html` (Label „(1–40)", 39 Demos; Einträge 39 *und* 40 —
  39 war in der Galerie übersehen worden), `README.md` (39 nummerierte Showcases 1–24, 26–40;
  `decal-probe`-Erwähnung entfernt).
- **Doku:** `docs/guides/decals.md` verweist auf Showcase 40; dieses `docs/log.md` + neues
  `concept-dossier.html`.
- **CHANGELOG:** Eintrag unter `[Unreleased]` / Features.
- **Historische Referenzen bewusst unangetastet:** ADR 0028/0029, ADR-Index und
  `docs/research/decal-system-plan-2026-10-12.md` sowie der CHANGELOG-Alt-Eintrag nennen weiterhin
  den alten Pfad `apps/showcases/decal-probe` als historischen Stand.

### Verifikation

- `git status` auf meinen Pfaden sauber; fremde WIPs (Voxel-Prototype, RainStreaks-Migration) unangetastet.
- `npm run build:showcases` (Vite-Build): erfolgreich — `dist/apps/showcases/40/index.html` wird mit
  injiziertem `showcase-layout`-Header/Footer gebaut, `apps/showcases/showcase40/showcase.js` wird
  unter dem Standard-Namensschema emittiert.
- ESLint auf allen geänderten Dateien: 0 Fehler. `typecheck` (repo-weit) nur auf
  fremdem, uncommittetem Voxel-WIP rot — keine meiner Dateien.
- Browser-Check `node scripts/check-showcases.js 40`: WebGL2/WebGPU/WebGL1 je `✅ OK`
  (keine Konsolenfehler, kein Blank-Canvas).
- `npm run test:decals` gegen den neuen Pfad: sämtliche GPU-Readback-Assertions grün; die 2
  blockierenden Fehler (`AO texture unavailable` unter WebGL2) sind Umgebungslimiten des Headless-
  Preview-Laufs, kein Rename-Befund — Seiteninhalt unverändert, Standard-Showcase-Check läuft sauber.
- Navigation-Ring per Grep auf den gebauten wie Quell-`index.html`-Attributen verifiziert
  (39→40→1, Header-Injektion für 39/40/1 im Build bestätigt).

---

## 2026-10-31 — Interaktives „Decal Probe Lab" (HUD/Panel)

Showcase 40 erhielt ein interaktives HUD-Panel im etablierten Showcase-Lab-Muster
(`ShowcaseDrawer`-basiertes `Hud.ts`, Präzedenz 1/20/43/44/45), um die bislang nur per
Query-Parameter erreichbaren Decal-Parameter direkt ausprobierbar zu machen.

### Umfang (freigegeben: Kern-Lab Hauptszene, Panel-Sprache Englisch)

- **`apps/showcases/40/Hud.ts`** (neu): Panel „Decal Probe Lab" (🏷, Footer ⚙, I/H-Toggle) —
  Sektionen Lighting (Sun/Ambient-Slider), Floor Surface (Bump-Presets None/Tilt/Stripes =
  `?bump` 0/1/2), Probe Decals (NormalProbe Opacity + Edge Fade, Unlit-Switch), HBAO
  (Toggle + Radius/Intensity), Reset-to-Reference (0). Event-driven `sync`, nie pro Frame.
- **`apps/showcases/40/showcase.ts`**: Feld-Refaktoren + Verdrahtung. Lab nur in der
  interaktiven Hauptszene (Probe-Query fehlt); `start()`-Override mountet nach
  `super.start()`, `destroy()` disposed, `onKeyDown` (0 = Reset, 1–3 = Bump, U = Unlit).
  Kein Konflikt mit `AbstractShowcase`-Keys (B = Debug, Alt+1..3 = Renderer-Switch, R = Reset).
- **Laufzeit-Mutation engine-gestützt** (verifiziert, MEMORY §4-H): `DecalMaterial`
  `unlit`/`normalMap`/`edgeFade`/`color.a` — Renderer lesen `getRenderManifest()` pro
  Objekt/Frame, `flags` fließen in Programm-/Pipeline-Keys (`programCacheKey`,
  `getMaterialBGL`). Post zur Laufzeit auf allen Tiers (WebGL1 `_reconcilePostProcess`);
  HBAO-Toggle disables laute Default-Siblings (Vignette/Grain/Bloom), damit der AO-Knopf
  nur HBAO (+ ToneMapping) zeigt.

### Bewusst NICHT (QA-Integrität)

- QA-Probes `?pool=1` (+`shoot`), `?wet=1`, `?orm=1`, `?mip=1` bleiben byte-identisch und
  HUD-frei für `check-decals.mjs` / `measure-decal-mips.mjs`.
- Query-Param-Kontrakt (`?nb`, `?pp`, `?hbao`, `?unlit`, `?bump`, `?spot`, `?bake`,
  `?rendererType`) vollständig erhalten.
- `?bump=1/2`-Init-Verhalten unverändert (nur Registrierung des Materials, keine Look-Änderung).

### Verifikation

- `lint:fix` 0 Fehler, `typecheck` 0 Fehler, `build:showcases` grün.
- `check-showcases.js 40` grün auf WEB_GL2/WEB_GPU/WEB_GL1 (Default-Szene inkl. neuem HUD,
  Canvas-Clip-Screenshot ungestört).
- `npm run test:decals` — alle WebGPU-Assertions grün; die 2 bekannten Umgebungs-Blocks
  (`AO texture unavailable`, nur Headless-Preview) unverändert; Backend-Parität (Bump-
  Normalen, Probe-Normalen, Sky-Sentinel) grün.
- `measure-decal-mips.mjs` gegen Preview-Server — Mip-Bias-Reaktion intakt.
- Voll-Suite `npm run test`: 487 Dateien / 3674 Tests grün.
- MEMORY.md §4-H + §5 (Lab-Muster, Laufzeit-Mutations-Invarianten, Showcase-40-Eintrag) gepflegt.
