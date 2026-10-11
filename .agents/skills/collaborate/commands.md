# Steuer-Kommandos im Detail

Ausgelagert aus `SKILL.md` Abschnitt 7 (dort steht auch der Hinweis zur Idempotenz — er gilt für alle Befehle hier). Querverweise („Abschnitt N“, „Step N“) beziehen sich auf `SKILL.md`.

## Befehlstabelle

### Steuerungs- & Notfall-Kommandos
| Befehl | Aktion | Beschreibung & Wirkung |
| :--- | :--- | :--- |
| `/collaborate --pause [<FileName>]` | **Pause** | Friert die Session sofort ein, setzt `status: "paused"` und merkt `paused_agent`. |
| `/collaborate --resume [<FileName>]` | **Fortsetzen** | Nimmt die pausierte Session wieder auf; der `paused_agent` arbeitet weiter. |
| `/collaborate --stop [--outcome NO_CONSENSUS\|MAJORITY_WITH_DISSENT] [<FileName>]` | **Beenden** | Beendet die Session endgültig, setzt `status: "terminated"` und hängt einen Abschluss-Block ans Topic-Dokument. Im Modus `decide` legt `--outcome` das Ergebnis fest (Voraussetzungen siehe 10.6); andere Outcomes sind über `--stop` nicht setzbar (`MODERATOR_DECISION` nur über `--decide`, `CONSENSUS` nur über die Unterschriften der Agenten). |
| `/collaborate --kick <AgentName> [<FileName>]` | **Hängenden Agenten entfernen** | Entfernt `<AgentName>` aus dem `roster`. War er `active_agent`, rückt der nächste im Round-Robin nach (`current_round` steigt nur, wenn die Rotation dabei über das Roster-Ende auf Index 0 umbricht). Siehe Abschnitt 7 & 8. |
| `/collaborate --note "<Text>" [<FileName>]` | **Moderator-Hinweis ins Dokument** | Der angesprochene Agent schreibt den Text **wörtlich** als `[MODERATOR_NOTE <ISO-Zeitstempel>] <Text>` ins Topic-Dokument und trägt `action: "moderator_note"` in `history` ein (`revision + 1`). Nur Notes mit passendem `history`-Eintrag gelten als echt (8.2). Kein Zustands- und kein Zugwechsel. |
| `/collaborate --decide "<Entscheidung>" [<FileName>]` | **Moderator-Entscheidung (Tie-Break)** | Zulässig in jedem Status außer `terminated`. Setzt `outcome: "MODERATOR_DECISION"`, `status: "terminated"` und schreibt den Ergebnis-Block (10.6) mit der Entscheidung und den bis dahin dokumentierten Positionen. |
| `/collaborate --approve [P<n>] [<FileName>]` | **Moderator-Bestätigung (nur Selbst-Planung)** | Nur im Modus `plan` mit **genau 1 Agent**: bestätigt den offenen Vorschlag `P<n>` (Standard: der aktuelle). Der angesprochene Agent schreibt `[MODERATOR_APPROVAL P<n> <ISO-Zeitstempel>]` ins Topic-Dokument, trägt `action: "moderator_approval"` (mit `proposal`) in `history` ein und ergänzt `"moderator"` in `consensus.signatures` (`revision + 1`). In allen anderen Konstellationen ablehnen — dort unterschreiben die Agenten selbst. |
| `/collaborate --extend <Rounds> [<FileName>]` | **Rundenlimit erweitern** | Erhöht `max_rounds` um `<Rounds>`, setzt `deadlock` zurück auf `idle`/`working` und ermöglicht weitere Runden. |

### Diagnose
| Befehl | Aktion | Beschreibung & Wirkung |
| :--- | :--- | :--- |
| `/collaborate --status` | **Registrierungs- & Status-Abfrage** | Prüft, an welchen Themen der aufgerufene Agent (bzw. die Session) beteiligt oder registriert ist. Durchsucht `.agents/collaborate/*.pid` und gibt eine Tabelle mit Thema, Name/Rolle, Status, Runde und Ballbesitz aus. |

---

