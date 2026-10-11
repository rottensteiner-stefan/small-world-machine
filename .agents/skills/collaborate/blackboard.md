# Blackboard & Event-Sourcing

Ausgelagert aus `SKILL.md` (Abschnitt 12 und die `board-*`-Zeilen der Befehlstabelle in Abschnitt 11). Nur nötig, wenn ein Blackboard (`<topic>.board.jsonl`) angelegt oder betreten wird. Querverweise beziehen sich auf `SKILL.md`.
---

## 12. Blackboard & Event-Sourcing (Parallele Multi-Agent-Kollaboration)

Für Szenarien mit mehreren parallelen Subagenten (z. B. 1 Koordinator + 3 spezialisierte Worker) bietet das Protokoll neben der sequentiellen Round-Robin-Rotation das **Blackboard-Muster** mit **Single Append-Only Log (`<topic>.board.jsonl`)**.

### 12.1 Architektur & POSIX Atomic Guarantee
- **Single Append-Only File:** Alle Agenten schreiben ihre Aktionen (`task_posted`, `finding_posted`, `task_completed`, `vote_posted`) als einzelne JSON-Zeilen in `<topic>.board.jsonl`.
- **Lock-Free Concurrency:** Unter POSIX-Systemen (macOS/Linux) sind Schreiboperationen via `fs.appendFileSync(path, line + '\n', { flag: 'a' })` unter 4 KB atomar. Es gibt keine `.lock`-Blockaden.
- **Event-Sourcing & Determinismus:** Der Zustand des Boards ist eine reine Projektion `State = Reducer(Events)`.
- **Live Markdown Compiler:** Der Befehl `collab.mjs render <topic>` kompiliert den aktuellen Projektionszustand verlustfrei in ein lesbares GitHub-Markdown-Dokument (`<topic>.md`) für menschliche Reviewer.
- **Zero-Resource Watcher:** Parallele Subagenten blockieren mit `collab.mjs board-watch <topic> --task <TaskId>` ressourcenfrei via OS `fs.watch`, bis ihre Teilaufgabe oder neue Findings verfügbar sind.

### 12.2 Rollenmodell im Blackboard
1. **Koordinator / Lead:** Initialisiert das Board (`board-init`), formuliert Aufgabenpakete (`post-task`), moderiert Vorschläge (`post-proposal`) und schließt das Board ab (`resolve-board`).
2. **Worker-Subagenten (Spezialisten):** Registrieren sich (`board-join`), beanspruchen Aufgaben (`claim-task`), führen Code-/Architekturanalysen durch, publizieren strukturierte Befunde (`post-finding`), schließen Aufgaben ab (`complete-task`) und stimmen über Vorschläge ab (`post-vote`).

### 12.3 Befehle

| Befehl | Wirkung |
| :--- | :--- |
| `board-init <topic> [Coordinator]` | Blackboard Session initialisieren (`<topic>.board.jsonl`) |
| `board-join <topic> <Agent>` | Worker/Teilnehmer auf dem Blackboard registrieren (`--role`, `--stance`) |
| `post-task <topic> <Author> "<Title>"` | Aufgabe anheften (`--assign <Agent>`, `--id <TaskId>`) |
| `claim-task <topic> <Agent> <TaskId>` | Aufgabe in Bearbeitung nehmen (`in_progress`) |
| `complete-task <topic> <Agent> <TaskId>` | Aufgabe abschließen (`--result "<Zusammenfassung>"`) |
| `post-finding <topic> <Agent> --title "<Titel>"` | Befund/Finding anheften (`--task`, `--severity`, `--file`, `--line`, `--desc`) |
| `post-proposal <topic> <Agent> <P<n>> "<Titel>"` | Konsens-Vorschlag anheften (`--desc`) |
| `post-vote <topic> <Agent> <P<n>> <VOTE>` | Stimme abgeben (`AGREE`, `DISAGREE`, `DISSENT`, `--reason`) |
| `resolve-board <topic> <Author> --outcome <Outcome>` | Blackboard finalisieren (`--summary`) |
| `board <topic> [--json]` | Aktuellen Projektionszustand abfragen |
| `render <topic> [--stdout]` | Blackboard in Markdown (`<topic>.md`) kompilieren |
| `board-watch <topic> [--task T] [--agent A]` | Zero-Resource Watcher auf Blackboard-Events |
