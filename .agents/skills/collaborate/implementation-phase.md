# Umsetzungsphase (Modus `plan`) — Verifikations-Disziplin

Ausgelagert aus `SKILL.md` Abschnitt 9. Gilt nur im Modus `plan` nach `consensus.reached: true`. Beispiele (Shader, WebGPU) stammen aus Small World Machine; die Regeln sind generisch. Querverweise („Abschnitt N“) beziehen sich auf `SKILL.md`; die Nummerierung 9.x bleibt zur Rückwärtskompatibilität erhalten.

## 9. Verifikations-Disziplin (Konsens über den Plan ≠ funktionierende Umsetzung)

Ein aus der Praxis gelernter Punkt: `status: "consensus_reached"` (Abschnitt 6) bestätigt nur, dass sich alle Teilnehmer auf einen Plan geeinigt haben — es sagt nichts darüber aus, ob die anschließende Umsetzung dieses Plans tatsächlich funktioniert. Diese beiden Dinge dürfen nicht verwechselt werden, weder im Status-Feld noch in der Kommunikation der Agenten untereinander.

### 9.1 "Grün" bei Build/Lint/Unit-Tests ist keine Verifikation von Laufzeitverhalten

Ein Agent darf eine Umsetzung nur dann als **„✅ VERIFIZIERT"** oder **„✅ ERLEDIGT"** kennzeichnen, wenn die Behauptung durch das tatsächlich zuständige Prüfmittel bestätigt wurde — nicht durch benachbarte, aber unzureichende Prüfungen. Konkret:
- `npm run build`/`lint`/`test` (oder Äquivalente) verifizieren nur das, was sie tatsächlich ausführen. Bei Code, der erst zur Laufzeit in einer anderen Umgebung ausgeführt/kompiliert wird (Shader-Quelltext, generierte Queries, Konfigurationsdateien, die von einem externen Prozess geparst werden, GPU-Pipelines, Browser-Runtime-Verhalten) sagt ein grüner Build/Test **nichts** darüber aus, ob dieser Code dort tatsächlich lauffähig ist.
- Ein Agent, der eine solche Änderung vornimmt, formuliert seinen Status ehrlich und spezifisch: **„Build/Lint/Test grün, Laufzeitverhalten noch nicht getestet"** statt eines pauschalen `✅ VERIFIZIERT`. Der Statustext soll immer benennen, *welches* Prüfmittel die Aussage stützt (z. B. „✅ Live im Browser gerendert, keine Konsolenfehler" statt nur „✅ fertig").
- Der Agent, der die Abnahme/Verifikation im Plan zugewiesen bekommen hat (z. B. Look-Dev, Integration, QA-Rolle), prüft mit dem für die jeweilige Behauptung tatsächlich aussagekräftigen Mittel nach — und vertraut nicht blind auf `✅`-Labels anderer Teilnehmer (siehe auch 8.2). Ein wiederholtes Nachprüfen trotz `✅`-Meldung ist kein Misstrauen gegenüber dem Teilnehmer, sondern Protokoll-Pflicht.

### 9.2 Der `[VERIFICATION_FAILED]`-Marker

Stellt der für die Abnahme zuständige Agent fest, dass eine als erledigt gemeldete Umsetzung eines bereits vereinbarten `[CONSENSUS_PROPOSAL]` die Akzeptanzkriterien nicht erfüllt (Compile-Fehler, falsches Verhalten, Abweichung vom vereinbarten Ziel), gelten dieselben Grundregeln wie bei `[OVERLAP]` (siehe „Konfliktauflösung bei Überschneidungen"), übertragen auf die Umsetzungsphase:

1. **Explizit markieren:** `[VERIFICATION_FAILED: <PrüfenderAgent>] <Kurzbeschreibung des Fehlers, mit konkretem Fehlertext/Log-Auszug wo möglich>` im Topic-Dokument, direkt bei der geprüften Behauptung oder im eigenen Rundenbeitrag.
2. **Keine unilaterale Fehlerbehebung:** Der prüfende Agent behebt den Fehler nicht selbst, wenn die Zuständigkeit laut Plan bei einem anderen Teilnehmer liegt — er meldet nur den Befund und übergibt an den zuständigen Agenten.
3. **Konsens bleibt bestehen, Umsetzung gilt als offen:** `consensus.reached`/`status: "consensus_reached"` werden durch ein `[VERIFICATION_FAILED]` NICHT zurückgesetzt — der Plan selbst ist weiterhin einstimmig beschlossen. Es wird lediglich vermerkt, dass die Umsetzung dieses Plans noch nicht abgenommen ist (z. B. durch Durchstreichen eines vorherigen `✅ ERLEDIGT`-Eintrags in der Aufgabenliste mit Verweis auf die Fundstelle).
4. **Jeder Fix braucht eine neue, echte Verifikation:** Ein Fix-Vorschlag des zuständigen Agenten darf sich selbst nicht erneut als `✅ VERIFIZIERT` bezeichnen (siehe 9.1) — er beschreibt die vorgenommene Änderung und übergibt zurück an den prüfenden Agenten. Erst nach erneuter, tatsächlicher Prüfung markiert dieser entweder `[VERIFICATION_PASSED: <PrüfenderAgent>]` oder — falls derselbe oder ein neuer Fehler auftritt — ein neues `[VERIFICATION_FAILED]`. Diese Schleife kann mehrfach durchlaufen werden, bis die Abnahme tatsächlich besteht.
5. **Zählt gegen das Rundenlimit, aber ist kein Deadlock-Grund per se:** Jede Runde in dieser Schleife ist eine normale Runde im Sinne von `max_rounds` (Abschnitt 4). Reicht das Limit nicht, ist `/collaborate --extend` das vorgesehene Mittel — ein wiederholt fehlschlagender `[VERIFICATION_FAILED]`-Zyklus ist ein Qualitätsproblem der Umsetzung, kein Verhandlungs-Deadlock im Sinne widersprüchlicher Positionen.

### 9.3 Umsetzungs-Runden & Finaler Abschluss (`[ABNAHME_ERTEILT]` $\rightarrow$ `/collaborate --stop`)

Nach Erreichen des Konsens (`status: "consensus_reached"`) endet das Protokoll nicht sofort, sondern geht in die Umsetzungs- und Review-Schleife über:
1. **Umsetzung im Round-Robin:** Der zuständige Entwickler-Agent implementiert den vereinbarten Code und meldet die Fertigstellung an den Reviewer/Tester.
2. **Review & Runtime-Prüfung:** Der zuständige Peer führt die Runtime-Prüfung durch (Look-Dev, Shader-Kompilierung, Browser-Konsole, WebGPU/WebGL-Parität).
3. **Formale Abnahme (`[ABNAHME_ERTEILT]`):**
   Sobald alle Punkte verifiziert sind (`[VERIFICATION_PASSED]`), dokumentiert der prüfende Agent:
   ```markdown
   [ABNAHME_ERTEILT: <PrüfenderAgent>]
   - Alle Akzeptanzkriterien erfüllt.
   - Laufzeitverhalten fehlerfrei verifiziert.
   - Empfehlung an Moderator: Beenden via `/collaborate --stop`.
   ```
4. **Beenden durch den Moderator:** Erst nach erteilter Abnahme ruft der Moderator `/collaborate --stop` auf, um die Session formal zu terminieren (`status: "terminated"`).
