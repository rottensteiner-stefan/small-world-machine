# Modus `decide` — Details

Ausgelagert aus `SKILL.md` (Abschnitt 10, Nummerierung unverändert). Pflichtlektüre vor dem ersten Zug im Modus `decide`; die Diskussionsprozedur 10.2–10.5 steht zusätzlich in `discussion-phase.md`, Teil B. Querverweise („Abschnitt N“, „Step N“) beziehen sich auf `SKILL.md`.
---

## 10. Modus `decide` — eine Frage entscheiden (oder bewusst nicht)

Zweck: jede Art von Fragestellung, die mehrere mögliche Antworten hat und bei der es **kein klares Ergebnis geben muss** — technisch, fachlich, strategisch, konzeptionell, Wert- und Geschmacksfragen, Prognosen, Priorisierungen. Ergebnis ist **eine begründete Entscheidung — oder ein dokumentiertes „keine Einigung“**. Beides ist ein gültiger, vollständiger Ausgang. Die Prozedur ist deterministisch (feste Zustandsmaschine, feste Abschlusskriterien); die Inhalte sind es naturgemäß nicht.

### 10.1 Start
`/collaborate --invite <Agent> <FileName> --mode decide [--max-rounds <N>] [--stance "<Text>"]` für jeden Teilnehmer (1 bis N), danach `--start`. Das Topic-Dokument beginnt mit einem Block `## Frage`, den der erste Agent **wörtlich** aus der Aufgabenstellung des Moderators übernimmt (per `--note` nachlieferbar), mit:
- **Frage** (ein Satz), **Kontext/Constraints** (nicht verhandelbar), **Entscheidungskriterien** (themenabhängig, z. B. Performance, Wartbarkeit, Risiko, Kosten, Wirkung, Stimmigkeit, Geschmack — gewichtet, falls der Moderator das vorgibt), **Optionen-Rahmen** (bekannte Kandidaten; neue Optionen bleiben erlaubt).

### 10.2 Runde 1 — blind (gegen Anchoring)
Runde 1 läuft ohne gegenseitige Einsicht: Jeder Agent schreibt seine Position in eine eigene Datei `<topic>.blind.<AgentName>.md` und schreibt deren Hash in `history` fest (`blind_submitted`); der letzte Agent der Rotation deckt alle auf und prüft die Hashes. Regeln, `stance`-Bindung und Pflichtstruktur: **`discussion-phase.md`, Teil B, 10.2**.

### 10.3 Evidenz-Tags
Tragende Behauptungen tragen `[MEASURED]`, `[SOURCED]` oder `[ASSUMED]`, Wertungen und Abwägungen `[JUDGMENT]`; eine Entscheidung darf nicht ausschließlich auf ungeprüften *faktischen* Annahmen (`[ASSUMED]`) ruhen. Details: **`discussion-phase.md`, Teil B, 10.3**.

### 10.4 Ab Runde 2 — Kritik & Revision
Pflichtinhalt jedes Beitrags (stärkster Einwand gegen jede andere Position, Position halten oder `[POSITION_CHANGE]`, neue Belege, Zeile `Neuheit: ja|nein`): **`discussion-phase.md`, Teil B, 10.4**.

### 10.5 Stagnation
Eine volle Runde mit ausschließlich `novelty: false` setzt `status: "deadlock"` (`stalled`) — unabhängig vom Rundenlimit. Details: **`discussion-phase.md`, Teil B, 10.5**.

### 10.6 Abschluss & Ergebnis-Block
**Vorschlag:** In Runde ≥ 2 stellt ein Agent einen `[DECISION_PROPOSAL: P<n>]` (technisch identisch zum `[CONSENSUS_PROPOSAL]` aus Abschnitt 6: IDs, Unterschriften mit Restzweifel und Revisionsbedingung, Fälschungsschutz, Unterschriftsrunde). Widerspruch: `[OBJECTION: <Agent>]` mit Begründung; offene Einwände blockieren `CONSENSUS`. Es gelten Abschnitt 6 Punkt 2 und 3.

**Ausgänge (`outcome`):**

