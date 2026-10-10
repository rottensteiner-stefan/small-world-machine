# App-First: Genre-spezifischer Gameplay-Code bleibt außerhalb des Kerns, bis ein zweites Projekt ihn braucht

## Kontext

Small World Machine ist eine universelle 3D-Engine. Jede neue Projektidee (ein Doom-artiger Shooter, eine
Lichtzyklus-Arena, ein postapokalyptisches Erkundungsspiel, und jetzt ein hypothetischer
Yoshi-artiger Plattformer) verleitet zu einer naheliegenden Abkürzung: die genre-spezifische
Mechanik — ein Flatter-Sprung-Charakter-Controller, ein Ei-Wurf-Projektil, eine Seitenscroll-
Verfolgungskamera, ein Lichtspur-Kollisionsraster — direkt in `packages/engine/src/core` zu bauen, weil "die
Engine das doch unterstützen sollte." Unkontrolliert verwandelt das die Engine in einen Haufen
einmaliger, gegenseitig irrelevanter Gameplay-Systeme, von denen jedes für immer seine eigene
Last an API-Stabilität und Abwärtskompatibilität trägt — für ein Feature, das je nur ein einziges
Projekt genutzt hat.

Wir haben bereits mehrere Apps unter `apps/` (`yad`, `light-cycle-arena`, `and-now`), jede mit
ihrem eigenen genre-spezifischen Gameplay-Code vollständig im eigenen App-Ordner, nicht in
`packages/engine/src/core`. Und früher in dieser Session haben wir dieselbe Entscheidung in
kleinerem Maßstab getroffen: `Optics.refract()`/`Optics.cauchyIndex()`/`Ray2D.intersectSegment()`
wurden erst dann aus `showcases/28`s Prisma-Dispersions-Code nach `packages/engine/src/math/` extrahiert, als wir
sie bewusst wiederverwendbar haben wollten — die Extraktion geschah nicht spekulativ beim
Schreiben des Showcases, und der Showcase selbst besitzt weiterhin `outwardFaceNormal()` und die
gesamte `computeSpectralRays()`-Orchestrierung, die lokal blieb, weil nichts anderes sie (bisher)
braucht.

## Entscheidung

**Neuer genre-spezifischer Gameplay-Code für ein neues Projekt beginnt in `apps/<project>/`,
niemals in `packages/engine/src/core`.** Das gilt für Dinge wie: Charakter-Controller mit genre-spezifischem
Bewegungsgefühl (Flatter-Sprung, Coyote-Time, Jump-Buffering), Waffen-/Projektil-Mechanik,
genre-spezifisches Kamera-Folgeverhalten und jedes andere System, das nur im Kontext des Designs
eines einzigen Spiels Sinn ergibt.

Die Aufgabe der Engine ist es, die *Primitive* bereitzustellen, aus denen diese gebaut werden,
nicht die Genre-Mechanik selbst — z. B. für einen Seitenscroll-Plattformer: das `Behavior`-System
für den Charakter-Controller selbst, `BillboardInstancer`/`Sprite` für 2D-in-3D-Rendering,
`GridLevelBuilder` (`geometry/procgen`) für kachelbasierte Level-Daten, und die
`CameraStrategy`-Architektur als die Nahtstelle, an der eine neue Seitenscroll-Folge-Strategie
andockt (eine neue Strategie-Klasse, die dem bestehenden Muster folgt, kein neues Kernkonzept).

**Die Extraktion an einen gemeinsamen, wiederverwendbaren Ort (ein `packages/engine/src/math`/`packages/engine/src/core`-Utility,
oder irgendwann ein eigenständiges Plugin-Paket) geschieht nur, wenn ein *zweites* echtes Projekt
dasselbe braucht** — nicht spekulativ beim Bau des ersten. Bis dahin ist scheinbare Duplikation
zwischen den genre-spezifischen Systemen zweier Apps kein Problem, das man vorab lösen muss; es
sind einfach zwei Apps, die noch nicht bewiesen haben, dass sie dieselbe Abstraktion brauchen.

## Konsequenzen

- Die Engine bleibt als *universelle* 3D-Engine nutzbar — ein Konsument, der nur Materialien/
  Renderer/Physik will, erbt niemals ein Ei-Wurf-Projektilsystem oder ein Lichtzyklus-
  Kollisionsraster in seinem Bundle.
- Jede App kann lokal-optimale, meinungsstarke Design-Entscheidungen für ihr Genre treffen, ohne
  sie als dauerhafte öffentliche Engine-API aushandeln zu müssen.
- Der Preis wird beim zweiten Projekt bezahlt: etwas bewusste, rückblickende Extraktionsarbeit,
  wenn ein echter zweiter Anwendungsfall auftaucht, statt einer spekulativen, für einen
  hypothetischen Fall entworfenen Abstraktion. Das ist der Tausch, den wir wollen — siehe den
  `Optics`/`Ray2D`-Präzedenzfall oben dafür, wie diese Extraktion in der Praxis aussieht.

**Das hier überdenken, falls:** ein einzelnes genre-spezifisches Projekt sich herausstellt, *genau
dieselbe* Mechanik in zwei seiner eigenen Szenen/Showcases intern zu brauchen (nicht über
getrennte Projekte hinweg) — das ist bereits das "zweiter Bedarf"-Signal und rechtfertigt die
sofortige Extraktion innerhalb der Grenzen dieses Projekts, genau wie `Optics`/`Ray2D` es
innerhalb dieses Repositorys getan haben.

**Update (2026-09-12):** Die hypothetische dritte Extraktionsstufe ("oder irgendwann ein
eigenständiges Plugin-Paket") ist jetzt technisch real: Mit der npm-Workspaces-Restrukturierung
sind die Apps (`the-whisper`, `yad`, `light-cycle-arena`) zu Unterordnern des gemeinsamen
Workspace-Package `@small-world-machine/sample-apps` (`apps/sample-apps/the-whisper`,
`apps/sample-apps/yad`, `apps/sample-apps/light-cycle-arena`) zusammengefasst, das die Engine
als `@small-world-machine/engine`-Package-Abhängigkeit konsumiert. Die Kernregel bleibt unverändert —
neuer genre-spezifischer Code beginnt weiterhin in der jeweiligen App, Extraktion nach
`packages/engine/src/math`/`src/core` (statt `src/math`/`src/core`) erfolgt weiterhin erst beim
echten zweiten Bedarf.