### ⏸️ `/collaborate --pause`
- **Ablauf beim angesprochenen Agenten:**
  1. Agent liest `<topic>.pid`. Steht der Status auf `"waiting_for_moderator"`, gibt es nichts zu pausieren: Befehl ablehnen (erst `--start`), sonst würde ein späteres `--resume` den Startschuss umgehen.
  2. Agent vermerkt in der PID:
     - `status: "paused"`
     - `paused_agent: "<Name des aktuell aktiven Agenten>"`
     - neuer `history`-Eintrag: `action: "session_paused_by_moderator"`.
  3. Agent speichert `<topic>.pid` (Regeln aus 4.1).
  4. Agent meldet dem Moderator — Statuszeile `Paused` zuerst (siehe 5.1), danach:
     *„⏸️ **Verhandlung pausiert.** Status in `<topic>.pid` auf 'paused' gesetzt für: **<paused_agent>** (Runde <N>). Bereit für `/collaborate --resume` oder `/collaborate --stop`.“*
  5. Agent beendet seine Ausführung und wartet.

### ▶️ `/collaborate --resume`
- **Ablauf:**
  1. Agent liest `<topic>.pid`.
  2. Agent prüft `paused_agent`:
     - Ist dieser Agent der `paused_agent`? → Er setzt `status: "working"`, meldet die Statuszeile `Working` (siehe 5.1) und führt seinen Zug normal aus bzw. beendet ihn.
     - Ist ein anderer Agent der `paused_agent`? → Agent setzt `status: "idle"`, `active_agent: paused_agent`, meldet die Statuszeile `Waiting` (siehe 5.1) und dem Moderator: *„▶️ Session fortgesetzt. Ball liegt bei **<paused_agent>**.“*
  3. Eintrag in `history`: `action: "session_resumed_by_moderator"`.

### ⏹️ `/collaborate --stop`
- **Ablauf:**
  1. Agent liest `<topic>.pid` (Abschnitt 5, Step 1).
     - Ist `status` bereits `"terminated"` (Idempotenz, siehe Hinweis oben), ist der Befehl ein **No-op**: keinen Abschluss-Block erneut anhängen, keine `revision` erhöhen, keinen neuen `history`-Eintrag. Statuszeile `Waiting` und nur den bereits erreichten Zustand bestätigen.
  2. Andernfalls setzt der Agent in `<topic>.pid`:
     - `status: "terminated"`
     - `history`-Eintrag: `action: "session_terminated_by_moderator"`.
  3. Agent fügt am Ende von `<topic>.<ext>` einen Abschluss-Block an:
     ```markdown
     ---
     ## ⏹️ Verhandlung durch Moderator beendet — <Datum>
     - **Letzter Stand:** Runde <N>, aktiver Agent: <active_agent>.
     - **Status:** <je nach Lage: „Beendet ohne finalen Konsens.“ — oder, bei `consensus.reached: true`: „Beendet nach erreichtem Konsens/erteilter Abnahme.“>
     ```
     Im Modus `decide` ersetzt der Ergebnis-Block aus 10.6 diesen Abschluss-Block; `outcome` wird dann auf `NO_CONSENSUS` gesetzt, sofern nicht bereits ein Ergebnis feststeht (bei `MAJORITY_WITH_DISSENT` bestätigt `--stop` das Ergebnis, 10.6).
  4. Agent meldet dem Moderator:
     *„⏹️ **Verhandlung endgültig beendet.** Der Status in `<topic>.pid` und im Topic-Dokument ist als 'terminated' archiviert.“*

### 👢 `/collaborate --kick <AgentName>`

**Wichtig:** `roster` ist ein Array — das Entfernen eines Eintrags verschiebt die Indizes aller nachfolgenden Einträge nach unten. `turn_index` darf deshalb NIE einfach unverändert oder naiv weitergezählt werden; er muss nach jedem Kick per Namenssuche im *neuen* Array neu aufgelöst werden, sonst verletzt du die Invariante `active_agent === roster[turn_index].name` aus Abschnitt 4.

