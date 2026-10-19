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
