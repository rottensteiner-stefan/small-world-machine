# Liquid Goldens (M1)

Deterministischer Rendering-Baseline-Schutz für Showcase 10 („Waterworld & Liquid Gallery“) —
Teil von **M1** der Flüssigkeits-Roadmap (`.agents/collaborate/liquid-roadmap.md` §8.2).

Jede ausgabeändernde Shader-Änderung darf das Wasserbild nicht unbemerkt verändern. Diese Tools
fangen beides ab: **sichtbare Regressionen** (Bild weicht von der committeten Baseline ab) und
**stille Regressionen** (Canvas bleibt leer). Die Capture ist deterministisch: Showcase 10 läuft
im Golden-Mode (`?__golden=…`), der die Engine mit festem Timestep (`SmallWorldMachine.step(1/60)`)
schrittweise rendert und den letzten Frame einfriert — derselbe Zustand ergibt zweimal exakt
dieselben Pixel (kein WallClock-`performance.now()`-Drift).

## Was wird geprüft

| Matrix | Umfang                                                           | Verbindlichkeit                                                   |
| ------ | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| GL2    | 16 Pools × top/oblique = 32 Baseline-Bilder                      | verbindlich beim manuellen CI-Lauf (läuft nicht mehr automatisch) |
| GPU    | gleiche 32 Zellen                                                | nur informational (SwiftShader-Flakyness)                         |
| GL1    | gleiche 32 Zellen als Smoke (lädt, 0 Konsolenfehler, nicht leer) | kein Bildvergleich                                                |

Die committete Baseline liegt unter `.agents/goldens/liquid/baseline/` (GL2-Bilder + `manifest.json`).

## Workflow

```bash
npm run build                  # lib + Showcases bauen (nötig, Preview bedient /dist)
npm run goldens:capture -- --matrix gl2 --out .agents/goldens/liquid/baseline
npm run goldens:compare -- --baseline .agents/goldens/liquid/baseline \
  --current .agents/goldens/liquid/baseline
```

Die CI startet Capture+Compare **nur auf Anforderung**: Actions → „CI" → „Run workflow" (Schalter `goldens`; `smoke` ist
der Showcase-Smoke-Test, `gpu-goldens` die informationelle WebGPU-Aufnahme). Push und Pull Request laufen nur durch `verify`.
Der Job `liquid-goldens` ist in vier Shards geteilt (`--shard i/4`, 4 Pools je Shard): die Zellen sind unabhängig und
deterministisch, die Bilder ändern sich dadurch nicht, ein Lauf dauert etwa 5 statt 14 Minuten
(`ref: .github/workflows/ci.yml`).

### Shards

`capture.js` und `compare.js` kennen `--shard i/N` (1-basiert, Pools reihum verteilt, siehe `shard.js`). Beim Vergleich
eines Shards gelten nur dessen Zellen; Baseline-Zellen der anderen Shards zählen nicht als „fehlend". Ohne `--shard` bleibt
alles wie vorher (alle 32 Zellen).

## Regelmäßiger Ablauf

1. **Nach jeder ausgabeändernden Shader-Änderung** lokal gegen die Baseline prüfen:
   `npm run goldens:capture -- --matrix gl2 --out .agents/scratches/goldens/current` →
   `npm run goldens:compare -- --baseline .agents/goldens/liquid/baseline --current .agents/scratches/goldens/current`.
2. **Bei gewollter Baseline-Änderung** (absichtliches Re-Design): Prüfung fährt auf FAIL → nach
   Review die neuen Bilder nach `.agents/goldens/liquid/baseline/` kopieren und die
   `manifest.json` aktualisieren (Capture schreibt sie mit), committen.
3. **Regeneration der Baseline:** `npm run goldens:capture -- --matrix gl2 --out .agents/goldens/liquid/baseline`.
   **Wichtig (Stand 2026-10-08):** Der Vergleich ist nur im CI (Linux-Runner) verbindlich. Eine lokal auf dem Mac
   aufgenommene Baseline wich dort in vielen `oblique`-Zellen um 0,6 bis 1,8 % ab, obwohl lokal alles grün war.
   Die Baseline daher aus den CI-Artefakten übernehmen. Der Lauf ist geteilt, es gibt vier Artefakte `liquid-goldens-1`
   bis `liquid-goldens-4` (je Ordner `current/`); zusammenführen und in die Baseline legen:
   `gh run download <run-id> -p 'liquid-goldens-*' -D <dir>`, dann
   `node scripts/goldens/merge-shards.js --out .agents/goldens/liquid/baseline <dir>/liquid-goldens-*/current`
   (kopiert alle PNGs, fasst `manifest.json`/`summary.json` zusammen und bricht ab, wenn eine Zelle doppelt vorkommt). Der Capture wiederholt eine leere Zelle bis zu dreimal (SwiftShader
   liefert auf einem ausgelasteten Runner gelegentlich ein leeres Bild); eine Zelle mit Konsolenfehlern wird nie wiederholt.
   Der Preview-Port ist per `PREVIEW_PORT` (Default 4173) einstellbar.