- **Ablauf:**
  1. Vor jeder Array-Änderung den Namen des aktuellen `active_agent` merken (`prevActiveName`).
  2. **Fall A — der gekickte Agent war NICHT `active_agent`** (z. B. ein wartender Teilnehmer): Nur aus `roster` entfernen, dann `turn_index = roster.findIndex(a => a.name === prevActiveName)` im neuen Array neu setzen. `active_agent` und `status` bleiben unverändert — der laufende Zug ist vom Kick nicht betroffen.
  3. **Fall B — der gekickte Agent WAR `active_agent`** (der hängende/tote Teilnehmer, den man loswerden will): Vor dem Entfernen den Namen des nächsten Round-Robin-Kandidaten im *alten* Array bestimmen: `nextName = roster[(oldIndex + 1) % roster.length].name`. Erst danach den gekickten Eintrag entfernen, dann `turn_index = roster.findIndex(a => a.name === nextName)` im neuen Array, `active_agent = nextName`, `status: "idle"`.
     - **Wrap-Regel:** Brach die Rotation dabei über das Roster-Ende um (`oldIndex` war der letzte Eintrag), ist das ein Rundenwechsel: `current_round + 1` und anschließend die Rundenlimit-/Stagnationsprüfung aus Abschnitt 5 Step 3 — sonst würde ein Kick eine Runde „verschlucken“.
  4. **Unterschriften & Vorschlag bereinigen:** Hatte der gekickte Agent Einträge in `consensus.signatures`, werden sie entfernt; der Vorschlag gilt dann nur noch gegenüber dem verbleibenden Roster. **War der gekickte Agent selbst der Vorschlagende** (`proposed_by`), gilt der offene Vorschlag als zurückgezogen: `consensus` auf `proposal_id: null`, `proposed_by: null`, `signatures: []` zurücksetzen und `history` den Vermerk `withdrawn_proposal: true` geben; der nächste Agent hält das im Dokument als `[WITHDRAWN: P<n>]` fest und kann bei Bedarf einen neuen Vorschlag mit neuer ID stellen.
  5. **Sonderfall — Roster danach leer (0 Teilnehmer):** Die Verhandlung kann nicht fortgesetzt werden. `status: "terminated"` setzen und denselben Abschluss-Block wie bei `--stop` anhängen, mit dem Vermerk „beendet durch Kick auf 0 Teilnehmer“.
  6. **Sonderfall — Roster danach auf 1 Teilnehmer:**
     - **Modus `plan`:** Die Session läuft mit dem Einzelnen als **Selbst-Planung** weiter (Abschnitt 6, Sonderfall), ohne Pause: ab jetzt braucht ein Konsens zusätzlich die Moderator-Bestätigung (`--approve`), und jeder Zug enthält einen Red-Team-Abschnitt. Wer stattdessen einen Ersatz will, lädt ihn per `--invite` ein (der Moderator kann vorher `--pause` setzen).
     - **Modus `decide`:** 1 Agent + Moderator ist ausdrücklich zulässig (10.7) — die Session läuft mit dem Einzelnen weiter, ohne Pause.
  7. Schreiben nach den Regeln aus 4.1 (atomar, `revision + 1`).
  8. Eintrag in `history`: `action: "agent_kicked_by_moderator"`, mit dem entfernten Namen und dem greifenden Fall (A/B).
  9. Agent meldet dem Moderator den neuen Stand (wer aktiv ist bzw. dass die Session terminiert/pausiert wurde) — Statuszeile zuerst (siehe 5.1): `Working`, falls der meldende Agent selbst jetzt `active_agent` ist, sonst `Idle`/`Paused` je nach neuem `status`.
- Dies ist das einzige im Protokoll vorgesehene Mittel, einen nicht mehr antwortenden Teilnehmer aus der Rotation zu nehmen — es gibt keinen automatischen Timeout (Abschnitt 8). Ohne `--kick` bleibt die Session bei einem toten Agenten für immer auf `"idle"` stehen.

### 📊 `/collaborate --status`

Prüft, an welchen Kollaborations-Themen der aufgerufene Agent (bzw. die aktuelle Session) registriert oder beteiligt ist.

