# ADR 0012: Atmosphärisches Indie-Game-Design & Rendering-Philosophie ("Das Streuner-Prinzip")

## Status
Akzeptiert

## Kontext & Problem

Moderne 3D-Engine-Entwicklung tappt häufig in eine nicht durchhaltbare Falle: das Brute-Force-"Spec-Rennen". Mainstream-Branchentrends jagen 8K-unkomprimierten Texturen, Mehrfach-Bounce-Hardware-Raytracing und riesigen Multi-Gigabyte-Engine-Laufzeiten hinterher, die 2.000-Dollar-Grafikkarten verlangen, nur um 30 FPS zu erreichen.

Diese Denkweise erzeugt gravierende Nachteile:
1. **Hardware-Ausschluss & Energieverschwendung:** Spiele und Web-Apps werden für die überwältigende Mehrheit der Nutzer auf Standard-Laptops, MacBooks, integrierten GPUs und Mobilgeräten unspielbar.
2. **Verlust des künstlerischen Fokus:** Rohe Polygonzahlen und fotorealistische Texturauflösungen ersetzen häufig kohärente Kunstrichtung, Stimmung und ein spürbares Spielgefühl.
3. **Der "Spielzeug-Engine"-Trugschluss:** Umgekehrt reduzieren sich viele leichtgewichtige Web-3D-Bibliotheken auf minimale Rendering-Hilfsmittel (rotierende Würfel, Technikdemos, Werbebanner) und lassen die Kernarchitektur (FSMs, Physik, Audio, Szenen-Editing) aus, die zum Bau echter, substanzieller Spiele nötig ist.

Meisterwerke des Indie-Genres wie *Stray*, *Inside*, *Journey* und *Firewatch* belegen schlüssig, dass **Kunstrichtung, Lichtstimmung, Farbharmonie, Atmosphäre, reaktionsschnelle Steuerung und kohärentes Worldbuilding** eine weit tiefere emotionale Resonanz und kommerziellen Erfolg hervorrufen, als es unoptimierte Brute-Force-Grafik je könnte.

## Entscheidung

Wir etablieren **das Streuner-Prinzip** als Small World Machines grundlegende Design- und Rendering-Philosophie:

### 1. Atmosphäre & Kunstrichtung > Brute-Force-Pixelzählerei
- Visuelle Wirkung in Small World Machine wird angetrieben von **Lichtstimmung, stimmungsvollem volumetrischem Nebel, filmischem Post-Processing (Bloom, Tone-Mapping, Color-Grading), markanten Silhouetten und stilisierten PBR-Materialien**, statt von 8K-Textur-Aufblähung oder hardware-schmelzendem Path-Tracing.
- Wir entwerfen Rendering-Techniken bewusst so, dass sie auf Standard-WebGL-2- und WebGPU-Hardware reichhaltige, hochwertige visuelle Ästhetik liefern, ohne übermäßigen Rechenaufwand.

### 2. Vollwertige Indie-Game-Engine-Architektur
Small World Machine ist darauf ausgelegt, **echte, substanzielle, narrative und interaktive Spiele sowie reichhaltige 3D-Anwendungen** zu unterstützen, nicht bloß isolierte Rendering-Schnipsel. Die Engine stellt einen vollständigen, einheitlichen Laufzeit-Stack bereit:
- Komponentenbasiertes **Behavior-System** und typsichere, allokationsfreie **Zustandsautomaten (FSM)**.
- Eingebaute **Impuls-Physik** (SAT-Kollisionserkennung, Auftrieb, Continuous Collision Detection).
- 3D-**räumliches Audio** (HRTF-Positionierung, prozedurale Synthesizer, Audio-Mischung).
- $O(\log n)$-**Octree-Interaction-Manager** und Bildschirmraum-Picking.

### 3. Universelles 60-FPS-Ziel auf Alltagshardware
- Jedes System und jeder Shader muss auf gängiger Consumer-Hardware (Apple Silicon, integrierte Intel/AMD-GPUs, mobile Browser) felsenfeste 60 FPS erreichen.
- Strikt allokationsfreie Hot-Paths und Objekt-Pooling (`MathPool`) eliminieren Garbage-Collection-Ruckler.

### 4. Reibungsloses visuelles Erstellen (Maker)
- Weltkomposition, Level-Design und das Zusammensetzen von Prefabs geschehen in **Maker** (`public/tools/maker.html`) direkt im Browser.
- Nutzt die native File System Access API und offene glTF-2.0-Standards (`SW_*`-Metadaten-Erweiterungen), ohne schwergewichtige Desktop-Installationen oder Cloud-Abonnements zu verlangen.

## Konsequenzen

- **Kreative Selbstermächtigung:** Indie-Entwickler und Digitalkünstler können atmosphärische, visuell beeindruckende Spiele mit sofortiger Web-Distribution erschaffen.
- **Universelle Zugänglichkeit für Spieler:** Spiele laden in Sekunden, laufen kühl und leise auf alltäglichen Consumer-Laptops und Mobilgeräten und erfordern keine teuren GPU-Upgrades.
- **Klare architektonische Leitlinie:** Engine-Features und Shader werden nach künstlerischem Ausdruck und atmosphärischer Wirkung priorisiert (z. B. Nebel, Licht, Post-FX, Spielgefühl), nicht nach unwartbarer, hardware-strafender Brute Force.