## Drift zuordnen, bevor die Baseline neu aufgenommen wird

Weicht ein Capture von der Baseline ab, ist die Ursache zuerst zu klären. Capture und Compare
speichern bzw. prüfen die Browser-Version (`summary.json` → `browser`); `compare` warnt bei
einer Abweichung. Zwei Ursachen sind zu trennen:

- **Inhalt:** Showcase, Shader oder Material haben sich seit dem Baseline-Commit geändert.
- **Umgebung:** anderer Browser, andere Software-GL-Version.

Test: den Baseline-Commit mit der heutigen Pipeline rendern. Ist das Ergebnis byte-identisch zur
Baseline, ist die Umgebung ausgeschlossen und die Drift ist Inhalt.

```bash
git worktree add --detach <dir> <baseline-commit>
# node_modules im Worktree: Einträge des Hauptbaums verlinken, aber node_modules/@small-world-machine/*
# auf die Pakete des WORKTREES zeigen lassen -- sonst lädt die Seite zwei Engine-Kopien.
(cd <dir> && npx vite --host --port 4173 --strictPort) &
(cd <dir> && node scripts/goldens/capture.js --matrix gl2 --out <out> --skip-spawn --pool clear-water)
npm run goldens:compare -- --baseline .agents/goldens/liquid/baseline --current <out> --pool clear-water
```

Beispiel (2026-10-07): `9223d305` mit Chrome for Testing 152 → `clear-water` top und oblique
byte-identisch (0,0000 %). Die Drift der 20 Zellen stammte aus dem Showcase-10-Umbau.

**Baseline neu aufnehmen** nur, wenn die Bildänderung gewollt ist und die Bilder angesehen
wurden: im selben Commit wie die Änderung, mit der neuen Browser-Version im `summary.json`.

## CLI

- `goldens:capture -- --matrix <gl2|gpu|gl1> --out <dir> [--pool <key>] [--view <view>] [--frames <n>] [--skip-spawn] [--allow-no-golden]`
  - Startet `npm run preview`, besucht jede Zelle mit den Golden-Query-Params, wartet auf `window.__goldenReady`, screentshot das `<canvas>`.
  - Schreibt `<dir>/<poolKey>__<view>.png` + `manifest.json` (Metadaten, Blank-Flag, sha256) + `summary.json`.
  - `gl1` = Smoke (`<dir>/smoke/*.png`, nur Load/Fehler/Blank-Asserts).
  - Exit 0 nur wenn alle Zellen ok.
- `goldens:compare -- --baseline <dir> --current <dir> [--pool <key>] [--max-diff-ratio <f>] [--pixelmatch-threshold <f>] [--report <path>]`
  - `--current` ist Pflicht. Baseline-Zellen, die im Current fehlen, sind ein technischer Fehler (`--pool` schränkt die Prüfung auf einen Pool ein).
  - Vergleicht jede Zelle per `pixelmatch`, `diffRatio` = abweichende Pixel / Gesamtpixel.
  - Exit **0** = alles ok, **1** = technischer Fehler (Bild fehlt/unlesbar/blank), **2** = Drift-Verletzung.

## Konfiguration

`scripts/goldens/config.json`: Pools, Views, Backends, Viewport (1024×576), Framecount,
Blank-Schwelle (Luminanz-Stddev), `maxDiffRatio` (Standard 0.5 %), `pixelmatchThreshold`, sowie
per-Pool-Toleranzen in `poolOverrides` (z.B. bei bekannten Rauschartefakten einer Wasserart).

## Troubleshooting

- **`window.__goldenReady` kommt nie** → Showcase-Build zu alt: `npm run build`, dann erneut.
- **Weißer/leerer Canvas trotz Exit 0** → Blank-Detection greift nur im Manifest; diffiert,
  siehe `manifest.json`-`blank`-Flag. Kappe: `blankStddevThreshold`.
- **Port 4173 belegt** → bestehender `vite preview` läuft; mit `--skip-spawn` gegen diesen
  arbeiten oder Prozess beenden.
- **SwiftShader-Flakiness** → deterministisches Stepping minimiert das; der Capture wiederholt eine
  leere Zelle (Blank) bis zu dreimal (siehe Abschnitt „Baseline erzeugen“), eine Zelle mit
  Konsolenfehlern wird nie wiederholt. Für Diff-Ursachen im CI log nach `--pool`-Zelle und
  Diff-Größe suchen.