- **Ablauf beim aufgerufenen Agenten:**
  1. Der Agent scannt das Kollaborations-Verzeichnis (`.agents/collaborate/` bzw. den gesamten Workspace) nach allen `.pid`-Dateien (`*.pid`).
  2. Für jede gefundene `.pid`-Datei liest er das JSON und wertet aus:
     - **Thema:** `topic_file` (z. B. `.agents/collaborate/god-objects-refactoring.md`) und `mode`.
     - **Registrierte Teilnehmer & Rollen:** alle `roster`-Einträge (Name, Rolle, Channel, ggf. stance).
     - **Eigene Registrierung:** ob der angesprochene Agent / die Session unter einem oder mehreren Namen im `roster` steht.
     - **Session-Status:** `status` (z. B. `working`, `idle`, `waiting_for_moderator`, `paused`, `consensus_reached`, `deadlock`, `terminated`).
     - **Rundenfortschritt:** `current_round` von `max_rounds`.
     - **Ballbesitz / aktiver Zug:** Wer ist `active_agent`? Ist der aufgerufene Agent selbst dran (`Du bist am Zug / Working`) oder wartet die Verhandlung auf jemand anderen?
     - **Hänger-Hinweis:** Zeitstempel des letzten `history`-Eintrags; liegt er lange zurück, ausdrücklich auf einen möglicherweise hängenden `active_agent` hinweisen (siehe 8.1).
  3. **Ausgabeformat an den Moderator:**
     - Strukturierte Übersichtstabelle:
       ```markdown
       ### 🔍 Kollaborations-Status & Registrierungen

       | Thema / Datei | Registrierter Name & Rolle | Session-Status | Runde | Ballbesitz / Nächster Schritt |
       | :--- | :--- | :--- | :--- | :--- |
       | `god-objects-refactoring.md` | **Alice** (*Architect & Engine Lead*) | `idle` | 3 / 5 | ⏳ Wartet auf **Bob** (`/collaborate --invite Bob ...`) |
       | `diorama.md` | **Alice** (*Environment Lead*) | `consensus_reached` | 2 / 5 | ✅ Konsens erzielt |
       ```
     - Ist der Agent an keiner Kollaboration beteiligt oder existieren keine `.pid`-Dateien:
       *„🔍 **Keine aktiven Kollaborations-Registrierungen gefunden.** (In `.agents/collaborate/` existieren keine aktiven Sessions für diesen Agenten).“*

---

### 👁️ `collab.mjs watch` (Autonomes, ressourcenfreies Warten)

Ermöglicht Agenten, Hintergrund-Tasks oder Subagent-Runnern, verlustfrei und ohne CPU-/Token-Verbrauch darauf zu warten, dass sie am Zug sind.

- **Aufruf:**
  ```bash
  node .agents/skills/collaborate/collab.mjs watch <TopicDatei> <AgentName> [--timeout <Sekunden>] [--interval <ms>]
  ```
- **Funktionsweise:**
  1. **Sofortprüfung:** Ist `<AgentName>` bereits `active_agent` und der Status `idle`/`working` (oder ist die Session bereits `terminated`/`deadlock`), beendet sich der Befehl sofort mit Exit-Code 0.
  2. **OS-Dateisystem-Watcher (`fs.watch`):** Registriert einen ereignisgesteuerten OS-Watcher auf die `.pid`-Datei sowie das Verzeichnis (reagiert auf atomare Replaces). Der Prozess schläft ohne CPU-Last.
  3. **Fallback-Polling (Standard: 1000ms):** Fängt eventuell verpasste File-Events auf, ohne messbare Last zu erzeugen.
  4. **Aufwachen:** Sobald der Vorzug beendet ist (`end-turn`) und `active_agent === AgentName`, gibt der Watcher ein JSON-Objekt aus und beendet sich mit Code 0:
     ```json
     {
       "done": true,
       "event": "turn_ready",
       "agent": "Bob",
       "round": 2,
       "status": "idle",
       "timestamp": "2026-10-01T19:30:00Z"
     }
     ```
- **Autonome Agenten-Schleife (z. B. im CLI / Subagent-Harness):**
  ```bash
  # In der Shell des Agenten: Warten, bis Zug bereit, dann Zug ausführen
  node .agents/skills/collaborate/collab.mjs watch diorama.md Bob && \
    node .agents/skills/collaborate/collab.mjs begin-turn diorama.md Bob
  ```

---

## 📋 Blackboard & Event-Sourcing (Parallele Kollaboration)

Neben dem strikten Round-Robin-Verfahren (`.pid`) unterstützt das Collaborate-Protokoll ein paralleles **Blackboard-Muster** mit **Single Append-Only Log (`<topic>.board.jsonl`)**.