| Outcome | Bedingung |
| :--- | :--- |
| `CONSENSUS` | Alle Roster-Mitglieder haben unterschrieben, keine offenen Einwände/`[TEAM_QUESTION]`s, Evidenzregel 10.3 erfüllt. → Status `consensus_reached` (Endzustand). |
| `MAJORITY_WITH_DISSENT` | Status `deadlock`, aber > 50 % des Rosters haben einen Vorschlag unterschrieben und jeder Nicht-Unterzeichner hat sein `[DISSENT: <Agent>]` mit eigener Position im Dokument hinterlegt. **Setzer ist der Moderator:** `/collaborate --stop --outcome MAJORITY_WITH_DISSENT`. Der angesprochene Agent prüft vorher die Mehrheit in `consensus.signatures` und die `[DISSENT]`-Marker im Dokument und lehnt ab, wenn eines fehlt; erst dann setzt er `outcome` und schreibt den Ergebnis-Block mit den Minderheitsvoten. |
| `NO_CONSENSUS` | `deadlock`/`stalled`, Moderator beendet mit `--stop` (ohne `--outcome` oder mit `--outcome NO_CONSENSUS`). Gültiges Ergebnis — kein Fehlschlag. |
| `MODERATOR_DECISION` | Moderator entscheidet per `--decide "<Entscheidung>"`. |

**Ergebnis-Block** (ans Ende des Topic-Dokuments; schreibt der Agent, der den Endzustand herbeiführt, bzw. der angesprochene Agent bei `--stop`/`--decide`; danach `status: "terminated"` bzw. `consensus_reached`, `outcome` gesetzt):
```markdown
---
## Ergebnis — <Datum>
- **Outcome:** CONSENSUS | MAJORITY_WITH_DISSENT | NO_CONSENSUS | MODERATOR_DECISION
- **Frage:** <ein Satz>
- **Entscheidung:** <gewählte Option; bei NO_CONSENSUS: „keine“>
- **Begründung:** <3–6 Zeilen, mit Evidenz-Tags>
- **Verworfene Alternativen & warum:** ...
- **Minderheitsvoten / Restzweifel:** <pro Agent: Position bzw. Restzweifel aus der Unterschrift>
- **Ungeprüfte Annahmen:** <alle verbleibenden [ASSUMED]>
- **Wertungen:** <die tragenden [JUDGMENT]-Prämissen und ihre Gewichtung; bei reinen Wert-/Geschmacksfragen der Kern der Begründung>
- **Revisionsbedingungen:** <Gegenbedingungen der Teilnehmer: wann ist neu zu entscheiden?>
- **Verlauf:** Runde <N> von <max_rounds>, Teilnehmer: <Liste mit stance>
```
Bei `NO_CONSENSUS` listet der Block stattdessen die verbleibenden Optionen mit je dem stärksten Pro/Contra und den Positionen jedes Agenten.

**Reihenfolge bei der letzten Unterschrift (Konsens):** (1) Beitrag mit `[AGREED: <Agent> P<n>]` (inkl. Restzweifel/Revisionsbedingung) ins Dokument, (2) `collab.mjs sign`, (3) **Ergebnis-Block** ans Dokumentende, (4) `collab.mjs end-turn … --consensus`. Der Block steht also **vor** dem Endzustand — danach sind keine Züge mehr möglich. Bei `--stop`/`--decide` schreibt der angesprochene Agent den Block nach dem Zustandswechsel.

### 10.7 Sonderfall: 1 Agent + Moderator
Im Modus `decide` ist ein Roster mit **einem** Agenten zulässig; der Moderator ist dann der Gegenpart. Jeder Zug des Agenten enthält zwei getrennte Abschnitte: **Position** und **Red Team** (stärkster Fall gegen die eigene Position, inkl. `[ASSUMED]`-Inventur). Die blinde Runde entfällt (es gibt niemanden aufzudecken). Konsens im Mehrparteien-Sinn gibt es nicht: Ausgang ist `MODERATOR_DECISION` (Moderator folgt dem Vorschlag per `--decide`) oder `NO_CONSENSUS`. Stagnation (10.5) gilt unverändert. Für echte Perspektivenvielfalt sind mehrere Instanzen (auch desselben Modells) mit verschiedenen `stance` besser als ein Einzelner.
