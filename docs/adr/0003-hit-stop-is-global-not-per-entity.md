# Hit-Stop skaliert die Gameplay-Zeit global, nicht pro Entität

`SmallWorldMachine.triggerHitStop()` skaliert die einzelne `gameplayDeltaTime`, die an das `update()`,
`physics.step()` und `scene.update()` der App übergeben wird — jede Entität in der Szene wird
gemeinsam verlangsamt, nicht nur die getroffene. Das war nicht das ideale Design, sondern das, was
die Engine tatsächlich hergibt: `RigidBody` hat kein eigenes Zeitskalierungs-Feld pro Körper, und
`PhysicsSystem.step()` nimmt ein einziges globales `dt` für die ganze Szene entgegen — echter
selektiver Hit-Stop (nur die getroffene Entität einfrieren, alles andere mit voller Geschwindigkeit
weiterlaufen lassen) lässt sich mit der aktuellen Physik-/Update-Architektur nicht ausdrücken. Die
Kamera ist bewusst von der Skalierung ausgenommen (sie läuft weiter mit echtem `deltaTime`), damit
ihre Shake-/Flash-Effekte während des Einfrierens weiterspielen — das ist es, was den Einschlag
tatsächlich verkauft, und braucht keine Unterstützung pro Entität.

**Das hier überdenken, wenn:** ein Showcase echten selektiven Hit-Stop braucht (Welt einfrieren,
eine Figur weiter animieren lassen). Das bräuchte ein Zeitskalierungs-Feld pro `RigidBody` (und
pro `Behavior`?), durchgeschleust durch `PhysicsSystem.step()` — keine Korrektur an
`triggerHitStop()` selbst.