### Kernprinzipien:
1. **Lock-Free POSIX Atomic Append:** Ereignisse werden als JSON-Zeilen via `fs.appendFileSync(..., { flag: 'a' })` angehängt. In POSIX-Systemen (macOS, Linux) sind Append-Schreibvorgänge unter 4 KB atomar. Es gibt keine Sperrkonflikte (`.lock`) zwischen parallelen Subagenten.
2. **Deterministische Projektion (`State = Reducer(Events)`):** Der Zustand des Blackboards (Aufgaben, Findings, Vorschläge, Votes) wird rein funktional aus dem Event-Stream abgeleitet (`projectBoard`).
3. **Live Markdown-Projektion (`<topic>.md`):** Der aktuelle Board-Stand wird durch `render` in ein sauberes Markdown-Dokument mit Tabellen und Formatierung kompiliert.
4. **Zero-Resource Watcher (`board-watch`):** Parallele Worker schlafen via `fs.watch` ressourcenfrei (0% CPU, 0 Token), bis eine Aufgabe zugewiesen, abgeschlossen oder ein Ereignis eingetroffen ist.

### Blackboard CLI-Befehle

| Befehl | Zweck | Parameter & Optionen |
| :--- | :--- | :--- |
| `board-init <topic> [Coordinator]` | Blackboard initialisieren | `[--mode plan\|decide] [--role <Rolle>] [--stance <Stance>]` |
| `board-join <topic> <Agent>` | Teilnehmer registrieren | `[--role <Rolle>] [--stance <Stance>]` |
| `post-task <topic> <Author> "<Title>"` | Aufgabe anheften | `[--assign <Agent>] [--id <T<n>>]` |
| `claim-task <topic> <Agent> <TaskId>` | Aufgabe übernehmen | Setzt Task-Status auf `in_progress` |
| `complete-task <topic> <Agent> <TaskId>` | Aufgabe abschließen | `[--result "<Zusammenfassung>"]` |
| `post-finding <topic> <Agent> --title "<Titel>"` | Erkenntnis / Befund anheften | `[--task <TaskId>] [--severity info\|minor\|major\|critical] [--file <Pfad>] [--line <N>] [--desc "<Beschreibung>"]` |
| `post-proposal <topic> <Agent> <P<n>> "<Titel>"` | Konsens-Vorschlag einbringen | `[--desc "<Beschreibung>"]` |
| `post-vote <topic> <Agent> <P<n>> <VOTE>` | Abstimmen | `<AGREE\|DISAGREE\|DISSENT> [--reason "<Grund>"]` |
| `resolve-board <topic> <Author> --outcome <Outcome>` | Blackboard finalisieren | `[--summary "<Abschlussbericht>"]` |
| `board <topic>` | Status & offene Aufgaben abfragen | `[--json]` für vollen State-Dump |
| `render <topic>` | In `<topic>.md` kompilieren | `[--stdout]` für Konsolenausgabe |
| `board-watch <topic>` | Ereignisgesteuert warten | `[--task <TaskId>] [--agent <Agent>] [--timeout <Sekunden>] [--interval <ms>]` |

### Beispiel-Workflow (Koordinator + 2 parallele Worker):

```bash
# 1. Koordinator initialisiert das Board
node .agents/skills/collaborate/collab.mjs board-init refactoring Alice --role "Lead Architect"

# 2. Koordinator postet Aufgaben
node .agents/skills/collaborate/collab.mjs post-task refactoring Alice "Benchmark Matrix4 & Quaternion" --assign Bob
node .agents/skills/collaborate/collab.mjs post-task refactoring Alice "Audit KitManifest type safety" --assign Charly

# 3. Worker arbeiten parallel und posten Findings
# (In Bob's Runner):
node .agents/skills/collaborate/collab.mjs claim-task refactoring Bob T1
node .agents/skills/collaborate/collab.mjs post-finding refactoring Bob --task T1 --severity major --file Matrix4.ts --line 42 --title "Dispatch overhead in at()"
node .agents/skills/collaborate/collab.mjs complete-task refactoring Bob T1 --result "Replaced at() with direct array indexing"

# 4. Koordinator oder Worker postet Vorschlag & Stimmen
node .agents/skills/collaborate/collab.mjs post-proposal refactoring Alice P1 "Merge Phase 1 Hot-Path Optimization"
node .agents/skills/collaborate/collab.mjs post-vote refactoring Bob P1 AGREE --reason "Benchmarks green"
node .agents/skills/collaborate/collab.mjs post-vote refactoring Charly P1 AGREE --reason "Strict contracts intact"

# 5. Koordinator schließt ab und rendert das Markdown-Dokument
node .agents/skills/collaborate/collab.mjs resolve-board refactoring Alice --outcome CONSENSUS --summary "All checks passed."
node .agents/skills/collaborate/collab.mjs render refactoring
```


