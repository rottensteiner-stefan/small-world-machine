# Scene & Asset-First Pipeline — Reusable Knowledge

> Distilliert am 2026-09-29 (v0.89.0) nach dem Asset-First-Refactor von Koje 42/Kältekammer.
> Dieses Repo liegt auf GitHub (nicht im GitLab-Index des Codebase-Search-MCP → dort nicht
> speicherbar; hier als tracked Note, ergänzend zu `backlog.md` + `apps/…/docs/log.md`).

## Deklarative Szenen-Bestückung (verbindlich)

- Die Whisper-Szenen werden über `*.level.json` DEKLARATIV bestückt — **kein prozeduraler
  Greybox-/Möbel-Fallback mehr**: `koje42.level.json` (Koje 42) + `kaeltekammer.level.json`
  (Kältekammer). Schema: `{ scene, items: [{ id, kit, reference, position, rotation, scale }] }`.
- **Runtime-Laden NUR via `new URL("./<file>.level.json", import.meta.url)`** (Vite-Cheese):
  `fetch().then(r => r.json())`. Absolute Pfade wie `/scenes/prologue/…` waren eine **stille 404**
  in Dev **und** Build (P0-Bug, September 2026 gefixt). Nicht zurück zu absoluten Pfaden.
- **Level-JSONs MÜSSEN unter `apps/` bleiben**: `packages/engine/tests/loaders/LevelValidation.test.ts`
  (`findLevelFiles`) scannt **nur `repoRoot/apps`**. Kein Umzug nach `public/` (lässt den Test
  auf 0 Dateien scheitern).
- Hand-Inspektion im Dev-HTML: `(window as …).__prologue` → PrologueScene-Instanz.

## Asset-QS & Kit-Grenzen

- **Blast-Door-Defekt (tripo3D-Quirk):** `flakturm/bunker_blast_door` ist ein einzelnes
  skelettloses Mesh und rendert bei recommendedScale ~0.92×1.0×0.94m — die Lieferanten-Meta
  (1.8×2.2×0.25m) ist unzuverlässig. In Szene als statische Panzertür verarbeitet
  (Vorderfläche bündig, Überlauf-Tiefe in den nicht-modellierten Flur). Für animierbare Tür:
  Asset neu skalieren oder eigenes schlankes Türblatt sourcen.
- **Kein Decal-System in der Engine:** Decals sind ad-hoc **transparente Ebenen**
  (Plane + StandardMaterial: `diffuseMap = alphaMap`, `transparent = true` →
  `depthWrite` automatisch false, `cullMode = NONE`). Texturen unter
  `public/assets/kits/flakturm/decals/` (sign_koje42, sign_sektor0, sign_hausangehoerige,
  hazard_stripes, guide_stripe_glow, rebar_damage). Vorbild: ID-Plate in prologue.ts,
  Decal-Preview in KitInspectorApp.
- `Plane` (packages/engine/src/geometry/Plane.ts) ist XY-orientiert, face +Z.
  Facing-Rotationen: +Z→+X = rotation.y=π/2, +Z→+Y = rotation.x=−π/2.

## Engine-/Repo-Hartregeln (Kurzreferenz)

- Rechtshändig (+X rechts, +Y oben, +Z zurück); Behaviors statt Controller-Listen;
  keine Global-Singletons; **NO any** (Linter); ·Fail-Fast (nie werfen in Settern).
- Property-Assignment: Batch aus mehreren Settern ok; werfen erst beim aktiven Verarbeiten.
- Commit: reine Zitate ohne Autor/Prefix, nie wiederverwenden (`git log` prüfen); CHANGELOG H3
  `"…" – Autor` + exakt 3 Kategorien; Versions-Sync via `node scripts/update-version.js`
  (bumpt `package.json` + ENGINE_VERSION in `SmallWorldMachine.ts`).
- Pre-commit-Hook (husky) = typecheck + prebuild + prettier + eslint auf Staged-Dateien; unter
  Last kann er >120s brauchen — Commits mit großzügigem Bash-Timeout fahren, nicht abbrechen.
- App-Logs: `apps/<app>/docs/log.md` append-only **unten** anhängen (deutsch);
  `backlog.md`: neue Einträge **oben**, Status-Legende 💡📋🔜✅❌.
- Vor Verifikation jeder Änderung: `npm run lint:fix`, `npm run build:lib`, `npm run test`
  (Stand v0.89.0: 201/1194 grün). SDFShaderChunks/Showcase6Plaques-Timeouts sind bei Last
  Umgebungs-Flakiness, nicht codebedingt.
