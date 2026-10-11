# Staffelstab-Übergabe — alle Kanäle

Ausgelagert aus `SKILL.md` (Abschnitt 5.2). `SKILL.md` enthält nur den Kanal `manual`; hier stehen alle Kanäle. Querverweise beziehen sich auf `SKILL.md`.
---

### 5.2 Staffelstab-Übergabe (bestätigter Handoff & autonome Weitergabe)

Zweck dieses Abschnitts: Die Verhandlung so autonom wie möglich zu gestalten bzw. den Aufwand des Moderators pro Zug auf ein Minimum zu senken.

`roster[next_index].channel` nachschlagen (Standard: `"manual"`):

- **`channel: "watch"` (Vollautonom via ressourcenfreiem File-Watching):**
  - Der nächste Agent wartet bereits in einem Hintergrund-Task, Runner oder Watch-Loop via:
    ```bash
    node .agents/skills/collaborate/collab.mjs watch <FileName> <NextAgent>
    ```
  - Sobald der aktive Agent `collab.mjs end-turn` ausführt, wechselt die PID-Datei atomar den Zustand (`active_agent: <NextAgent>`, `status: "idle"`).
  - Der OS-Watcher wacht **verzögerungsfrei und mit 0% CPU/0 Token-Verbrauch** auf und triggert den nächsten Agenten.
  - **Kein Moderator-Eingriff nötig.** Der abgebende Agent meldet dem Moderator lediglich die Statuszusammenfassung und vermerkt:
    *„👉 Staffelstab autonom per File-Watch an **<NextAgent>** übergeben.“*

- **`channel: "subagent"` (Vollautonom via Subagent-Invocation / Messaging):**
  1. Nach erfolgreichem `collab.mjs end-turn` ruft der abgebende Agent den nächsten Agenten direkt per Subagent-Tool auf:
     - Falls der Subagent neu gestartet wird: `invoke_subagent` mit Prompt: `/collaborate --invite <NextAgent> <FileName>`.
     - Falls der Subagent bereits läuft/pausiert: `send_message` an die Conversation-ID von `<NextAgent>`.
  2. Der abgebende Agent meldet dem Moderator:
     *„👉 Staffelstab autonom per Subagent-Aufruf an **<NextAgent>** übergeben.“*

- **`channel: "manual"` (Standard für getrennte Fenster / manuelle Übergabe):**
  - Jeder Agent schließt seinen Zug mit einem copy-paste-fertigen Handoff-Block für den Moderator ab:
    ````markdown
    👉 **Kommando für den nächsten Agenten (<NextAgent>):**
    ```bash
    /collaborate --invite <NextAgent> <FileName>
    ```
    ````
  - Der Moderator fügt diesen Befehl in das Fenster des nächsten Agenten ein.

- **`channel: "peer_session"`** (Agent über `SendMessage` / Harness erreichbar):
  1. Handoff-Nachricht mit der Anweisung `/collaborate --invite <NextAgent> <FileName>` entwerfen.
  2. Den Moderator vor dem Senden um ein kurzes Go/No-Go bitten.
  3. Nach Freigabe die Nachricht per Tool senden.

- **`channel: "unix_signal"`** (lokaler Prozess mit Signal-Handler):
  1. Liveness prüfen per `kill -0 <pid>` und die Prozessidentität gegenprüfen (siehe Abschnitt 4: PID-Wiederverwendung).
  2. Signal-Handler ist verifiziert (Moderator hat das bei `--invite` bestätigt).
  3. Moderator-Bestätigung einholen und das Signal senden.
