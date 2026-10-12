# Log — And Now?

> Entwicklungslog für die "And Now?"-App (Arbeitstitel).

---

## 2026-08-21 — Gründungs-Pitch

**Prämisse:** X Jahre nachdem Europa durch einen nuklearen Schlag fast in die
Steinzeit zurückgeworfen wurde (Urheber ungeklärt — "Russland? Niemand weiß es
wirklich" — bewusst als ungelöstes Rätsel der Welt angelegt, nicht als
Autoren-Unentschlossenheit), wagt sich die erste Generation, die komplett
danach aufgewachsen ist, wirklich endgültig nach draußen.

**Setting:** Start in einem Vault/Bunker (Name noch offen) in **Wien** —
bewusst als realer geografischer Anker gewählt, damit die Spielwelt nicht
komplett kontextlos ("lost") wirkt. Wien liefert dafür reichlich konkrete
Spielfläche für die Erkundung nach dem Ausstieg: **U-Bahn**-Tunnelnetz
(naheliegende Verbindung zwischen Bunker und Oberfläche, bzw. weitere
unterirdische Routen), **Kirchen** (markante, einzeln wiedererkennbare
Landmarken), **Universitäten** (Wissen/Archiv-Orte), sowie **Donau und
Donaukanal** (Fluss/Kanal-Gebiet als eigene Zone mit anderer Bedrohungslage
als die Straßen/Tunnel).

**Ton/Referenz:** Explizit eine Mischung aus *Fallout* (Vault-Ausstieg,
Retro-vs-Zukunft-Ästhetik) und *Metro* (Tunnel/Bunker-Beklemmung, karges
Nachkriegs-Europa) — bewusst benannt, nicht verschleiert.

**Ziel (Phase 1):** Kein Kampf-/Fraktions-Fokus zum Einstieg. Zuerst geht es
ums **Überlegen und Erkunden** — die Geheimnisse der "neuen alten Welt"
draußen entdecken.

**Offene Fragen für die nächste Runde:**
- Name des Vaults/Bunkers und ggf. seiner Betreiber-Organisation.
- Wie konkret wird "X Jahre" — reicht vage, oder soll es sich an etwas
  Erlebbarem festmachen (Generationenwechsel, Verfallszustand der Technik)?
- Bleibt "wer hat zugeschlagen" dauerhaft ungeklärt (Weltgeheimnis) oder ist
  das ein Enthüllungsziel der Geschichte?
- Grobe Struktur: lineare Story mit festen Beats, oder offene
  Erkundung/Sandbox ab Verlassen des Vaults?
- Vokabular/Namensfindung (vgl. Neon Labyrinths "keine Grid/Recognizer"-Regel)
  — eigene Begriffe statt direkter Fallout/Metro-Leihbegriffe ("Vault",
  "Pip-Boy" etc. sind Platzhalter, kein Zielzustand).

**Nächste Schritte:** Grobskizze der Welt/Story weiter verdichten, dann
Concept-Dossier (`concept-dossier.html`) mit erster Palette/Bildsprache
befüllen.

---

## 2026-08-21 (Nacht-Session) — Massiver Worldbuilding- & System-Ausbau

**Fokus:** Detaillierte Ausarbeitung des Worldbuildings, der Fraktionen, Topographie, Waffen/Präparate und Begleitersysteme für das postapokalyptische Wien.

**Wichtigste Ergebnisse & Festlegungen:**
1. **Fraktions-Hierarchien (4 Kasten pro Fraktion):**
   - Jede Fraktion folgt der Struktur: *Anführung → Innerer Kreis → Handlanger → Schläger/Enforcer*.
   - Vollständig ausdefiniert für:
     - **Die Pompfinebrer** (Ober-Kondukteur, Protokollanten, Träger, „Schaufler“ mit Grabsteinen/Schrotflinten).
     - **Das Konsulat** (Doyen, Attachés, Kuriere, Personenschützer/Liquidatoren).
     - **Die Giftmischer** (Primar, Pharmazeuten, Apotheken-Boten, schmerzunempfindliche „Sanitäter“-Berserker).
     - **Das AZS** (Bunker-Kommandant, Sektionschefs, Sachbearbeiter, Ordnungsdienst/Schleusenwache).
     - **Das Ringelspiel-Syndikat** (Hutschmeister, Budenbesitzer/Croupiers, Rekommandeure, Kasperl-Clowns mit Nagel-Pritschen).

2. **Wiener Topographie & 17 Schlüssel-Schauplätze:**
   - Etabliert im [`Story-Grundgeruest-v9.md`](src/apps/and-now/docs/Story-Grundgeruest-v9.md): Flakturm Arenberg, Stephansdom & Katakomben, Bermudadreieck, Kapuzinergruft, Karlskirche/TU Wien, Naschmarkt, Wienfluss-Tunnel, Hauptbahnhof, Neues AKH, Narrenturm (Altes AKH), U-Bahn-Netz (Knoten Karlsplatz etc.), Müllverbrennung Spittelau, Zentralfriedhof & Bestattungsmuseum, Prater & Riesenrad, Kahlenberg, Tiergarten & Schloss Schönbrunn, UNO-City/IAEA.

3. **Waffen-, Gifte- & Präparate-Profile:**
   - Jede Fraktion hat ein maßgeschneidertes Profil für Nahkampf, Fernkampf/Schusswaffen sowie Gifte/Präparate/Pyrotechnik (von Branntkalk-Nebel über Rizinus-Nadeln bis hin zu Neurotoxinen, Tränengas und Phosphor-Böllern).

4. **Gefährten & Begleiter (Wiener Archetypen):**
   - 5 spielerische und narrative Begleiter mit Persönlichkeit, Perks und persönlichen Quests:
     - Der grantige Fiaker / Totenkutscher (Tank & Karren-Packesel).
     - Die abtrünnige Pharmazeutin (Chemie, Heilung & Support).
     - Der Botschafts-Chauffeur (Stealth, Hacken & Scharfschütze).
     - „Strizzi“ – Der Donaukanal-Terrier (Spürnase & Festhalter).
     - Der gescheiterte Kasperl / Puppenspieler (Fallen, Lärm-Ablenkung & Täuschung).

5. **Mutierte Wiener Fauna & Tierwelt:**
   - Raubtiere (Schönbrunner Prachtkatzen, Donau-Panzernashörner, Dach-Paviane).
   - Urbane Plagen (Wienfluss-Biber/U-Bahn-Ratten, Pest-Tauben, Gift-Kröten).
   - Domestizierte Helfer (Lainzer Lasten-Keiler, Spür-Marder, Friedhofs-Rehe).

**Aktueller Hauptdokument-Stand:**
- Das lebende Dokument [`Story-Grundgeruest-v9.md`](src/apps/and-now/docs/Story-Grundgeruest-v9.md) enthält die vollständige Synthese aller Bausteine.
- Das neue Dokument [`Story-Dramaturgie.md`](src/apps/and-now/docs/Story-Dramaturgie.md) fixiert den kanonischen 4-Akte-Handlungsbogen („A schene Leich fürn Großvater“) von Bunker Arenberg über das Bermudadreieck und den Zentralfriedhof bis zur UNO-City.

---

## 2026-08-22 — Etablierung des Master-Handlungsbogens & System-Fundamente

**Fokus:** Verknüpfung sämtlicher Fraktionen, Schauplätze, Begleiter und persönlicher Motive zu einer kohärenten 4-Akte-Kampagne sowie Definition von Überlebens- und Identitäts-Systemen.

**Wichtigste Festlegungen:**
1. **Zeitleiste & Technologie (2050 ➔ 2100):**
   - *Schlag*: ~2050 (fortgeschrittenes Zeitalter mit KI-Protokollen, Robotik und Kybernetik).
   - *Spielzeit*: ~2100 (50 Jahre nach der Katastrophe; erste voll unterirdisch aufgewachsene Generation).
   - *KI-Relikte*: Fragmentierte KIs wie die bürokratische AZS-Sub-KI „Amtsrat 4.1“ auf dem Amts-Terminal oder verwaiste IAEA-Sicherheitssysteme.
2. **Freie Identität & Dynamische Besetzung:**
   - Spieler wählt Geschlecht/Identität frei und ohne Rollen-Einschränkungen.
   - Das biologische Geschlecht der NPCs und Begleiter wird prozessual/zufällig dynamisch bestimmt.
3. **Strahlungs- & Toxizitäts-System:**
   - Strahlung verringert kontinuierlich die maximalen HP (HP-Cap), stört das Zielen/Gehen und erfordert Jod, Blei-Einlagen, Schutzkaffee-Konzentrate oder Dekontamination.
4. **Vollständige Master-Dramaturgie (4 Akte) & 20 Schauplätze:**
   - Festhaltung in [`Story-Dramaturgie.md`](src/apps/and-now/docs/Story-Dramaturgie.md).
   - Schauplatz 18: **Die Gürtelbögen (Stadtbahnbögen)** – das verruchte Rotlicht-, Kneipen-, Kleinkriminalitäts- und Live-Musik-Milieu Wiens (Hehlermärkte, illegaler „Gürtel-Fusel“, Bandenkriege).
   - Schauplatz 19: **Der Ölhafen Lobau (Tanklager in den Auen)** – gigantischer Industrie-Albtraum im Naturschutzgebiet; schwer umkämpftes Treibstoff-Mekka zwischen den fallenstellenden Aupacklern und Schmugglern. Explosionsgefahr bei Schusswechseln.
   - Schauplatz 20: **Das Haus des Meeres (Flakturm Esterházypark)** – 11-stöckiger vertikaler Beton-Dungeon mit geborstenen Haibecken, Tropensümpfen, mutierten Kiemen- und Amphibien-Kreaturen und Geier-Nestern auf den Geschützplattformen.
5. **Modulare Side-Quests & Skalierbare Schauplatz-Hierarchie:**
   - Nebenquests für Erfahrung, seltene Waffen, Drogen, Nahrung und Crafting-Materialien.
   - Schauplatz-Skalierung: Von Makro-Zonen (Prater, Zentralfriedhof) über Meso-Gebäude (Bögen-Kneipen, Narrenturm) bis zu Mikro-Orten (zerschossene rote Wiener Bushaltestelle, Würstelstand, Notausstiege).
   - Environmental Storytelling: Einzelne lebende und tote Gestalten als Träger seltener Puzzlesteine zur Geschichte des Großvaters und zum Atomschlag von ~2050.
6. **Die Degenerierten / Verwachsenen (Menschliche Strahlenfolgen - *Hills Have Eyes*-Vibe):**
   - *Aupackler*: Verwilderte, territoriale Schilf- und Auen-Sippe (Inzucht, Knochenbeile, Schlingfallen, Kannibalismus aus Hungersnot).
   - *Kellerkinder*: Blinde, lichtscheue Rudel in unbeleuchteten U-Bahn-Totstrecken (Klicklaute, Schleichangriffe).
   - *Ausgedingte*: Ausgebunkerte, verstrahlte Verstoßene der AZS-Bunker als tragische Zeugen und Questgeber.
7. **DLC- & Erweiterungs-Horizonte (Beyond Vienna):**
   - *DLC 1 („Das Flüstern des Wienerwalds“)*: Lainzer Tiergarten, Jagdschloss Hermesvilla, alter Buchenwald, Survival & Jagd.
   - *DLC 2 („Der Weiße Quell“ - Die Hausberge Wiens)*: Semmering (Südbahnhotel, Panhans-Festungen), Rax & Schneeberg (reines Alpenquellwasser) und die über 100 km lange **1. Wiener Hochquellenwasserleitung** als zermürbender, pechschwarzer Stollen-Highway aus den Bergen nach Wien.
8. **Das verwobene Fraktions-Ökosystem & Dynamische Side-Quests:**
   - Gegenseitige Abhängigkeiten & Hehlerei (Pompfinebrer ⮀ Alchimisten für Einbalsamierungsbalsam vs. Gruftzugänge; Alchimisten ⮀ Spittelau für Fernwärme vs. Schmelzkatalysatoren; Konsulat ⮀ AZS für Passierscheine vs. Coderätsel; Prater-Syndikat ⮀ Gürtelbögen für Lobau-Treibstoffschmuggel; Konsulat ⮀ Pompfinebrer für tote Briefkästen in Ehrengräbern).
   - Aus diesen Reibungen entspringen konkrete Nebenquests mit moralischen Entscheidungen (z.B. *„Die Grabräuber-Doktoren“*, *„Der kalte Entzug“*, *„Diplomatisches Gepäck“*, *„Panscher-Krieg“*, *„Letzte Depesche“*).
10. **Räumliche Kompression & Karten-Topologie (World-Scale Mapping):**
    - *Kompression 1:10 bis 1:15* (wie Boston in *Fallout 4*): Verdichtung generischer Wohnstraßen bei präziser Himmelsrichtungs-Treue der 20 Landmarken.
    - *3-Ebenen-Topologie*: Ebene +1 (Dächer & Otto-Wagner-Stadtbahnbögen), Ebene 0 (Ruinen & Barrikaden-Schluchten), Ebene -1 (U-Bahn-Netz, Wienfluss-Kanal & Katakomben).
    - *Barrikaden als Level-Channelling*: Eingestürzte Gründerzeit-Fassaden, Schuttkegel und Strahlensenken leiten den Spieler in spannende Korridore statt in leere Weiten.
11. **Visueller Art-Style („Morbid-Malerischer Graphic-Noir“):**
    - *Synthese*: **Dishonored** (stilisierte k.u.k.-Pinselstrich-Ästhetik, überzeichnete Charakter-Silhouetten), **Disco Elysium** (melancholische Ölfarb-Palette, malerische Dichte) und **Little Nightmares** (groteskes Chiaroscuro-Lichtspiel, wachsartige Texturen, Theaterkulissen-Vibe).
    - Zeitlos, ressourceneffizient für WebGPU/WebGL und ideal für die Symbiose aus morbider Eleganz und schwarzem Wiener Humor.
12. **Engine-Erweiterung: `OutlineElement` (Toon / Comic Ink Outline):**
    - Implementiert in der Post-Processing-Pipeline für WebGPU (`PostProcessPass.ts`, `PostProcess.frag.wgsl`) und WebGL (`PostProcessPassGL.ts`, `PostProcess.frag.glsl`).
    - Ermöglicht stufenlose Strichstärke (`thickness`), Kantensensitivität (`sensitivity`) und Kantenfarbe (`color`) für den perfekten Graphic-Novel-Look.
    - 395 Vitest-Tests grün.
13. **Perspektiven-Architektur: Das „Wiener Guckkasten-Prinzip“ (Dualer Kamera-Hybrid):**
    - *Oberwelt / Ruinen*: Isometrischer / Top-Down-Blick (*Disco Elysium*-Stil) für Orientierung, weite Plätze, NPC-Dialoge und Straßen-Erkundung.
    - *Innenräume / Bunker / Katakomben*: 2.5D Theaterbühnen-Schnittmodell (*Little Nightmares*-Stil) für beklemmende Chiaroscuro-Schleichpassagen, Klettereien und intime Raum-Rätsel.
    - *Nahtloser Kameraschwenk (Seamless Transition)*: Butterweiche Kamera-Interpolation von Schrägdraufsicht auf Augenhöhe beim Betreten von Bunkern/Gebäuden, während Fassaden wie Theaterprospekte transparent werden. Maximale visuelle Dichte bei minimalem Modellierungsaufwand.
14. **Diverses, kontextsensitives Rätsel-System (*The 7th Guest* / *Gabriel Knight 2* / *Myst*-Philosophie):**
    - Konsequente Absage an Copy-Paste-Minigames (wie die immer gleichen Terminals in *Fallout*).
    - 6 handgefertigte, im Wiener Setting verwurzelte Rätselklassen:
      1. *Mechanik/Physik*: Flaschenzüge, Dampfventile, Wasserpegel-Schotts.
      2. *Bürokratie/Chiffren*: Amtsstempel-Kombinatorik für Passierschein 7b, Lochkarten, Klapptafeln.
      3. *Akustik/Frequenzen*: Oszilloskop-Wellenabgleich, Zahlensender Kahlenberg, Safe-Knacken nach Gehör.
      4. *Alchimie/Chemie*: pH-Titration, Reagenzgläser, Säureschlösser im Bermudadreieck.
      5. *Sakral/Uhrwerk*: Sonnen-Schattenwurf auf kaiserliche Adelswappen, Orgelpfeifen-Resonanzen, Zifferblätter.
      6. *Prater-Kuriositäten*: Riesenrad-Zahnradkaskaden, Sequenz-Schießbuden-Trigger.
15. **Design-Mandat: Befreiung von Shooter- & Fetch-Quest-Monotonie:**
    - Weg von stumpfen Botengängen („Bringe 5 Dosen Bohnen von A nach B“) und sinnlosen Baller-Orgien.
    - Stattdessen echter Detektiv- & Abenteuer-Geist: Entschlüsseln von Welt-Hinweisen, moralische Verhandlungen, Deeskalation, Schleichen und das Finden alternativer Lösungswege (z.B. Bestechung vs. Hacken vs. physikalisches Umgehen).
16. **Das taktile Werkzeug- & Waffen-Arsenal (Klasse statt Masse & Modding):**
    - Konsequente Absage an Loot-Spam (keine 20 belanglosen Schwerter/Pistolen mit +2% Werten).
    - 4 seltene, charakterstarke Grundstücke: *Dienstpistole des Großvaters*, *Schaufler-Querflinte*, *modifiziertes Kirmes-Luftgewehr* und das multifunktionale Brechwerkzeug (*„Wiener Hebel“*).
    - Tiefes, mechanisches Modding an Werkbänken (Laserpointer aus TU-Optiken, Granitsplitt-Chokes, Gift-Injektoren, Schalldämpfer).
    - Gadgets & Köpfchen im Fokus: Alchimisten-Schlafgase in Lüftungsschächten, aufziehbare Spieluhren als akustische Lockvögel, Säure-Ampullen für Schlösser.
17. **Visuelle Konzept-Skizzen & Interaktives Concept Dossier:**
    - Alle 5 Graphic-Noir-Skizzen lokal im Projekt verankert (`src/apps/and-now/docs/assets/`).
    - Vollständige Ausgestaltung von [`concept-dossier.html`](src/apps/and-now/docs/concept-dossier.html) mit Galerie, den 3 Spielarchitektur-Säulen (*Guckkasten-Prinzip*, *Myst-Rätsel*, *Taktiles Arsenal*) und den 5 Wiener Fraktionen (inkl. der *Hundertwasser-Gilde* von Spittelau).
18. **Das Großvater-Mysterium & Die Kaffeedosen-Urne (*The Last of Us*-Dramaturgie):**
    - *Bürokratische Vertuschung*: KI „Amtsrat 4.1“ vermeldet Alterstod; die Akte ist mit Sperrvermerk Stufe 3 belegt.
    - *Infiltration Sektor 0*: Auffinden der Leiche in Kältekammer-Fach K-42; Einstichwunde am Hals (Bittermandel-/Blausäuregeruch der Giftmischer); geraubtes Medaillon; umklammerte D-Wagen-Fahrkarte mit Kapuzinergruft-Koordinaten.
    - *Wiener Relikt-Urne*: Heimliche Einäscherung im Bunker-Ofen (gegen das Massengrab/Komposter) und Abfüllung in eine antike, geprägte Messing-Kaffeedose als ständiger Reisebegleiter im Rucksack.
19. **Die Familie Novotny (Böhmisch-Wienerische Identität):**
    - Kanonischer Familienname: **František Novotny** (Großvater, Vorkriegsgeneration mit böhmischen Wurzeln), **Fritz Novotny** (Vater, Wiener Bunker-Zwischengeneration) und die Spielfigur (*[Vorname & Geschlecht frei wählbar] Novotny*).
    - In-Game-Ansprache: NPCs, Akten und die KI „Amtsrat 4.1“ sprechen die Figur stilecht mit *„Novotny“*, *„Bürger/in Novotny“* oder dem gewählten Vornamen an.
    - Verwurzelt in der reichen böhmisch-mährischen Einwanderungsgeschichte Wiens (die klassischen „Ziegelböhm“ und k.u.k.-Handwerker) – verleiht der Familie sofort bodenständigen Wiener Charme.
20. **Das Schicksal der Eltern (Ungeschminkte Endzeit-Hintergründe):**
    - *Elena Novotny (Mutter)*: Früher Tod an der Bunkergrippe/Lungenfäule durch feuchte, unzureichende Umluftfilter – bittere Bunkeralltag-Realität ohne Melodram.
    - *Fritz Novotny (Vater)*: Verschollen in den 2080ern als AZS-Kanalspäher bei einer Tunnel-Erkundung Richtung Stadtpark/Wienfluss.
    - *Environmental Lore*: Keine aktiven Suchquests; Details und Erinnerungen existieren nur als optionale vergilbte Tagebucheinträge, Audiologs und alte Späherberichte in der Spielwelt.
21. **Profil der Spielfigur (Anfang 20 / Generation 2100):**
    - Alter: **~22 bis 24 Jahre** (geb. ca. 2076–2078 tief im Flakturm Arenberg).
    - Physisch agil, lernfähig, aber ohne jede Oberflächenerfahrung – ein unbeschriebenes Blatt mit jugendlicher Neugier und emotionaler Bindung an die Erzählungen des Großvaters.
22. **Dialog-System & Intelligentes Amts-Logbuch (Zero-Pen-and-Paper):**
    - *Wiener Dialoge*: Multiple-Choice mit Wiener Schmäh, k.u.k.-Bürokratie, Verhandlungsgeschick und Deeskalation.
    - *Auto-Journaling*: Alle gehörten/gelesenen Passwörter, Tresor-Kombinationen, Frequenzen und Gesprächsfetzen werden **automatisch im AZS-Handgerät protokolliert**.
    - *Kontext-Transfer*: Steht der Spieler vor einem Schloss oder Terminal, wird der passende Code aus dem Logbuch automatisch eingeblendet/eingefügt.
    - *Františeks Tagebuch*: Archivierte Skizzen, alte U-Bahn-Pläne und Notizen des Großvaters im Gerät.
23. **Der interaktive 60-Sekunden-Prolog (Unsichtbares Tutorial & Mystery-Zündung):**
    *   *Phase 1 (Dialog-Tutorial)*: Blockwart Hawelka schiebt Františeks Handgerät herein. Spieler wählt intuitiv 2 aus 3 Fragen (über den Fundort, die Halsflecken, die Kanzlei).
    *   *Spannungs-Abbruch*: Stiefeldröhnen der AZS-Wachen im Gang – Hawelka flieht panisch (*„Ich war nie hier!“*).
    *   *Phase 2 (UI & Auto-Journal-Tutorial)*: First-Person-Nahansicht des Röhren-Screens. Anschalten per Drehschalter, Rattern der Sterbemeldung (KI „Amtsrat 4.1“), sichtbares Auto-Archivieren von *„Fach K-42“* und *„Kühlstrang“* im Logbuch.
    *   *Nahtloser Übergang*: Rückkehr in den 2.5D-Bühnenschnitt – volle Bewegungsfreiheit zur Infiltration von Sektor 0.
24. **Interaktiver 60-Sekunden-Cinematic-Prototyp:**
    *   Vollständig lauffähiger interaktiver Storyboard-Player erstellt (`prologue-preview.html`).
    *   Enthält Echtzeit-Timeline, CRT-Scanline-Filter, Szenenwechsel zwischen 2.5D-Wohnkoje und First-Person-Terminal sowie interaktive Multiple-Choice-Verzweigung mit Hawelka.
25. **Gerendertes 60-Sekunden-Cinematic-Video (MP4 mit Kamera-Fahrten):**
    *   Mit FFmpeg als Full-HD-Video (`1920x1080 @ 25fps`) gerendert (`prologue_cinematic_preview.mp4`).
    *   Enthält fließende Zoom-Pan-Kameradynamik von der 2.5D-Bühnenszene zur Terminal-Nahaufnahme.
    *   Liegt dauerhaft unter `src/apps/and-now/docs/assets/prologue_cinematic_preview.mp4`.
26. **Echtzeit-3D-Prolog-Szene in Small World Machine (`src/apps/and-now/scenes/prologue/`):**
    *   Vollständige 3D-Implementierung des 2.5D-Bühnenschnitts in TypeScript ([`PrologueScene.ts`](src/apps/and-now/scenes/prologue/PrologueScene.ts)) und HTML ([`index.html`](src/apps/and-now/scenes/prologue/index.html)).
    *   *Features*: Animierte aufschwingende Panzertür, dynamischer Flurlicht-Spotkegel, schwebende Staubpartikel, Stockbett, Messing-Kaffeemühle, flackerndes CRT-Terminal mit First-Person-Kamerafahrt und interaktive Multiple-Choice-Abfrage mit Hawelka.
    *   Nutzt die PostProcessing-Pipeline (*Outline*, *Bloom*, *Vignette*, *Grain*, *ToneMapping*).

**Nächste Schritte:**
- Detaillierung der Einstiegs-Szenen im Bunker Arenberg (Leveldesign, Props, PBR-Materialien, Beleuchtung im 2.5D-Bühnenschnitt).
- Spezifikation des AZS-Handgeräts („Amts-Terminal 2100“) und der KI „Amtsrat 4.1“.



## 27. Bugfix: CORS und Rendering des Prologs (2026-08-22)
- **Problem:** Dev-Server / Caddy spielten die Prolog-Szene aufgrund verwaister Vite-Build-Pfade und fehlerhafter Kamera-Projektion nicht ab. Zudem fehlte der UI Play-Button im HTML der Szene.
- **Lösung:** 
  - Prolog-Szene architektonisch sauber nach `showcases/31/` verschoben, um Vite's internes Routing für Showcases out-of-the-box zu nutzen.
  - Kamera-Projektions-Überschreibung entfernt (nutzt jetzt die standardmäßige, Resize-robuste AbstractShowcase Kamera).
  - Fehlende HTML-UI für die Timeline mit dem Play-Button eingefügt.
  - Lichtstimmung kurzfristig hochgeschraubt zur Fehleranalyse, danach wieder auf Original "Graphic Noir"-Level zurückgesetzt.
- **Status:** Szene 100% funktionsfähig im Build (Caddy).

## 28. "And Now?" Infrastruktur (2026-08-22)
- **Struktur:** Prolog-Szene von `showcases/31` zurück nach `src/apps/and-now/scenes/prologue/` verschoben.
- **Hub:** Neue Startseite (`src/apps/and-now/index.html`) als zentrales Hub für alle "Wien" Szenen gebaut.
- **Vite:** Routing in `vite.config.ts` (`andNowHub`, `andNowPrologue`) stabilisiert, so dass die App-Struktur als native Multi-Page-App im Build und Dev-Server out-of-the-box funktioniert.

## 29. Lore-Update: Die Vertuschung und der erste Heist (2026-08-22)
- **Problem behoben:** Es war unlogisch, dass die pedantische AZS-Bürokratie dem Großvater bei der Katalogisierung das D-Wagen-Ticket in der Hand gelassen und den Mord übersehen hätte.
- **Neue Wendung:** Das AZS steckt voll in der Vertuschung! Offiziell ein "natürlicher Tod", doch die Leiche weist in der Kältekammer K-42 einen Einstich (Blausäure) auf. 
- **Neuer Gameplay-Loop:** Die Leiche hat nichts mehr bei sich. Die gesamte Habe wurde in die AZS-Asservatenkammer gebracht. Novotny muss dort einbrechen ("Der erste Heist"), um das Medaillon und den D-Wagen-Passierschein zurückzuholen. (In `story.md` übernommen).

## 30. Meilenstein: Akt II - IsoExplore Setup (2026-08-22)
- **Umsetzung:** Die Infrastruktur für die erste spielbare isometrische Szene (Flakturm Gänge) wurde hochgezogen.
- **Dateien:** `src/apps/and-now/scenes/iso-explore/isoExplore.ts` und `index.html` erstellt. Vite-Config und App-Hub wurden aktualisiert, um die Szene zu verlinken.
- **Aktueller Stand:** Eine rohe Szene mit düsterer "Diablo"-Kameraperspektive und einem roten Platzhalter-Block (Novotny) steht.
- **Nächster Schritt:** Implementierung eines isometrischen Movement-Controllers für Novotny.

## 31. Lore-Konsistenzpass: Františeks Alter & Der persönliche Antagonist (2026-08-23)
- **Anlass:** Konsistenz-Review der aktuellen Story-Dokumente (`story.md`, `concept-dossier.html`, `log.md`) auf Widersprüche im Zusammenspiel von Fraktionen, Figuren, Orten und Handlung.
- **Fix 1 (Alter):** Františeks Geburtsjahr war mit „~2042" rechnerisch unmöglich für seine eigene Biografie (8 Jahre alt beim Schlag ~2050, aber als etablierter Erwachsener mit Vorkriegs-Erinnerungen und -Karriere beschrieben). Auf **~2005** korrigiert – Mitte 40 beim Schlag, knapp 95 bei seinem Tod 2100. Macht ihn zum letzten lebenden Zeitzeugen der echten alten Welt, was den Verlust noch schwerer wiegen lässt.
- **Fix 2 (Mordfaden zusammengeführt):** Der Mordfaden aus dem Prolog (Gift, geraubtes Medaillon, D-Wagen-Fahrkarte zur Kapuzinergruft) drohte ins Leere zu laufen, seit `Story-Dramaturgie.md` (mit der ursprünglich geplanten IAEA-Keycard-Enthüllung am Grab) aus dem Kanon entfernt wurde. Statt den Faden fallen zu lassen, neu verankert:
  - **Hofrat Brandstätter** (neuer Eintrag bei Fraktion D/AZS, „Der persönliche Antagonist") hat den Mord in Auftrag gegeben und die Vertuschung als „natürlicher Tod" persönlich abgesegnet – ein hochrangiger Beamter aus der Rossauer-Kaserne-Zentrale, nicht die lokale Bunkerleitung Arenberg. Wird als wiederkehrender persönlicher Widersacher über mehrere Kapitel angelegt, sobald er von Novotnys Diebstahl aus der Asservatenkammer erfährt.
  - **Das Medaillon** ist kein reines Erbstück mehr, sondern birgt ein verborgenes technisches Innenleben unbekannter Funktion – bewusst offen gelassen als laufendes Mysterium statt sofort aufgelöst, um die Geschichte nicht zu überladen.
  - *Bewusst nicht entschieden*: Ob über Brandstätter hinaus noch eine weitere Ebene (wer/was steht hinter ihm) existiert, bleibt vorerst offen für spätere Sessions.
- **Status:** Beide Fixes in `story.md` eingearbeitet (Familie-Novotny-Abschnitt, AZS-Fraktion, Prolog-Bullets „Infiltration Sektor 0" bis „Aufbruch").

## 32. Lore-Konsistenzpass Teil 2: Fraktionsname & Kapuzinergruft (2026-08-23)
- **Fix 3 (Namensinkonsistenz Spittelau):** Für dieselbe Gruppe kursierten drei Namen parallel: „Die Wächter von Spittelau" (`story.md` Fraktions-Geflecht, `concept-dossier.html`-Galerie), „Die Aschenbrenner" (`story.md`-Ortsbeschreibung Spittelau) und „Hundertwasser-Gilde" (Dossier-Untertitel, `log.md` Eintrag 17). **„Die Aschenbrenner"** als kanonischer Name festgelegt (passt zum knappen Substantiv-Namensmuster der anderen Fraktionen), „Hundertwasser-Gilde" bleibt als Spottname wegen der Fassade erhalten. In `story.md` (Fraktions-Geflecht + Ortsbeschreibung) und `concept-dossier.html` (Fraktions-Galerie) vereinheitlicht.
- **Fix 4 (AZS fehlte im Dossier):** Die Fraktions-Galerie in `concept-dossier.html` zeigte nur 5 Karten (Pompfinebrer, Giftmischer, Konsulat, Ringelspiel-Syndikat, Aschenbrenner) – die AZS als zentrale Antagonisten-Fraktion fehlte komplett. Karte ergänzt (inkl. Verweis auf die Vertuschung), Sektions-Überschrift auf „6 Fraktionen" korrigiert.
- **Fix 5 (Kapuzinergruft-Orphan):** Die Kapuzinergruft (Schauplatz 4) war seit jeher nur mit einer vagen, nie genutzten Rivalität zwischen Pompfinebrern und „Kaisertreuen/Grabkultisten" beschrieben, obwohl die D-Wagen-Fahrkarte aus dem Heist explizit ihre Koordinaten trägt. Rollenbeschreibung um diesen Bezug ergänzt (Ziel der Fahrkarte, offene Frage was František dort vorhatte); die Kaisertreuen/Grabkultisten explizit als Kulisse/kleines Hindernis markiert, nicht als eigene, noch auszuarbeitende Fraktion – um keine unerfüllte Erwartung einer 7. Fraktion zu wecken.

## 33. Meilenstein: Architektur-Proof 2.5D & WebGL Bug-Safari (2026-08-23)
- **Architektur-Shift:** Erfolgreicher Konzept-Test für den "2.5D Matte Painting" Workflow (`pipeline_2_5d.md`). 3D Charaktere bewegen sich vor statischen AI-Hintergründen. Die `isoExplore` Szene wurde aus Kompatibilitätsgründen aus der verschachtelten App-Struktur in den robusteren Pfad `showcases/andNowIso` verschoben und in der Haupt-`index.html` verlinkt.
- **Die große Bug-Safari:** Ein massiver Fehler-Marathon brachte die Engine zum Absturz (`program not linked` und `INVALID_ENUM`). Die Ursache war ein vermeintlich einfaches "Low Poly" Sketchfab-Modell des Detektivs.
  - Auf WebGL2 sprengte das viel zu komplexe PBR-Material des Modells in Kombination mit PointLights das harte Hardware-Limit von 16 Textur-Einheiten (`MAX_TEXTURE_IMAGE_UNITS(16)`).
  - Auf dem Fallback (WebGL1) stürzte die Engine ab, weil das Modell mit 32-Bit Indices (>65k Vertices) exportiert wurde, was WebGL1 standardmäßig ohne Extension (`OES_element_index_uint`) nicht lesen kann.
- **Lösungen & Heutiger Abschluss:**
  - CSS für das Canvas (`100vw/vh`) gepatcht, um Resize-Fehler zu beheben.
  - Den Hintergrund auf extrem ressourcenschonendes `BasicMaterial` mit `diffuseMap` umgestellt.
  - Das toxische GLB-Modell wurde im Code auskommentiert (und testweise mit leerem `LambertMaterial` überschrieben), um den Absturz zu beenden.
  - Die Szene lädt nun problemlos auf dem `BEST` Renderer (WebGL2).
- **Nächster Schritt (Restart):** Ein neues, absolut sauberes GLB-Modell (8.2k Triangles, ohne fette PBR Texturen) wurde vom User gefunden. Beim nächsten Start der Session binden wir dieses Modell ein und platzieren es korrekt vor dem Flakturm-Hintergrund!

## 35. Skeletales GPU-Skinning & GLTF-Animationssystem (2026-08-24)
- **Meilenstein:** Vollständiges, hardwarebeschleunigtes Skeletal Skinning & Keyframe-Animationssystem im Engine-Core (`main` Branch) implementiert.
- **Core-Klassen & Datenstrukturen (`src/core/animation/`):**
  - [`Bone`](src/core/animation/Bone.ts): Hierarchischer Skelettknoten (erweitert `Object3D`) mit `inverseBindMatrix`.
  - [`Skeleton`](src/core/animation/Skeleton.ts): Verwaltung der Knochenhierarchie, globale Transformation und Berechnung der `Float32Array` Bone-Matrizenpalette.
  - [`SkinnedMesh`](src/core/animation/SkinnedMesh.ts): Mesh mit Bindung an ein `Skeleton` und automatischer Aktualisierung der Bone-Matrizen im Render-Cycle.
  - [`KeyframeTrack`](src/core/animation/KeyframeTrack.ts), [`AnimationClip`](src/core/animation/AnimationClip.ts), [`AnimationAction`](src/core/animation/AnimationAction.ts), [`AnimationMixer`](src/core/animation/AnimationMixer.ts): Vollständiges Animations-Playback-System mit linearer Translation/Scale-Interpolation und Quaternion-Slerp für Rotationen.
- **GLTF/GLB-Pipeline (`src/loaders/GltfLoader.ts`):**
  - Automatisches Parsen von GLTF-Skins (`JOINTS_0`, `WEIGHTS_0`, `inverseBindMatrices`), Instanziieren von `Bone`-Knoten und `SkinnedMesh`.
  - Parsen eingebetteter GLTF-Animationen sowie neue Methode `loadAnimations(url)` zum Laden separater Animationsdateien (z. B. `idle.glb`).
- **Shader & WebGL2-Renderer (`WebGL2Renderer.ts`, GLSL Shaders):**
  - Vertex-Shader (`base_vertex_header.vert.glsl`, `base_vertex_main.vert.glsl`) transformieren Vertices und Normalen im Vertex-Shader per GPU Skinning (`USE_SKINNING` Preprocessor-Flag).
  - VBOs für `jbo` (Joints) und `wbo` (Weights) in [`Mesh.ts`](src/renderers/Mesh.ts) integriert.
- **Showcase-Integration & Verifikation:**
  - In [`showcases/andNowIso/showcase.ts`](showcases/andNowIso/showcase.ts) wird `mannequin.glb` mit der separaten Mixamo-Animation `idle.glb` über den `AnimationMixer` in Echtzeit wiedergegeben.
  - Alle 73 Testsuiten und 399 Unit Tests laufen 100% grün.
## 36. Shader-Contract Validation & UBO/Sampler-Budget Parity (2026-08-24)
- **Shader-Paritäts- & Link-Fixes:**
  - **UBO `GlobalUniforms` Synchronisation:** Das `layout(std140) uniform GlobalUniforms`-Layout in `base_vertex_header.vert.glsl` wurde exakt an `lights.frag.glsl` angeglichen (`u_tileSizePx`, `u_clusterDims`), um Field-Number-Mismatch-Linkfehler zu verhindern.
  - **16-Sampler-Budget Hardware-Wächter:** Optionale Material-Texturen in `StandardMaterial`, `PhongMaterial`, `LambertMaterial` und `base_fragment_header.frag.glsl` werden nun strikt mit Preprocessor-Flags (`USE_NORMAL_MAP`, `USE_SPECULAR_MAP`, `USE_METALLIC_MAP`, `USE_IBL` etc.) bedarfsgesteuert kompiliert, wodurch alle Materialien das Apple Silicon Limit (`MAX_TEXTURE_IMAGE_UNITS(16)`) sicher einhalten.
  - **Chunk-Regex-Fix:** GLSL-Array-Größen (`pcssTaps`) kollidieren nicht mehr mit der `[CHUNK_NAME]`-Syntax des `ShaderRegistry`-Parsers.
- **Automatisierte Testsuite (`tests/core/renderers/shaders/ShaderValidation.test.ts`):**
  - Prüft alle 13 Core-Materialien auf vollständige Chunk-Auflösung ohne verwaiste Platzhalter.
  - Verifiziert die exakte Feld-Gleichheit des `GlobalUniforms` UBOs im AST-Vergleich zwischen VS und FS.
  - Simuliert den GLSL-Präprozessor und sichert das Sampler-Budget $(\le 16)$ für jedes Material ab.
- **Status:** 74 Testsuiten mit 426 Unit Tests 100% grün (`npm run test`, `npm run lint:fix`, `npm run build:lib`).

## 37. Die große Entwirrung: 2.5D-Bühnen-Architektur & Szenen-Struktur (2026-08-25)
- **Klärung der Dual-Perspektive:**
  - Trennung zwischen dem echten isometrischen Modus (Erkundung der Oberwelt/Straßen) und dem 2.5D-Bühnenmodus (Bunker-Schnittmodelle & Kammerszenen).
- **Bereinigung des 2.5D-Bühnensystems:**
  - `StageZone` und `StageMovementBehavior` arbeiten nun auf reinen 2D-Bildkoordinaten `(u, v)` (0..1) ohne künstliche 3D-Unprojektionen oder Kamera-Horizon-Abhängigkeiten.
  - Zonen-Sliding und lokale Bewegungsachsen laufen direkt im 2D-Polygon-Raum.
- **Szenen-Umbenennung:**
  - `showcases/andNowIso` wurde sauber nach `showcases/andNowScene2` umbenannt (Klasse `AndNowScene2`).
  - Die Eröffnungsszene (Großvaters Tod in Koje 42) ist als `andNowScene1` (Prolog) im Hub verankert.
- **Status:** Build und Testsuite laufen 100% grün (75 Testdateien, 439 Unit Tests).

## 38. Charakter-Design & Kleidungskonzept Novotny (2026-08-25)
- **Kanonischer Look & Physis:** *„Der Schacht-Trench & Loop-Hoodie“*.
  - **Statur & Physis:** Anfang zwanzig, schlank/hager und drahtig (keine Muskelmassen – geprägt von 20 Jahren kargem Bunkerleben). Melancholisch-suchende Ausstrahlung („a armer Hund im Bunker“).
  - **Basisschicht & Mundschutz:** Dunkler **Hoodie mit Kapuze** + dicker Woll-**Loop-Schal (Schlauchschal / Snood)**, der flexibel als textiler Staub- und Kälteschutz über Mund und Nase hochgezogen wird.
  - **Mantel & Kleidung:** Dunkelgrauer, gewachster Arbeits-Trenchcoat aus Loden mit hochgeschlagenem Kragen über robuster dunkelgrauer **Cargohose mit Blasebalgtaschen** und angeschnallten **Motorrad-Knieschützern** (Schutz beim Kriechen in Schächten).
  - **Ausrüstung:** Breite Lederkoppel, fingerlose Arbeitshandschuhe, feste Schachtstiefel, Messing-Sturmlaterne.
  - **3 Trage-Modi:** 1) Staubschutz-Modus (Kapuze auf + Loop-Schal hoch), 2) Bunker-Modus (Kapuze ab + Schal als Kragenwärmer), 3) Sektor-0-Modus (mit aufgesetzter Gasmaske).
  - **Weibliche Variante:** Anatomisch leicht angepasst und dezent tailliert, bei 100%iger Beibehaltung der wetterfesten, abgewetzten Bunker-Funktionalität.
- **Dokumentation & Skizzen:** In [`story.md`](src/apps/and-now/docs/story.md), [`concept-dossier.html`](src/apps/and-now/docs/concept-dossier.html) und `novotny_character_concepts.md` eingepflegt.

## 39. Core-Feature: `AxesHelper` & Inspector Gizmo Integration (2026-08-26)
- **Feature:** [`AxesHelper`](src/core/helpers/AxesHelper.ts) als universelles 3D-Koordinatenkreuz im Engine-Core implementiert.
  - **Farbcodierung:** Neon-Rot (+X / Rechts mit "X"-Label), Neon-Grün (+Y / Oben mit "Y"-Label), Neon-Blau (+Z / Z-Achse mit "Z"-Label).
  - **Aufbau:** Zylinder-Schaft, Konus-Pfeilspitze und automatische kameraausgerichtete Billboard-Labels (`Sprite` + `TextTexture`).
- **GadgetInspector Integration:**
  - `showWorldAxes` (Welt-Koordinatenkreuz am Ursprung) und `showObjectAxes` (automatisches Mitwandern am ausgewählten Objekt/Bone) im Inspector unter „Helpers & Gizmos“ integriert.
  - In [`showcases/andNowScene2/showcase.ts`](showcases/andNowScene2/showcase.ts) via `enableInspector: true` aktiviert.
- **Status:** 76 Testsuiten mit 444 Unit Tests 100% grün.

## 40. Laternen-Ausrichtung & Inspector UX-Refinement (2026-08-26)
- **Laternen-Ausrichtung auf Hand-Bone:**
  - `mixamorig:LeftHand` Bone-Ausrichtung analysiert: Rotation um $Z$ (`Math.PI / 2`) angewendet, sodass der Laternenkörper senkrecht nach unten (+X des Hand-Bones) hängt.
  - Griffpunkt (`LanternHandle`) um ~9cm vom Handgelenk-Pivot nach vorne direkt in die Handfläche/Finger positioniert (`position.set(0.01, 0.09, 0.02)`).
  - Punktlicht (`PointLight`) direkt im Laternenkörper zentriert.
- **Inspector UX-Verbesserungen:**
  - `🎯 Selected Object` fest als oberster Bereich im Scene-Tab verankert mit automatischer Aufklapp- und Scroll-Funktion bei Selektion.
  - Scene Outliner standardmäßig eingeklappt, um UI-Überladung zu vermeiden.
  - Doppelklick- und Klick-Auswahl auf jedes 3D-Mesh im Viewport.
- **Status:** 100% verifiziert, alle 444 Tests und Builds grün.

## 41. Asset-Bereinigung & Trennung von Laufzeit- vs. Rohdaten (2026-08-26)
- **Laufzeit-Bereinigung (`public/assets/and-now/`):**
  - Radikal bereinigt: Enthält nur noch die 5 tatsächlich zur Laufzeit im Browser benötigten Dateien (`flakturm_bg.webp`, `novotny-female.glb`, `idle_torch.glb`, `standing_torch_walk_forward.glb`, `ascending_stairs.glb`).
  - Redundante `concepts/`-Kopie aus `public/` entfernt.
- **Roh- und Autorendaten (`src/apps/and-now/raw/mannequin/`):**
  - Alle DCC-Quelldaten (`.fbx`, `.obj`, `.mtl`, `.zip`, `.fbm/`, alte Dummy-Mannequins) in den nicht-öffentlichen App-Quellordner verschoben.
- **Konzept- & Dokumentationskonsolidierung (`src/apps/and-now/docs/`):**
  - Sämtliche Konzeptgrafiken, T-Pose-Referenzen und Markdown-/HTML-Dossiers zentral unter `docs/` und `docs/assets/`.
- **Status:** 100% verifiziert, alle 444 Tests und Builds grün.

## 42. Character-Pipeline Skill & Tripo3D Vorbereitung (2026-08-26)
- **Skill-Erstellung:** Neuer offizieller Leitfaden [`.agents/skills/character-pipeline/SKILL.md`](.agents/skills/character-pipeline/SKILL.md) etabliert (2D-Skizzen, Image-to-3D, Auto-Rigging, `.glb`-Konvertierung, Bone-Attachment, AnimationMixer).
- **Referenzen:** [`REFERENCES.md`](REFERENCES.md) aktualisiert (`AxesHelper`, Novotny Rig & Motion Clips, Mixamo Mannequin).
- **Tripo3D Integration:** `tripo-cli` installiert und vorbereitet für zukünftige automatisierte 3D-Generierung, Auto-Rigging (`animate_rig`) und direkten GLB-Export.
- **Status:** 100% verifiziert, alle 444 Tests und Builds grün.

## 43. Tripo3D API & CLI Pipeline Automation (2026-08-26)
- **Skill-Update:** [`.agents/skills/character-pipeline/SKILL.md`](.agents/skills/character-pipeline/SKILL.md) von manuellen Web-UI-Schritten vollständig auf die skriptbare `tripo-cli` & API umgestellt:
  - Rekonstruktion: `tripo make` für Multi-View Orthographics & Text-Prompts (`--for game-mobile`).
  - Skeletal Auto-Rigging: `tripo anim rig` mit `--spec mixamo` für 100% Small-World-Machine-kompatible Bone-Hierarchien.
## 44. Novotny (Männlich) Asset-Ingestion & Showcase-Integration (2026-08-27)
- **Asset-Pipeline:**
  - 3 T-Pose-Turnarounds (Front, Profil, Back mit exakter Symmetrie, sichtbarem Gesicht, herabhängender Kapuze und Schal um den Hals) erzeugt (`src/apps/and-now/docs/assets/`).
  - Tripo-generiertes 3D-Modell mit 41-Joint Biped Rig als [`public/assets/and-now/mannequin/novotny-male.glb`](public/assets/and-now/mannequin/novotny-male.glb) und Rohdaten in [`src/apps/and-now/raw/mannequin/`](src/apps/and-now/raw/mannequin/) integriert.
- **Showcase & Scene 2:**
  - [`showcases/andNowScene2/showcase.ts`](showcases/andNowScene2/showcase.ts) lädt `novotny-male.glb` standardmäßig (bzw. `novotny-female.glb` via URL-Query `?char=female`).
  - Hand-Bone-Auflösung für die Laterne auf Multi-Skeleton-Support (`LANTERN_HAND_BONE_NAMES`) erweitert.
  - Textur-Mapping unterstützt sowohl eingebettete GLB-PBR-Maps als auch externe Textur-Overlays.
## 45. Vollautomatisierte Tripo3D API Pipeline & Web-Optimierung (2026-08-27)
- **End-to-End API Ausführung:**
  - 3D-Rekonstruktion via `tripo make` aus den 3 Orthographics mit PBR-Texturatlas und Game-Mobile Preset (`src/apps/and-now/raw/mannequin/tripo-male/`).
  - Skelett-Generierung via `tripo anim rig --spec mixamo` erzeugt 67-Joint Rig (`novotny-male.glb`).
  - Modell liegt fertig geriggt und texturiert in [`public/assets/and-now/mannequin/novotny-male.glb`](public/assets/and-now/mannequin/novotny-male.glb).
- **Skill-Vorgaben (`character-pipeline`):**
  - Strikte Web-Performance-Regeln verankert: `--for game-mobile`, `--param face_limit=15000`, 2K Textur-Standard (`--param texture_quality=standard`), **strikt kein 4K/8K** für VRAM-Schonung im Browser.
  - Metrische 1.8x-Skalierung für normalisierte Tripo-Modelle in Small World Machine dokumentiert.
## 46. Upgrade des Character-Pipeline Skills auf Studio-Standard (2026-08-27)
- **5 Profi-Optimierungen verankert ([`character-pipeline`](.agents/skills/character-pipeline/SKILL.md)):**
  1. *Albedo-First Mandat:* Verpflichtend reine Albedo-Farbfelder in 2D-Prompts ohne gebackene Richtungs-Schatten.
  2. *A-Pose (45°) Standard:* Empfehlung der A-Pose für reduzierte Deltoid-Verzerrung und saubere Achsel-Edge-Loops.
  3. *3-in-1 Model-Sheet:* 16:9 Multi-View-Sheet zur Garantie absoluter Detail- und Proportionskonsistenz.
  4. *Shared Motion Library:* Strukturierung geteilter In-Place-Clips unter `public/assets/shared/animations/`.
  5. *Semantic Sockets:* Standardisiertes Knochen-Mapping und Socket-System für Requisiten/Ausrüstung.
## 47. Kanonische Ausrüstung: Laterne rechts, Maske rechts vorne (2026-08-27)
- **Vereinheitlichung für beide Figuren (Female & Male):**
  - Laterne wird in der **rechten Hand** getragen (`mixamorig:RightHand` / `R_Hand` / `tripo::0_Right_Limb_2`).
  - [`showcases/andNowScene2/showcase.ts`](showcases/andNowScene2/showcase.ts): `LANTERN_HAND_BONE_NAMES` bindet die Laterne an den rechten Hand-Bone.
  - Atemschutzmaske ist am Gürtel **rechts vorne** befestigt.
  - Dokumentation in [`novotny_tpose_reference_prompts.md`](src/apps/and-now/docs/novotny_tpose_reference_prompts.md) und [`character-pipeline`](.agents/skills/character-pipeline/SKILL.md) verankert.
## 48. 3-Stufen Schutzkleidung (Gear States) & Skizzen-Katalog (2026-08-27)
- **Die 3 kanonischen Schutzzustände für Female & Male:**
  1. *State 1: BASE (Gute Luft / Erkundung):*
     - Gesicht voll sichtbar (unbedeckt).
     - Kapuze abgesetzt auf den Schultern, Haare/Kopfform frei.
     - Schlauchschal locker als Kragen um den Hals.
     - Gasmaske am Gürtel rechts vorne eingehängt, Laterne in rechter Hand.
  2. *State 2: DUST PROTECTION (Staub- & Rußzone):*
     - Schlauchschal über Mund & Nase als Staubfilter hochgezogen.
     - Kapuze über den Kopf aufgesetzt.
     - Gasmaske bleibt am Gürtel rechts vorne eingehängt, Laterne in rechter Hand.
     - Referenz: [`novotny_hoodie_male.jpg`](src/apps/and-now/docs/assets/novotny_hoodie_male.jpg).
  3. *State 3: TOXIC HAZARD (Giftgas / Schächte):*
     - Vollständige Atemschutzmaske aufgesetzt und festgezurrt.
     - Kapuze über den Kopf aufgesetzt.
     - Masken-Halterung am Gürtel rechts vorne ist leer, Laterne in rechter Hand.
- **6-Skizzen Matrix für Artwork & Produktion:**
  - `novotny_female_state1_base.jpg` / `novotny_male_state1_base.jpg`
  - `novotny_female_state2_dust.jpg` / `novotny_male_state2_dust.jpg`
  - `novotny_female_state3_toxic.jpg` / `novotny_male_state3_toxic.jpg`
- **AAA Skin & Movement Paradigma:**
  - Verhalten (`StageMovementBehavior`), Sockets, Animationsclips (`idle`, `walk`, `jump_trench`, `climb_ladder`) sind zu 100% identisch zwischen männlich und weiblich.
  - Der Charakter ist lediglich der austauschbare Skin (`novotny-female.glb` vs. `novotny-male.glb`), Gear-Zustände werden über modulare Sub-Mesh-Toggles zur Laufzeit geschaltet.
- **Status:** 76 Testsuiten mit 444 Tests und Library-Build 100% grün.

## 49. Kompletter Re-Run der Character-Pipeline für Novotny M & W (2026-08-27)
- **Pipeline-Ausführung:**
  - **Female Novotny:** Vollständige Rekonstruktion aus [`novotny_female_tpose_front.jpg`](src/apps/and-now/docs/assets/novotny_female_tpose_front.jpg), [`novotny_female_tpose_right.jpg`](src/apps/and-now/docs/assets/novotny_female_tpose_right.jpg), [`novotny_female_tpose_back.jpg`](src/apps/and-now/docs/assets/novotny_female_tpose_back.jpg) via `tripo make --for game-mobile` und geriggt via `tripo anim rig --spec mixamo`.
  - **Male Novotny:** Vollständige Rekonstruktion aus [`novotny_male_tpose_front.jpg`](src/apps/and-now/docs/assets/novotny_male_tpose_front.jpg), [`novotny_male_tpose_right.jpg`](src/apps/and-now/docs/assets/novotny_male_tpose_right.jpg), [`novotny_male_tpose_back.jpg`](src/apps/and-now/docs/assets/novotny_male_tpose_back.jpg) via `tripo make --for game-mobile` und geriggt via `tripo anim rig --spec mixamo`.
- **Harmonisierung:**
  - Beide Figuren verfügen über identische Knochenstrukturen (`mixamorig:RightHand`, `mixamorig:Hips`, etc.), 1.80m Normalisierungsskalierung und integrierte PBR-Texturen.
  - Runtime-Assets: [`public/assets/and-now/mannequin/novotny-female.glb`](public/assets/and-now/mannequin/novotny-female.glb) und [`public/assets/and-now/mannequin/novotny-male.glb`](public/assets/and-now/mannequin/novotny-male.glb).
  - Rohdaten: [`src/apps/and-now/raw/mannequin/tripo-female/`](src/apps/and-now/raw/mannequin/tripo-female/) und [`src/apps/and-now/raw/mannequin/tripo-male/`](src/apps/and-now/raw/mannequin/tripo-male/).
- **Live-Charakterwechsel:**
  - [`showcases/andNowScene2/showcase.ts`](showcases/andNowScene2/showcase.ts): Ermöglicht nahtloses Wechseln im laufenden Spiel mit Taste `[C]` sowie URL-Query `?char=female|male` unter Beibehaltung der Bühnenposition, des Animationsstatus und des Laternen-Sockets.
- **Status:** 90 Testsuiten mit 513 Tests und Library-Build 100% grün.

## 50. Tripo3D Animation Presets Integration (Idle, Walk, Climb) (2026-08-27)
- **Animation Retargeting via Tripo API:**
  - Für beide geriggten Charaktere (`novotny-female.glb` und `novotny-male.glb`) wurden die bipedalen Animations-Presets via `tripo anim retarget --animation preset:idle preset:walk preset:climb --animate-in-place` berechnet und direkt in die Runtime-GLBs integriert.
  - `preset:idle`: Lebendiges Stehen / Atmen (ohne starres Einfrieren).
  - `preset:walk`: Bipedales Gehen in-place.
  - `preset:climb`: Treppensteigen / Stufensteigen in-place.
- **Showcase Integration ([`showcases/andNowScene2/showcase.ts`](showcases/andNowScene2/showcase.ts)):**
  - Automatisches Auslesen der eingebetteten Animations-Tracks aus der geladenen GLB.
  - Dynamischer Zonen-Trigger: In Zone A & B wird `preset:walk` abgespielt, beim Betreten von Zone C (Treppenaufgang/Schleuse) blendet der Mixer automatisch auf `preset:climb` über. Im Stillstand läuft `preset:idle`.
  - [`BasicMaterial`](src/core/materials/BasicMaterial.ts) mit übertragener DiffuseMap garantiert optimale Sichtbarkeit im Graphic-Noir-Stil.
- **Status:** 90 Testsuiten mit 513 Tests und Library-Build 100% grün.

## 51. Reaktivierung der Studio-Torch-Animationen & Knochen-Aliasing (2026-08-27)
- **Problem & Analyse:**
  - Die generischen AI-Presets (`preset:walk`/`preset:idle`) führten zu unkontrolliertem Torkeln mit wild schwingenden Armen, wodurch die Hand-gebundene Laterne unruhig taumelte und falsch ausgerichtet war.
- **Lösung & Reaktivierung der Studio-Clips:**
  - Zurück auf die kuratierten Studio-Motion-Clips: [`idle_torch.glb`](public/assets/and-now/mannequin/idle_torch.glb), [`standing_torch_walk_forward.glb`](public/assets/and-now/mannequin/standing_torch_walk_forward.glb) und [`ascending_stairs.glb`](public/assets/and-now/mannequin/ascending_stairs.glb).
  - In diesen Clips ist die rechte Hand stabil in Fackel-/Laternen-Tragehaltung fixiert.
- **Engine-Verbesserung ([`src/core/animation/AnimationMixer.ts`](src/core/animation/AnimationMixer.ts)):**
  - Robustes Knochen-Aliasing (`mixamorig:`, `mixamorig1:`, etc.) aufgelöst, sodass alle Mixamo-Clips unabhängig von Präfix-Nummerierungen nahtlos auf die Biped-Skelette binden.
- **Status:** 90 Testsuiten mit 513 Tests und Library-Build 100% grün.

## 52. Novotny Original-Skins, Linke Hand Laterne & Asset-Bereinigung (2026-08-27)
- **Texture / Skin:**
  - Reine Graphic-Noir-Texturen aus den Original-Skizzen [`novotny_hoodie_male.jpg`](src/apps/and-now/docs/assets/novotny_hoodie_male.jpg) und [`novotny_hoodie_female.jpg`](src/apps/and-now/docs/assets/novotny_hoodie_female.jpg) für beide Figuren via [`BasicMaterial`](src/core/materials/BasicMaterial.ts) aktiv.
- **Laternen-Haltung (Linke Hand):**
  - Socket bindet prioritär an die **linke Hand** (`mixamorig:LeftHand` / `mixamorig1:LeftHand`).
  - Der Griff liegt in der linken Handfläche, der Laternenkörper hängt exakt senkrecht nach unten in Richtung Boden.
- **Bewegung & Animationen:**
  - Verwendung der 3 Studio-Clips: `idle_torch.glb` (Ruhiger Stand), `standing_torch_walk_forward.glb` (Gehen mit Laterne) und `ascending_stairs.glb` (Treppe).
  - Tasten-Toggle `[C]` schaltet zur Laufzeit nahtlos zwischen weiblichem und männlichem Novotny um.
- **Asset-Bereinigung:**
  - Alle nicht mehr benötigten T-Pose-Zwischenskizzen aus `docs/assets/` sowie temporäre Retarget-Ordner restlos entfernt.
- **Status:** 90 Testsuiten mit 513 Tests und Library-Build 100% grün.

## 53. Retrospektive: Grenzen des Tripo3D Auto-Riggings & Studio-Pipeline Erkenntnisse (2026-08-27)

### 1. Die Probleme des rein automatisierten Auto-Riggings (Tripo3D)
- **Fehlerhafte Knochen-Hierarchien:**
  - Trotz des Parameters `--spec mixamo` liefert das AI-Auto-Rigging von Tripo keine verlässliche Mixamo-Standard-Struktur. Insbesondere bei komplexeren Silhouetten (Hoodie, Schal, weite Kleidung) werden Gliedmaßen falsch geschachtelt (z. B. Armknochen als direkte Kinder von `tripo::Root` oder Kopfknochen unter Arm-Segmenten) und mit internen Platzhalternamen (`bone_XX`) belegt.
  - Dadurch greifen standardisierte Motion-Clips (`idle_torch.glb`, `standing_torch_walk_forward.glb`) ins Leere, was zu unbewegten, eingefrorenen oder verzerrten Gliedmaßen führt.
- **AI-Retargeting Presets sind ungeeignet für Game-Props:**
  - Die von Tripo generierten Retarget-Clips (`preset:idle`, `preset:walk`, `preset:climb`) sind generische, unkontrollierte Ragdoll-Bewegungen mit starkem Schlingern und wild schwingenden Armen.
  - Für Spielfiguren mit getragener Ausrüstung (Laterne, Waffe, Fackel) sind diese Presets unbrauchbar, da die Hand unkontrolliert durch den Körper wandert und die Laterne wild taumelt.
- **PBR-Shader vs. 2.5D Comic/Noir Lighting:**
  - Tripo exportiert PBR-Materialien mit hohen Metallic-/Roughness-Faktoren, die ohne vollständiges Image-Based-Lighting (IBL/HDRI) in einer 2.5D-Bühnenszene als komplett schwarze Silhouette rendern. Erst ein explizites Überschreiben mit [`BasicMaterial`](src/core/materials/BasicMaterial.ts) stellt die Texturen sichtbar dar.
- **Altlasten bei Texturen:**
  - Bei schnellen Asset-Iterationen bestanden noch Reste der alten Mannequin-Textur (z. B. weiße Haarsträhne des Ch36-Dummies). Texturen müssen immer dediziert aus den kanonischen Skizzen isoliert und validiert werden.

## 54. Root-Cause-Fix: Rig/Animation-Mismatch, Retargeting-Presets doch nutzbar, 64-Bone-GPU-Limit (2026-08-28)

**Anlass:** Anschluss an Eintrag 53 — die Figuren waren weiterhin sichtbar kaputt (Gliedmaßen reißen während Idle/Walk/Stairs). Root-Cause-Analyse per GLB-Bone-Dump statt Spekulation.

**Konkreter Befund:**
- Das deployte `novotny-male.glb` hatte `mixamorig:`-Namen, aber zusätzliche Twist-Hilfsknochen (`L_CalfTwist01/02` etc., `Waist`, `Root`) sowie einen doppelten `mixamorig:Hips`-Skin-Joint. Die externen Studio-Clips (`idle_torch.glb` etc., echte Mixamo-Web-Exports ohne Twist-Bones) animierten diese Zusatzknochen nie — sie blieben in Bind-Pose eingefroren, während Nachbarknochen sich drehten. Das war das Zerreißen.
- Alle bisherigen `animate_rig --spec mixamo`-Läufe (`rig-2`, `rig-3`, `rig-4`, `rig-b306a858`, jeweils mit `task.json`-Beleg `spec: mixamo, topology: biped`) lieferten in Wahrheit **nie** echte `mixamorig:`-Namen zurück, sondern Tripos interne `tripo::X_Limb_Y`/`bone_N`-Namen. `--spec mixamo` ist bei diesem Charakter-Typ nachweislich unzuverlässig.

**Fix (für Männlich und Weiblich wiederholt, neuer Pfad `.../chain-v3/` bzw. `.../chain-v2/`):**
1. Neu geriggt mit `--spec tripo` (Tripos zuverlässiges natives Format) statt `--spec mixamo`.
2. Direkt danach `tripo anim retarget` mit Tripos eigenen Presets (`preset:idle`, `preset:walk`, `preset:climb`, `--animate-in-place`) **gegen exakt dieses Rig** — GLB-Dump bestätigt: jetzt bekommen 100 % der Skin-Joints in allen 3 Clips Keyframes.
3. **Korrektur zu Eintrag 53, Punkt 2:** Die AI-Retargeting-Presets sind entgegen der damaligen Einschätzung *nicht* grundsätzlich unbrauchbar — visuell im Model-Viewer über mehrere Frames/Winkel geprüft (Idle/Walk/Climb), Gang und Haltung sehen für Männlich und Weiblich sauber aus. Das frühere "wilde Schlingern" war höchstwahrscheinlich derselbe Rig/Clip-Mismatch, nicht eine Eigenschaft der Presets selbst.

**Neu entdeckt: 64-Bone-GPU-Skinning-Limit:**
- Das native Tripo-Rig (`spec: tripo`) bringt weit mehr Knochen mit als der alte `mixamorig`-Export — beim Mann 66, bei der Frau **113** Skin-Joints. Die Engine hat ein hartes Shader-Limit `u_boneMatrices[64]` ([`Skeleton.ts`](src/core/animation/Skeleton.ts)) — alles ab Index 64 deformiert nicht.
- Recherche (offizielle Tripo-Doku + ein Community-Vergleichsartikel) bestätigt: **keine API-Option**, um Haare/Mantel vom Auto-Rigging auszunehmen oder die Bone-Zahl zu begrenzen. Die vielen anonymen `bone_N`-Knochen sind vermutlich genau die von Tripo intern erwähnten "dynamic spring bones" für Haar-/Mantel-Jiggle.
- **Lösung:** Lokales Post-Processing-Script (Node, GLB-Binärformat direkt geparst/umgeschrieben) entfernt alle nicht-`tripo::`-benannten Bones aus dem Skin und hängt ihre Vertex-Gewichte auf den nächsten benannten Vorfahren um (`inverseBindMatrices`, `JOINTS_0`/`WEIGHTS_0`, `skin.joints` entsprechend neu geschrieben; Node-Hierarchie und Animation-Channels bleiben unangetastet). Ergebnis: Mann 66→26, Frau 113→28 Skin-Joints — Mantel/Haare jetzt starr statt physikalisch simuliert, aber korrekt drapiert statt eingefroren-verzerrt. Visuell im Model-Viewer über Idle/Walk verifiziert (keine Nähte/Risse).

**Deployed:** `public/assets/and-now/mannequin/novotny-male.glb` und `novotny-female.glb` ersetzt. [`showcase.ts`](showcases/andNowScene2/showcase.ts) liest Animationen jetzt bevorzugt direkt aus dem geladenen Charakter-GLB (`preset:idle/walk/climb` → interne Keys `idle/walk/stairs`), externe Studio-Clip-Dateien sind nur noch Fallback.

**Offen / bewusst nicht verfolgt:** Die alten `extracted_male/female_0/1/2.jpg/png`-Dateien in `public/assets/and-now/mannequin/` (Normal-Maps fälschlich als Diffuse extrahiert, teils sichtbar korrumpiert) sind Reste eines abgebrochenen Extraktionsversuchs aus einer früheren Session und werden vom aktuellen Code nicht referenziert — nicht angefasst.

**Status:** 91 Testsuiten, 516 Tests, Build/Lint 100% grün.

## 55. Root-Cause-Fix #2: Skalierungs-Bug (StageMovementBehavior überschreibt 1.8er-Charaktergröße) (2026-08-28)

**Anlass:** User-Feedback nach Eintrag 54 anhand eines echten Live-Screenshots: Laterne "schwebt waagerecht", Arme wirken wie "Puppenhaltung", keine sichtbare Bewegung beim Laufen (nur Translation), Figur generell zu klein, am oberen Treppenende fast unsichtbar.

**Diagnose (via temporärem `window`-Debug-Hook auf die Showcase-Instanz, live im laufenden Dev-Server geprüft, nicht nur an Rohdaten):**
- `AnimationMixer`/Crossfade-Logik selbst funktioniert nachweislich korrekt (manuell `_updateAnimationFade` + `_mixer.update` Schritt für Schritt durchlaufen lassen: Bein-Quaternion oszilliert sichtbar über einen realistischen Gangzyklus; auch über echte Wallclock-Zeit im laufenden Loop bestätigt).
- **Der eigentliche Bug:** [`StageMovementBehavior.ts`](src/core/behaviors/StageMovementBehavior.ts) setzt in `_applyPlacement()` `obj.scale.set(s, s, s)` — den reinen Forced-Perspective-Zonenfaktor (0.5–1.0) — **direkt und ersetzend** auf das Zielobjekt. Da `_loadCharacter()` `this._novotny.scale.set(1.8, 1.8, 1.8)` genau auf dieses selbe Objekt gesetzt hatte, wurde die 1.8er-Basisskalierung schon beim allerersten Behavior-Update überschrieben (verifiziert: Live-Skalierung war `1.0` statt `1.8`, an der Treppen-Kuppe sogar nur `0.5`). Das erklärt alle vier gemeldeten Symptome auf einmal: Bei ~55%–28% der beabsichtigten Größe ist die Gang-Animation am winzigen Sprite kaum wahrnehmbar (wirkt wie eingefroren/"Puppe"), die Laterne sitzt zwar korrekt, ist aber bei der Mini-Darstellung kaum von "waagerecht schwebend" zu unterscheiden.
- **Fix:** Neuer Wrapper `_novotnyRig` (leeres `Object3D`) zwischen Szene und Charakter eingezogen. `StageMovementBehavior` wird jetzt auf `_novotnyRig` statt auf `_novotny` selbst angehängt (Positionierung + Zonen-Skalierung dort), während `_novotny` als Kind mit fixer lokaler Skalierung 1.8 unverändert bleibt — Weltskalierung ist jetzt `rig.scale * novotny.scale = s * 1.8`, korrekt multiplikativ statt ersetzend. `StageMovementBehavior` selbst (generische, wiederverwendbare Klasse) blieb unangetastet.
- Live verifiziert: Skalierung jetzt `1.8` in Zone A (vorher `1.0`), `0.9` an der Treppenkuppe (vorher `0.5`) — Figur sichtbar größer in beiden Screenshots, Laterne und Körperhaltung bei der neuen Größe eindeutig als korrekt hängend/natürlich erkennbar.

**Lektion:** Nur an Rohdaten (GLB-Dump, Model-Viewer) verifizieren reicht nicht — der eigentliche Bug lag in der Engine-Integration (Showcase-Code), nicht im Asset. Live-Debugging direkt an der laufenden Instanz (`window`-Hook) war hier der entscheidende Schritt, den ein isoliertes Tool wie `tripo view` nicht hätte aufdecken können.

**Status:** 91 Testsuiten, 516 Tests, Build/Lint 100% grün.

---

### 2. Etablierter Standard-Workflow für die nächste Session
1. **Mesh- & Textur-Generierung:**
   - Tripo3D ausschließlich für die **3D-Rekonstruktion von Geometrie und Texturatlas** verwenden (`tripo make --for game-mobile`).
2. **Skelett-Rigging & Skin-Weights:**
   - Rigging nicht über Tripo-Auto-Rigging, sondern über **Adobe Mixamo** oder ein sauberes **Blender Humanoid-Template**, um eine 100% konsistente 52-Joint `mixamorig:*`-Hierarchie zu garantieren.
3. **Animations-Bibliothek:**
   - Verbleib bei den kuratierten Studio-Mocap-Clips (`idle_torch.glb`, `standing_torch_walk_forward.glb`, `ascending_stairs.glb`), die die Hand stabil führen.
4. **Prop-Socket (Laterne):**
   - Bindung an die **linke Hand** (`mixamorig:LeftHand`).
   - Handflächen-Pivot mit $Z$-Rotation (`Math.PI / 2`), damit die Laterne senkrecht zum Boden hängt.
5. **Charakter-Austauschbarkeit:**
   - Identische Knochenbäume für Female & Male, sodass der Mesh-Body ein reiner Skin-Austausch via Taste `[C]` bleibt.

---
**Session-Abschluss:** Vollständig protokolliert, 90 Testsuiten mit 513 Tests grün.

## 56. GltfLoader PBR-Sanitizing Optionen (`clampMetallic`, `clampRoughness`, `defaultMetallic`, `defaultRoughness`) (2026-08-28)
- **Engine Feature ([`src/loaders/GltfLoader.ts`](src/loaders/GltfLoader.ts), [`src/interfaces/LoaderOptions.ts`](src/interfaces/LoaderOptions.ts)):**
  - Neues Interface `GltfLoaderOptions` eingeführt:
    - `clampMetallic`: Drosselt überhöhte Metallic-Werte (z. B. 1.0 von Tripo3D) auf einen Maximalwert oder Bereich `[min, max]`.
    - `clampRoughness`: Begrenzt Roughness auf einen Maximalwert oder Bereich `[min, max]`.
    - `defaultMetallic`: Konfigurierbarer Standardwert, wenn im glTF kein `metallicFactor` hinterlegt ist (Default: `1.0`).
    - `defaultRoughness`: Konfigurierbarer Standardwert, wenn im glTF kein `roughnessFactor` hinterlegt ist (Default: `1.0`).
- **Unit Tests ([`tests/loaders/GltfLoader.test.ts`](tests/loaders/GltfLoader.test.ts)):**
  - Umfassende Testsuite für Defaults, Upper-Bound Clamps und Range-Clamps hinzugefügt.
- **Status:** 91 Testsuiten mit 516 Tests und Library-Build 100% grün.

## 57. Session-Handover & Gesamt-Status (2026-08-28)

**Fokus:** Konsolidierung des Entwicklungsstands, Bereinigung verwaister Assets und vollständiges Briefing für Folge-Agenten.

### 1. Bereinigungsarbeiten dieser Session
- **`src/apps/and-now/raw/mannequin/`:**
  - Bereinigt: Verwaister Ordner `novotny-female-final.fbm/` restlos gelöscht.
  - Erhalten: Alle 4 `.fbx`-Animationsclips (`ascending_stairs.fbx`, `idle_1.fbx`, `idle_torch.fbx`, `standing_torch_walk_forward.fbx`).
  - Erhalten: Alle 7 *Space Girl* Konzept- und Model-Sheet-Bilder (`space-girl.png`, `space_girl_gamepad_action.jpg`, `space_girl_model_sheet.jpg`, `space_girl_standing_concept.jpg`, `space_girl_v2_gamepad.jpg`, `space_girl_v2_model_sheet.jpg`, `space_girl_v2_standing.jpg`).
- **`src/apps/and-now/docs/assets/`:**
  - Bereinigt: 9 ungenutzte Dateien gelöscht (`tunnel_entrance_flakturm_empty.webp` Duplikat + 8 unreferenzierte T-Pose Turnaround-Dateien `novotny_[female|male]_tpose_[front|back|right|left].jpg`).
  - Erhalten: Alle 9 im [`concept-dossier.html`](src/apps/and-now/docs/concept-dossier.html) aktiv referenzierten Grafiken.
- **Showcase-Übersicht (`public/index.html`):**
  - Direkter Link auf Szene 2 entfernt; nur der zentrale **And Now? (Hub)** (`src/apps/and-now/index.html`) ist gelistet.

### 2. Aktuelle Architektur- & Pipeline-Erkenntnisse (Wichtig für Weiterarbeit)
1. **Charakter-Skalierung:**
   - Niemals die Basis-Skalierung des Charakters (`1.8`) direkt auf dem Mesh überschreiben.
   - Immer den separaten `_novotnyRig` (`Object3D`) Wrapper verwenden, auf dem das `StageMovementBehavior` positioniert und zonen-skaliert.
2. **GPU Skinning 64-Bone Limit:**
   - WebGL2 Shader hat ein hartes Limit von 64 Bone-Matrizen (`Skeleton.ts`).
   - Tripo-Modelle müssen über das Post-Processing-Skript auf $\le 64$ Bones reduziert werden (Mantel/Haare an benachbarte Bones gehängt).
3. **Animations-Playback & Retargeting:**
   - In [`showcases/andNowScene2/showcase.ts`](showcases/andNowScene2/showcase.ts) werden eingebettete Animationen der GLB (`preset:idle`, `preset:walk`, `preset:climb`) bevorzugt.
   - Studio-Mixamo-Clips (`idle_torch.glb`, `standing_torch_walk_forward.glb`, `ascending_stairs.glb`) liegen unter `public/assets/and-now/mannequin/anim/` als Fallback.
   - [`AnimationMixer.ts`](src/core/animation/AnimationMixer.ts) normalisiert automatisch Präfixe (`mixamorig:`, `mixamorig1:`).
4. **PBR- & Textur-Pipeline:**
   - Tripo-PBR exportiert oft `metallic: 1.0`. [`GltfLoader`](src/loaders/GltfLoader.ts) drosselt diese via `clampMetallic` / `clampRoughness`.
   - In der 2.5D-Bühne sichert [`BasicMaterial`](src/core/materials/BasicMaterial.ts) mit übertragener DiffuseMap optimale Lesbarkeit ohne externe IBL/HDRI.
5. **Charakter-Socket (Laterne):**
   - Bindet an die linke Hand (`mixamorig:LeftHand` / `tripo::0_Left_Limb_2`), Rotation $Z = \pi / 2$, Position `(0.01, 0.09, 0.02)`.
   - Tastenkürzel `[C]` wechselt live zwischen Männlich und Weiblich.

### 3. Offene Punkte für die nächste Session / Kollegen
- **Space Girl Integration:** Die 7 Roh-Bilder in `src/apps/and-now/raw/mannequin/spacegirl/` stehen bereit für eine mögliche 3D-Generierung / alternatives Charaktermodell via `tripo make` oder die Character-Pipeline.
- **Scene 2 Ausbau:** Gameplay-Interaktionen (Türen, Schalter, Gegenstände untersuchen, Zonen-Übergang zu Szene 3 / Außenwelt).

**Status:** 91 Testsuiten mit 516 Tests 100% grün, Build und Linter sauber.

## 58. Asset-Reorganisation: Ordnerstruktur nach Figur statt nach Asset-Typ (2026-08-28)
- **Anlass:** Mit Spacegirl als drittem Charakter-Kandidaten (neben Novotny Male/Female) wurde die bisherige, rein typ-basierte Ablage (`raw/mannequin/`, `public/assets/and-now/mannequin/`, `docs/assets/`) unübersichtlich — Dateien verschiedener Figuren lagen flach nebeneinander.
- **Neue Struktur (`raw`, `runtime`, `docs` jeweils mit `novotny-male/`, `novotny-female/`, `spacegirl/`-Unterordnern; figurenübergreifend genutzte Mocap-Clips in einem `shared/`-Geschwisterordner):**
  - `public/assets/and-now/mannequin/{novotny-male,novotny-female}/character.glb`, `public/assets/and-now/mannequin/shared/anim/{idle_torch,walk_torch,ascending_stairs}.glb`.
  - `src/apps/and-now/raw/mannequin/spacegirl/` (7 Konzeptbilder, umbenannt ohne redundanten `space_girl_`-Präfix), `src/apps/and-now/raw/mannequin/shared/` (4 Mocap-`.fbx`), `novotny-male/` und `novotny-female/` aktuell leer (nur `.gitkeep`, keine Rohdaten mehr vorhanden).
  - `src/apps/and-now/docs/assets/{novotny-male,novotny-female}/hoodie*.jpg` (umbenannt ohne redundanten `novotny_hoodie_`-Präfix; alle nicht-figurenbezogenen Dossier-Bilder blieben unverändert direkt unter `docs/assets/`).
- **Namenskonvention:** Dateinamen wiederholen den Figurennamen nicht mehr, wenn der Ordner ihn schon trägt (z. B. `novotny-male/character.glb` statt `novotny-male/novotny-male.glb`) — konsistent mit der bestehenden [[Namespace Naming]]-Regel.
- **Nebenfund & Fix:** `showcase.ts` zeigte durch einen vorherigen, im Code nie nachgezogenen Rename bereits auf einen toten Fallback-Animationspfad (`mannequin/idle_torch.glb` statt `mannequin/anim/idle_torch.glb`). Im selben Zug korrekt auf die neuen `shared/anim/`-Pfade gesetzt.
- **Mitgezogen:** `showcase.ts`, `concept-dossier.html`, `novotny_tpose_reference_prompts.md`, `.agents/skills/character-pipeline/SKILL.md` (Konvention + Beispielpfade aktualisiert) und `REFERENCES.md`.

## 59. Fehlendes weibliches Model-Sheet via Gemini-Bildgenerierung nachgezogen (2026-08-28)
- **Anlass:** Für Novotny Male existierte ein gemaltes Turnaround-Model-Sheet (`hoodie_model_sheet.jpg`, Front/Profil/Rücken + 3 Ausrüstungs-Kopf-Insets), für Female fehlte das Pendant.
- **Kein eigenes Bildgenerierungs-Tool vorhanden** — stattdessen ad-hoc über die Gemini API angebunden: `GEMINI_API_KEY` war bereits als Umgebungsvariable gesetzt, genutztes Modell `gemini-3.1-flash-image` (multimodal, akzeptiert Referenzbilder — im Gegensatz zu reinem Imagen, das über den einfachen API-Key nur Text→Bild ohne Bildreferenz kann). Kleines Hilfsskript `.agents/scratches/gemini_image_gen.py` (Prompt-Datei + n Referenzbilder → generiertes Bild) für spätere Wiederverwendung liegen gelassen.
- **2 gescheiterte Composite-Versuche:** Ein einzelner Prompt für das komplette 6-Panel-Sheet (3 Ganzkörperansichten + 3 Kopf-Insets in einem Bild) produzierte beide Male eine kaputte/abgeschnittene Rückenansicht (nur Beine, kein Oberkörper) bzw. eine doppelte Seitenansicht — das Modell tut sich mit dieser Mehrfeld-Komposition strukturell schwer.
- **Fix:** Aufgeteilt in unabhängige Einzel-Generierungen (Front, Profil, Rücken je einzeln mit `novotny-female/hoodie.jpg` als Referenz, Rücken/Profil zusätzlich mit der bereits generierten Front-Ansicht als Zweitreferenz für Konsistenz) plus Wiederverwendung der bereits sauberen Kopf-Insets-Spalte aus dem zweiten Composite-Versuch. Lokal mit ImageMagick (`convert`/`+append`) zu einem finalen Sheet zusammengesetzt.
- **Bekannte Einschränkung:** Sichtbare, leicht unterschiedliche Papierton-Nähte zwischen den einzeln generierten Panels (jede Generierung hat eigene Hintergrund-Variation) — für ein Dossier-Referenzbild als ausreichend akzeptiert, nicht weiter geglättet.
- **Ergebnis:** `src/apps/and-now/docs/assets/novotny-female/hoodie_model_sheet.jpg`, verlinkt in `concept-dossier.html` als eigene Karte neben dem männlichen Pendant.

## 60. Weibliche Action-Grafik (hoodie_action.jpg) generiert & Dossier aktualisiert (2026-08-28)
- **Anlass:** Nach dem weiblichen Model-Sheet fehlte noch das Pendant zu [`novotny-male/hoodie_action.jpg`](src/apps/and-now/docs/assets/novotny-male/hoodie_action.jpg) (Dynamischer U-Bahn-Sprint).
- **Generierung:**
  - Multimodale Bildgenerierung (`generate_image`) unter Verwendung von [`novotny-female/hoodie.jpg`](src/apps/and-now/docs/assets/novotny-female/hoodie.jpg) (Charakter-Likeness & Outfit) und [`novotny-male/hoodie_action.jpg`](src/apps/and-now/docs/assets/novotny-male/hoodie_action.jpg) (Tunnel-Setting, Perspektive, Sprint-Dynamik, Laterne, wehender Trenchcoat).
  - Volle Einhaltung des Graphic-Noir-Stils: Getuschte Konturen, Schraffuren, Chiaroscuro-Laternenlicht und kühler Wiener U-Bahn-Schacht 2100.
- **Ergebnis:**
  - Asset abgelegt unter [`src/apps/and-now/docs/assets/novotny-female/hoodie_action.jpg`](src/apps/and-now/docs/assets/novotny-female/hoodie_action.jpg).
  - Eingebunden als dedizierte Konzept-Karte in [`concept-dossier.html`](src/apps/and-now/docs/concept-dossier.html).

## 61. Lore-Präzisierung: Creator Echoes (Österreichische Hausberge & Wahlheimat Saarland) (2026-08-28)
- **Anlass:** Biografische Präzisierung der realen Anker von Creator Stefan in [`creator-echoes.md`](src/apps/and-now/docs/creator-echoes.md).
- **Korrekturen & Erweiterungen:**
  - *Herkunft:* Ursprünglich aus Österreich, aufgewachsen in der Region der Wiener Hausberge (Rax, Schneeberg, Semmering) — der alpinen Quelle der 1. Wiener Hochquellenwasserleitung.
  - *Wahlheimat:* Lebt seit 6 Jahren gemeinsam mit seiner Frau im Saarland.
  - *Neues Echo #8 („Die Wiege des Wassers“):* Verankert Stefans Berg-Herkunft als narrativen Brückenschlag zum potenziellen DLC 2 (*„Der Weiße Quell“* / Hochquellenwasserleitung-Highway) mit einem verlassenen Quellwärter-Häuschen und Tourenbuch von „S.R.“.
  - *Echo #3 geschärft:* Der Saarländer Einsiedler im U-Bahn-Netz als Bote aus Stefans ferner Wahlheimat.
- **Status:** Vollständig in [`creator-echoes.md`](src/apps/and-now/docs/creator-echoes.md) eingepflegt.

## 62. Konsolidierung & Vereinheitlichung der Szenen-Architektur (2026-08-28)
- **Anlass:** Szene 1 lag unter `src/apps/and-now/scenes/prologue/`, während Szene 2 noch isoliert im allgemeinen Showcase-Ordner unter `showcases/andNowScene2/` verblieben war.
- **Konsolidierung:**
  - `showcases/andNowScene2/` vollständig nach [`src/apps/and-now/scenes/flakturm-tunnel/`](src/apps/and-now/scenes/flakturm-tunnel/) migriert.
  - Altes Verzeichnis `showcases/andNowScene2/` restlos bereinigt.
  - Import-Pfade in [`showcase.ts`](src/apps/and-now/scenes/flakturm-tunnel/showcase.ts) und Zurück-Link in [`index.html`](src/apps/and-now/scenes/flakturm-tunnel/index.html) aktualisiert.
  - Build-Routing in [`vite.config.ts`](vite.config.ts) und Szene-2-Link im App-Hub [`src/apps/and-now/index.html`](src/apps/and-now/index.html) auf den neuen einheitlichen Pfad umgestellt.
- **Ergebnis:** Alle Szenen von „And Now?“ liegen nun konsistent und modular unter `src/apps/and-now/scenes/` (`prologue/` und `flakturm-tunnel/`).

## 63. Kanonische Charakter-Ausrüstung & Gürtel-System (2026-08-28)
- **Anatomie & Ausrüstungs-Standard:**
  1. **Laterne (Linke Hand):**
     - Die Laterne wird immer in der **linken Hand** getragen (`mixamorig:LeftHand`), Handflächen-Socket mit $Z = \pi/2$ Rotation. Die rechte Hand bleibt frei.
  2. **Zwei-Gürtel-System:**
     - *Gürtel 1 (Hosen- & Utility-Gürtel):* Hält die Hose, Taschen und die Schutzmaske.
     - *Gürtel 2 (Waffengürtel):* Trägt den Holster für eine kleinkalibrige Pistole.
     - *Holster-Position:* Immer **vorne links** am Gürtel befestigt (Cross-Draw Zugriff).
  3. **Vollgesichtsschutzmaske (Dual-Filter Respirator):**
     - Vollmaske mit zwei seitlichen Filterdosen (links und rechts an den Wangen).
     - *Trageposition am Gürtel:* Hängt immer **vorne rechts** am Ausrüstungsgürtel.
     - *Zustände:* Kann am Gürtel getragen (State 1: BASE) oder aktiv auf das Gesicht aufgesetzt werden (State 2: HAZARD).
- **Integration:** Festgehalten in [`.agents/skills/character-pipeline/SKILL.md`](.agents/skills/character-pipeline/SKILL.md) und [`docs/adr/0009-character-pipeline-and-mixamo-rigging-standard.md`](docs/adr/0009-character-pipeline-and-mixamo-rigging-standard.md).

## 64. Harmonisierung der „Adam & Eva“ Ur-Bilder (hoodie.jpg M & W) (2026-08-28)
- **Kanonische Ur-Bilder re-generiert & synchronisiert:**
  - [`novotny-male/hoodie.jpg`](src/apps/and-now/docs/assets/novotny-male/hoodie.jpg) („Adam“) und [`novotny-female/hoodie.jpg`](src/apps/and-now/docs/assets/novotny-female/hoodie.jpg) („Eva“) als absolute Vorlagen und Referenzanker harmonisiert.
- **Exakt aufeinander abgestimmte Merkmale:**
  1. **Laterne (Linke Hand):** Beide halten die Kerosin-Sturmlaterne in der linken Hand (Viewer-Perspektive: rechts im Bild); die rechte Hand bleibt frei.
  2. **Zwei-Gürtel-System & Sockets:** Holster vorne links (Cross-Draw), Dual-Filter Gasmaske vorne rechts am Ausrüstungsgürtel.
  3. **Kleidung & Details:**
     - Weiblich: Hoodie mit 2 sichtbaren Känguru-Bauchtaschen, Reißverschluss und Kordeln unter dem Loden-Trenchcoat.
     - Männlich: Authentischer Schacht-Trenchcoat über dem Hoodie mit dickem Woll-Schal.
     - Beide: Kapuze aufgesetzt, Gesicht und Blick frei (keine Maske, kein Staubschutz-Tuch über Mund/Nase).
  4. **Atmosphäre:** Wiener U-Bahn / Flakturm Schächte mit feuchtem Beton, Pfützen-Reflexionen und Ratten auf dem Boden.
- **Status:** In [`concept-dossier.html`](src/apps/and-now/docs/concept-dossier.html) integriert.

## 65. Albedo 3-View Model-Sheets für Adam & Eva (model_sheet.jpg M & W) (2026-08-28)
- **Turnaround-Generierung:**
  - Reine, schattenfreie Albedo 3-View Model-Sheets auf `#FFFFFF` weißem Hintergrund für beide Charaktere generiert.
  - Einhaltung der CAD-Orthografie: Front (45° A-Pose, parallele Füße), Profil Rechts (90°, Arme entspannt herabhängend), Rücken (45° A-Pose).
  - Ausrüstung & Kleidung: Zwei-Gürtel-System (Gasmaske vorne rechts, Holster vorne links), Kapuze aufgesetzt, Gesicht frei, Känguru-Hoodie (weiblich) bzw. Zip-Hoodie (männlich).
- **Ablage unter einheitlichem Namen `model_sheet.jpg`:**
  - Männlich: [`docs/assets/novotny-male/model_sheet.jpg`](src/apps/and-now/docs/assets/novotny-male/model_sheet.jpg) und [`raw/mannequin/novotny-male/model_sheet.jpg`](src/apps/and-now/raw/mannequin/novotny-male/model_sheet.jpg).
  - Weiblich: [`docs/assets/novotny-female/model_sheet.jpg`](src/apps/and-now/docs/assets/novotny-female/model_sheet.jpg) und [`raw/mannequin/novotny-female/model_sheet.jpg`](src/apps/and-now/raw/mannequin/novotny-female/model_sheet.jpg).
  - Alte `hoodie_model_sheet.jpg` restlos gelöscht.
- **Dossier:** [`concept-dossier.html`](src/apps/and-now/docs/concept-dossier.html) aktualisiert.

## 66. Tripo3D Geometrie- & Texturatlas-Generierung für Adam & Eva (2026-08-28)
- **3D-Rekonstruktion via Tripo3D CLI (`tripo make --for game-mobile --param face_limit=15000`):**
  - **Männlicher Novotny („Adam“):**
    - Mesh & PBR-Texturatlas erzeugt: [`raw/mannequin/novotny-male/base_model.glb`](src/apps/and-now/raw/mannequin/novotny-male/base_model.glb) (1.7 MB) & `base_model.fbx` (2.4 MB).
  - **Weibliche Novotny („Eva“):**
    - Mesh & PBR-Texturatlas erzeugt: [`raw/mannequin/novotny-female/base_model.glb`](src/apps/and-now/raw/mannequin/novotny-female/base_model.glb) (1.6 MB) & `base_model.fbx` (2.0 MB).
- **Bereitstellung für Schritt 3 (Mixamo Rigging):**
  - Beide ungeriggten Basismodelle liegen in `src/apps/and-now/raw/mannequin/` bereit für den Upload in Adobe Mixamo Web.

## 67. Pipeline-Optimierung: Isolierte Front-View & Automatisches Mixamo-Zip-Packaging (2026-08-29)
- **Erkenntnisse & Fehlerbehebungen:**
  1. *Tripo Einzelbild-Mandat (`front.jpg`):* Tripo3D's Einzelbild-KI benötigt zwingend eine isolierte Frontalansicht in 45° A-Pose auf reinweißem Grund (`#FFFFFF`). Zusammengesetzte 3-View Sheets führten zu Multi-Body-Halluzinationen und zerrissenen UV-Maps.
  2. *Mixamo Ingestion-Fix (`<char>_mixamo.zip`):* Tripo FBX-Exporte enthalten Root-Knoten-Hierarchien, die Mixamo fälschlicherweise als unvollständiges Skelett interpretiert (*„unable to map your existing skeleton“*). GLB wird von Mixamo Web nicht unterstützt.
- **Etablierter Standard:**
  - Der Agent exportiert `base_model.glb` automatisch in ein sauberes statisches Wavefront OBJ (`model.obj` + `model.mtl` + `texture.jpg`) und packt es als `<char>_mixamo.zip`.
  - Mixamo lädt das Zip-Paket mit voller Textur und startet zuverlässig den 5-Punkte-Auto-Rigger.
- **Skill- & ADR-Update:** [`.agents/skills/character-pipeline/SKILL.md`](.agents/skills/character-pipeline/SKILL.md) und [`docs/adr/0009-character-pipeline-and-mixamo-rigging-standard.md`](docs/adr/0009-character-pipeline-and-mixamo-rigging-standard.md) aktualisiert.

## 68. Mixamo Ground-Plane Normalisierung ($Y=0.00$) (2026-08-29)
- **Fehlerursache (`../../../../img.png`):** Tripo zentrierte das generierte Mesh symmetrisch um den Ursprung ($Y \in [-0.5, +0.5]$). Da Mixamos Bodenebene bei $Y=0.00$ liegt, steckte die Hüfte bei $Y=0$ und alle Beine/Stiefel lagen unter dem Mixamo-Boden.
- **Lösung:** Automatische Vertex-Translation im OBJ-Exporter:
  - $y' = (y - minY) \times \text{scale}$ (Fußsohlen exakt auf $Y = 0.00$).
  - Skalierung auf $1.80\text{m}$ Normalhöhe und $X/Z$-Zentrierung.
- **Ergebnis:** [`novotny_male_mixamo.zip`](src/apps/and-now/raw/mannequin/novotny-male/novotny_male_mixamo.zip) und [`novotny_female_mixamo.zip`](src/apps/and-now/raw/mannequin/novotny-female/novotny_female_mixamo.zip) neu gepackt; Figuren stehen vollständig und aufrecht auf der Mixamo-Gitterebene.

## 69. FBX ➔ GLB Konvertierung & Runtime-Deployment von Adam & Eva (2026-08-29)
- **Mixamo Skelett-Integration:**
  - `character_rigged.fbx` für Mann und Frau via `fbx2gltf` nach Binary glTF (`character.glb`) konvertiert.
  - **Skelett-Validierung:**
    - Mann: 40 Gelenke (`mixamorig:*`), inklusive voller Hand- und Fingerknochen.
    - Frau: 28 Gelenke (`mixamorig:*`), saubere Biped-Hierarchie.
    - Beide liegen sicher unter dem 64-Bone WebGL2 Shader-Limit.
- **Runtime-Deployment:**
  - [`public/assets/and-now/mannequin/novotny-male/character.glb`](public/assets/and-now/mannequin/novotny-male/character.glb) (1.6 MB)
  - [`public/assets/and-now/mannequin/novotny-female/character.glb`](public/assets/and-now/mannequin/novotny-female/character.glb) (1.6 MB)
- **Status:** Beide Charaktere sind sofort spielbar in allen Szenen (`flakturm-tunnel` & `prologue`), mit funktionierendem Laternen-Socket (`mixamorig:LeftHand`) und fließendem Animation-Crossfading.

## 70. High-Fidelity Textur- & Material-Strategie integriert (2026-08-29)
- **4 Profi-Säulen im Skill ([`SKILL.md`](.agents/skills/character-pipeline/SKILL.md)) verankert:**
  1. *Entkopplung von Rig und Textur:* Mixamo dient ausschließlich als Armature/Weight-Calculator; unkomprimierte 2K-Originaltexturen werden direkt in die finale `character.glb` re-injiziert.
  2. *PBR- & Graphic-Noir Härtung:* `clampMetallic: 0.2`, `clampRoughness: [0.3, 1.0]` schützt vor überhöhten Glanzwerten.
  3. *Anisotropie & Mipmapping:* 16x Anisotropie eliminiert Weichzeichnungs-Artefakte bei schrägen Kamerawinkeln.
  4. *Transparenz- & Farbraum-Schutz:* `alphaMode = "OPAQUE"` verhindert den Mixamo-Glas-Bug; Normal-Maps als Non-Color Data geladen.

## 71. Behebung: Skalierungs-Fix ($1.8\text{cm} \rightarrow 1.80\text{m}$) & Senkrechte Laternen-Ausrichtung (2026-08-29)
- **Fehlerursachen & Lösungen:**
  1. *Figur unsichtbar:* `fbx2gltf` skalierte den FBX-Export standardmäßig mit $0.01$ (cm nach m), wodurch die Figur nach dem Import nur $0.018\text{m}$ (1.8 cm) groß war und unter dem Laternen-Mesh verschwand. Zudem blockierte ein statischer 1-Frame-Dummy-Clip (`mixamo.com`) das Laden der Shared Studio-Clips.
     - *Fix:* GLB-Rootnode auf $1.0\text{m}$ Netto-Höhe normalisiert (`Node 0` skaliert), Dummy-Animation entfernt und Fallback-Animation-Loader gehärtet.
  2. *Laterne waagerecht:* In der Szene war noch eine starre 90°-Drehung aktiv, die für das alte T-Pose-Rig gedacht war.
     - *Fix:* Ausrichtung im Hand-Socket auf `(0, 0, 0)` und Offset auf `(0.01, 0.06, 0.02)` korrigiert; Laterne hängt nun kerzengerade nach unten.

## 72. Renderer-Konfiguration auf BEST umgestellt (2026-08-29)
- **Umstellung:** [`src/apps/and-now/scenes/flakturm-tunnel/showcase.ts`](src/apps/and-now/scenes/flakturm-tunnel/showcase.ts) nutzt nun standardmäßig `rendererType: RendererType.BEST` (wählt automatisch WebGPU, sofern vom Browser unterstützt, mit automatischem WebGL2-Fallback).

## 73. Nomenklatur-Refactoring „Player / Spieler“ & GltfLoader-Entkopplung (2026-08-29)
- **Nomenklatur-Refactoring:**
  - Alle Asset-Pfade von `novotny-male`/`novotny-female` nach [`player-male`](public/assets/and-now/mannequin/player-male/) und [`player-female`](public/assets/and-now/mannequin/player-female/) migriert.
  - In Code und UI einheitlich als `Player` bzw. auf Deutsch als `Spieler` / `Spielerin` benannt.
- **Engine-Entkopplung (GltfLoader):**
  - Hardcodierte Mixamo-Präfix-Ersetzungen (`_MIXAMO_RIG_PREFIX_RE`) restlos aus dem Core-`GltfLoader` entfernt.
  - Generischer `nodeNameTransform?: (name: string) => string` Hook in [`GltfLoaderOptions`](src/interfaces/LoaderOptions.ts) eingeführt; der glTF-Loader bleibt 100% standardkonform und agnostisch gegenüber App-spezifischen Rig-Nomenklaturen.

## 74. Optionale Mixamo-Rig-Normalisierung per Schalter (`normalizeMixamoRig`) (2026-08-29)
- **Komfort-Option:** [`GltfLoaderOptions`](src/interfaces/LoaderOptions.ts) bietet nun den optionalen Schalter `normalizeMixamoRig?: boolean` (Default `false`).
- **Verhalten:** Wenn aktiviert, werden numerische Mixamo-Präfixe (`mixamorig1:`, `mixamorig2:`) automatisch auf das Standard-Präfix `mixamorig:` gemappt, ohne dass die glTF-Spezifikation für andere Modelle kompromittiert wird.

## 75. Erweiterung: Generische glTF-Lifecycle-Hooks (`onNodeParsed`, `onMaterialParsed`, `onParsed`) (2026-08-29)
- **Hook-Architektur:** [`GltfLoaderOptions`](src/interfaces/LoaderOptions.ts) um Lifecycle-Hooks erweitert:
  - `onNodeParsed?: (object: Object3D, rawDef: Record<string, unknown>) => void`
  - `onMaterialParsed?: (material: StandardMaterial, rawDef: Record<string, unknown>) => void`
  - `onParsed?: (root: Object3D) => void`
- **Vorteil:** Ermöglicht beliebige Post-Processing-Pipelines (Shading-Härtung, Shader-Tausch, Bone-Mapping, Custom Properties) in Anwendungs-Code, ohne den Core-Loader zu verändern.

## 76. Mocap-Animations-Pool (10 Clips) & Dynamische State-Machine aktiviert (2026-08-29)
- **Asset-Pipeline:**
  - Alle 10 Mixamo-Animationsdateien (`idle_1`, `idle_2`, `idle_torch`, `walking`, `walking_torch`, `running_1`, `running_2`, `running_torch`, `ascending_stairs`, `descending_stairs`) via `fbx2gltf` in optimierte Binary-GLBs (`20–87 KB`) konvertiert und unter [`public/assets/and-now/mannequin/shared/anim/`](public/assets/and-now/mannequin/shared/anim/) bereitgestellt.
- **Engine-Locomotion ([`StageMovementBehavior.ts`](src/core/behaviors/StageMovementBehavior.ts)):**
  - Neuer Zustand `"RUN"` und `runMultiplier: 2.2` integriert (aktiviert via `ShiftLeft` / `ShiftRight`).
- **Showcase State-Machine ([`showcase.ts`](src/apps/and-now/scenes/flakturm-tunnel/showcase.ts)):**
  - *Idle:* Automatisches Überblenden zwischen `idle_1` und `idle_2` nach zufälligen Pausen bei ausgeschalteter Laterne; bei aktiver Laterne sofortiger Wechsel zu `idle_torch`.
  - *Locomotion:* Dynamische Umschaltung zwischen `walk`/`run_1` (neutral) und `walk_torch`/`run_torch` (Laterne an).
  - *Treppen:* Richtungsabhängige Erkennung in Zone C (`stairs_up` beim Hinaufsteigen, `stairs_down` beim Hinuntersteigen).

## 77. Yoshi Easter-Egg Charakter integriert & geriggt (2026-08-29)
- **Asset & Pipeline:**
  - 3D-Modell aus `yoshi.zip` (Sketchfab/Nintendo CC-BY) aufbereitet, zentriert und als [`yoshi_mixamo.zip`](src/apps/and-now/raw/mannequin/yoshi/yoshi_mixamo.zip) für Mixamo Auto-Rigging exportiert.
  - Geriggtes `character_rigged.fbx` via `fbx2gltf` nach [`public/assets/and-now/mannequin/yoshi/character.glb`](public/assets/and-now/mannequin/yoshi/character.glb) (34 Bones, 246 KB) konvertiert und skalierungsnormalisiert.
- **Gameplay-Integration ([`showcase.ts`](src/apps/and-now/scenes/flakturm-tunnel/showcase.ts)):**
## 78. WebGPU GPU-Vertex-Skinning implementiert & Live-Debug-Tag (2026-08-29)
- **Problem-Analyse:**
  - `WebGPURenderer` unterstützte bislang kein GPU-Vertex-Skinning — `SkinnedMesh`-Modelle blieben in WebGPU starr in ihrer Bind-Pose (T-Pose), während der `AnimationMixer` auf der CPU lief.
- **Engine Feature (WebGPU GPU Skinning):**
  - **WGSL Structs & Binding ([`structs.wgsl`](src/core/renderers/shaders/source/web_gpu/chunks/structs.wgsl), [`StandardWebGPULayout.ts`](src/core/renderers/shaders/StandardWebGPULayout.ts)):**
    - `@group(0) @binding(15) var<storage, read> boneMatrices: array<mat4x4f>` für globale Knochenmatrizen eingeführt.
    - `isSkinned` und `boneOffset` zu `ObjectUniforms` hinzugefügt.
  - **WGSL Vertex Shader ([`base.vert.wgsl`](src/core/renderers/shaders/source/web_gpu/base.vert.wgsl)):**
    - `@location(4) joints: vec4f` und `@location(5) weights: vec4f` deklariert.
    - Bei `isSkinned > 0.5`: Gewichtete Knochentransformation auf `pos`, `normal` und `tangent` im Vertex-Shader.
  - **WebGPURenderer Integration ([`WebGPURenderer.ts`](src/renderers/WebGPU/WebGPURenderer.ts)):**
    - `_boneMatricesBuffer` (Storage Buffer für bis zu 2048 Knochenmatrizen) initialisiert.
    - `_getBoneMatrixOffset()` lädt `skeleton.boneMatrices` dynamisch hoch und cached Offsets pro Frame.
    - `_getGeoCache()` erstellt `jb` (Joints) und `wb` (Weights) GPU-Vertex-Buffers.
    - Dummy-Buffer `_dummyJointsBuffer` und `_dummyWeightsBuffer` für statische Meshes verdrahtet.
## 79. Standard-Startausrichtung auf $-Z$ (Tunnel-Tiefe) festgelegt (2026-08-29)
- **Konfiguration & Koordination:**
  - `startFacing: "back"` als Standard für den Szenenstart und Charakterwechsel definiert.
## 80. Neues Szenario: Character Diorama Studio mit Matrix-Glitch-Kanten (2026-08-29)
- **Szene & Konzeption ([`src/apps/and-now/scenes/character-diorama/`](src/apps/and-now/scenes/character-diorama/)):**
  - Neues interaktives 3D-Diorama zur Figuren- und Animationspräsentation erstellt.
  - Schräge 3/4-Kamera mit Orbit-Inspektion (`OrbitController`), Key-Spotlight, Ambient-Licht und Neon-Rim-Light.
- **Matrix-Glitch-Auflösung (Custom WGSL-Shader):**
  - Eigener Vertex- und Fragment-Shader für Backsteinmauern und Pflastersteinboden:
  - Bei Annäherung an die Außenränder: Digitaler Vertex-Jitter, neon-cyan/magenta Chromatic Splitting, pulsierende Matrix-Scanlines und Noise-basierte Auflösung/Disintegration ins Nichts.
  - Umschaltbare Glitch-Intensität (`[G]`-Taste: Aus, Normal, Cyberpunk Overdrive).
## 81. Kanonisches Diorama-Konzeptbild ins Gesamtkonzept integriert (2026-08-30)
- **Visuelles Konzept & Asset-Stand ([`public/assets/and-now/diorama-concept.jpg`](public/assets/and-now/diorama-concept.jpg)):**
  - Finales Graphic-Noir-Artwork der Wiener Kanalisation als verbindliche Produktions-Referenz für das 3D Character Diorama Studio verankert (ohne Versionsnummern im Asset-Namen).
  - Charakteristische Merkmale:
    - Bogenförmig gewölbte, gestufte Mauerstirnseiten mit sichtbarer Ziegel-Stärke und Mörtelfugen.
    - Mehrschichtiges, tiefes Fundament (Pflaster, Schotter, Ziegelbett) mit herausragenden Rohrenden an der Bruchkante.
    - Abplatzende weiße 20×20 cm Fliesen mit Art-Déco-Bordüre über altem rotem Backsteinmauerwerk.
## 82. Phase 1 Diorama-Geometrie: 3D-Bruchkanten, Gewölbebögen & Fundament (2026-08-30)
- **3D-Bühnengeometrie implementiert ([`showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)):**
  - **3D-Fundamentplatte (`_buildFoundationPlatform`):**
    - Oberflächen-Pflaster mit massivem 0.35m tiefem Beton- und Schotterkern.
    - Freiliegende Ziegelschichten und gestufte Mauerblöcke entlang der vorderen Schnittkanten (+X und +Z).
  - **Gewölbte Backsteinmauern (`_buildVaultedWalls`):**
    - 0.22m dicke Ziegel-Wandstärken (Casing) hinter beiden Mauerflügeln.
    - Stufenförmig gewölbter Bogenverlauf entlang der Maueroberkante (von 3.6m im Eck organisch abfallend auf 1.9m am Rand).
  - **Herausgerissene Bruchkanten-Elemente (`_buildCutawayStubs`):**
    - Deformierte Entwässerungs- und Gussrohrstümpfe am Boden und an den Wandschnittflächen.
    - Lose herabhängende schwarze Kabelstränge / Drahtbündel an beiden Seiten.
  - **Rohrsystem & Ratten-Duo:**
    - Verbundenes horizontales Kupferrohr um die 90°-Ecke mit Eck-Bogen (`Torus`), Wandflanschen und rotem Handrad-Ventil.
    - Zwei animierte Ratten (Ecke bei Kisten + an der rechten Wandkante).
- **Status:** 93 Testsuiten, 536 Tests, Build/Lint 100% grün.

## 83. Ölfass-PBR-Texturierung im Character Diorama Studio (2026-08-30)
- **Asset-Generierung & Integration ([`public/assets/and-now/diorama/barrel_rust.jpg`](public/assets/and-now/diorama/barrel_rust.jpg)):**
  - Textur für das Industrie-Ölfass im Graphic-Noir-Stil generiert (1024×1024, verwittertes Stahlblech mit Rippen, abblätternder Lackierung, Rostfraß und dunklen Ölschlieren).
- **Showcase-Anbindung ([`showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)):**
  - `_barrelTexture` asynchron in `setupScene` geladen und dem `MetalBarrel` via `StandardMaterial` (`metallic: 0.65`, `roughness: 0.55`) zugewiesen.
- **Status:** 93 Testsuiten, 536 Tests, Build/Lint 100% grün.

## 84. Holzkisten-Cluster & PBR-Texturierung im Diorama (2026-08-30)
- **Asset-Generierung ([`public/assets/and-now/diorama/crate_wood.jpg`](public/assets/and-now/diorama/crate_wood.jpg)):**
  - Textur für alte Transport-Holzkisten generiert (1024×1024, verwitterte Holzbohlen mit diagonaler Kreuzverstrebung, rostigen Eisen-Eckbeschlägen, Nägeln und Moos-/Schmutzspuren im Graphic-Noir-Stil).
- **Szenen-Integration & Props ([`showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)):**
  - Kisten von 2 auf 6 Stück erweitert und als organischer Stapel/Cluster im Eck- und Wandbereich arrangiert (3 Basiskisten, 2 mittlere Kisten, 1 Turmspitze mit individuellen Rotationen).
  - Materialanbindung mit `_crateTexture` (`roughness: 0.85`, `metallic: 0.08`).
- **Status:** 93 Testsuiten, 536 Tests, Build/Lint 100% grün.

## 85. Pflasterstein-Bodenrelief mit Normal- & Roughness-Maps (2026-08-30)
- **PBR-Karten generiert ([`public/assets/and-now/diorama/`](public/assets/and-now/diorama/)):**
  - [`floor_pavement_normal.jpg`](public/assets/and-now/diorama/floor_pavement_normal.jpg): Tangent-Space Normal Map für tiefe Fugen zwischen Pflastersteinen, abgerundete Steinbuckel und markante Rissflanken in den Betonplatten.
  - [`floor_pavement_roughness.jpg`](public/assets/and-now/diorama/floor_pavement_roughness.jpg): Differenzierte Rauheitskarte (matter, abgetretener Stein `0.85–0.95`, nicht-reflektierende tiefe Fugen und sanfter Glanz nur in Pfützen-/Ölflecken).
- **Showcase-Material ([`showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)):**
  - Spiegelglanz entfernt: `metallic: 0.02`, `roughness: 0.92`, `normalScale: Vector2D(2.0, 2.0)` mit dynamischem Halogen- und Taschenlampen-Relief.
- **Status:** 93 Testsuiten, 536 Tests, Build/Lint 100% grün.

## 86. Graphic-Noir-Stilisierung & Rillen-Relief für Ölfass & Holzkisten (2026-08-30)
- **Art-Style-Angleichung (Graphic Noir Comic Inking):**
  - [`barrel_rust.jpg`](public/assets/and-now/diorama/barrel_rust.jpg): Stilisiertes Ölfass mit 2 charakteristischen horizontalen Wulst-Bändern (oben und unten) mit jeweils 3 stark erhobenen Wellblech-Rillen, dunklen Tusche-Schraffuren, Farbabplatzern und tiefen Ölschlieren.
  - [`crate_wood.jpg`](public/assets/and-now/diorama/crate_wood.jpg): Holzkisten mit markanten Comic-Tuschekonturen, Vintage-Stempeln (*„G. NOIR SHIPP. CO. CRATE 104“*), Kreuzverstrebungen und genieteten Eckwinkeln.
- **PBR-Tiefenkarten generiert ([`public/assets/and-now/diorama/`](public/assets/and-now/diorama/)):**
  - `barrel_rust_normal.jpg` & `barrel_rust_roughness.jpg`: Tangent-Space Normal Map für die 2x3 Rippenwülste mit intensiver Lichtbrechung (`normalScale: Vector2D(2.5, 2.5)`) und differenzierter Rauheit.
  - `crate_wood_normal.jpg` & `crate_wood_roughness.jpg`: Plastische Bohlen- und Beschlagskanten für alle 6 Holzkisten.
- **Showcase-Geometrie ([`showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)):**
  - Zylinder-Unterteilung des Fasses auf 32 Segmente verfeinert für perfekten Rundungsverlauf der Rillen.
- **Status:** 93 Testsuiten, 536 Tests, Build/Lint 100% grün.

## 87. 3D-Schutthaufen-Relief & versunkene Kisten-Komposition (2026-08-30)
- **3D-Müllberg-Geometrie ([`showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)):**
  - Neues zerklüftetes Polygon-Mesh `_buildDebrisMoundGeometry()` im Mauereck mit naturnahem Schuttkegel (Höhe bis 0.44m) und Facetten-Normalen.
  - Texturiert mit neu generierter Graphic-Noir-PBR-Textur [`debris_pile.jpg`](public/assets/and-now/diorama/debris_pile.jpg) (Ziegelschutt, Art-Déco-Fliesenscherben, Öldosen, Geröll) sowie Normal- und Roughness-Maps.
- **Kisten-Arrangement & Interaktion:**
  - Kisten 1 und 2 sind realistisch geneigt und teilweise im Schuttkörper versunken/eingegraben.
  - Kisten 4 und 6 ragen als gestapelter Turm aus dem Schutt hervor; Kisten 3 und 5 stehen frei auf dem Pflasterboden.
  - Ratte 1 sitzt naturnah auf der unteren Schuttflanke.
- **Status:** 93 Testsuiten, 536 Tests, Build/Lint 100% grün.

## 88. Korrekturen: Laternen-Griff, matter Charakter-Look & 3D Orbit-Kamera (2026-08-30)
- **Laternen-Befestigung ([`showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)):**
  - Bone-Auflösung auf Finger-/Handknöchel (`LeftHandMiddle1` / `LeftHandIndex1`) priorisiert, sodass die Laterne exakt in den gekrümmten Fingern der Handinnenfläche sitzt und nicht mehr seitlich am Handgelenk in der Luft schwebt.
- **Matter Charakter-Look ("Speckschwarte"-Fix):**
  - Material-Traversal für den geladenen GLTF-Charakter implementiert: `roughness: 0.92`, `metallic: 0.02` und Entfernung unkalibrierter Glanz-Maps für natürlich wirkende, staubige Bunker-Kleidung und Haut ohne scharfen Plastik-/Latex-Spiegelglanz.
- **3D Orbit-Steuerung mit linker Maustaste / Mac Touchpad:**
  - Kamera-Strategie explizit auf `CameraStrategyType.HYBRID_SYNC` geschaltet (zuvor blockierte die Standard-Strategie die sphärische Maus-Deltarotation).
  - NaN-Guard für `e.movementX`/`e.movementY` in [`Input.ts`](src/core/Input.ts) für Mac-Trackpads und Safari hinzugefügt.
- **Status:** 93 Testsuiten, 536 Tests, Build/Lint 100% grün.

## 89. Industrielle Bunker-Wandleuchte (Tripo3D 3D-Mesh & PBR-Integration) (2026-08-30)
- **Tripo3D Asset-Pipeline ([`public/assets/and-now/diorama/wall_lamp.glb`](public/assets/and-now/diorama/wall_lamp.glb)):**
  - Isolierte 2D-Konzeptvorlage für eine authentische Schiffsarmatur / Bunker-Ovalleuchte mit Gusseisengehäuse, Sechskantschrauben-Flansch, geripptem Glasdom, Halogenglühfaden und geschwungenem Draht-Schutzkäfig generiert.
  - Via `tripo make` in ein optimiertes Low-Poly Game-Asset (`wall_lamp.glb`, 1.2MB, PBR-Material mit Normal- und Roughness-Maps) umgewandelt.
- **Showcase-Integration ([`showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)):**
  - Prozedurale Baustellen-Gelblampen durch die neuen Tripo3D-Industrieleuchten an linker Wand (`IndustrialWallLamp_Left`) und Rückwand (`IndustrialWallLamp_Back`) ersetzt.
  - Angeschlossene vertikale Kabelschutzrohre und warm flackerndes Halogen-Punktlicht (`PointLight`) integriert.
- **Status:** 94 Testsuiten, 540 Tests, Build/Lint 100% grün.

## 90. Ausrichtung der Wandleuchten in den Raum (2026-08-30)
- **Lampen-Rotation ([`showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)):**
  - Lokale Drehung der beiden `wall_lamp.glb`-Meshes um 90° nach rechts (`rotation.y = -Math.PI / 2`) korrigiert.
  - Beide Schiffsarmaturen strahlen nun mit Glasdom und Schutzkäfig frontal in den Raum hinein (+X von der linken Wand, +Z von der Rückwand) und beleuchten den Charakter und die Bühne optimal.
- **Status:** 95 Testsuiten, 542 Tests, Build/Lint 100% grün.

## 91. Architektur-Entscheidung: Modulare Asset-Kits & Out-of-Tree Asset Library (2026-08-30)
- **ADR 0011 dokumentiert ([`docs/adr/0011-modular-asset-kits-and-remote-catalog.md`](docs/adr/0011-modular-asset-kits-and-remote-catalog.md)):**
  - Entkopplung von Engine-Core und Binär-Assets (3D-Meshes, 2K/4K-Texturen, Audio, Mocap-Clips) zur Vermeidung von Git-Repo-Bloat.
  - 3-Phasen-Strategie:
    1. *Stufe 1:* Einheitliche Kit-Struktur (`public/assets/kits/<kit>/` mit `model.glb`, `preview.webp`, `meta.json`).
    2. *Stufe 2:* Auslagerung in dediziertes Asset-Repo (`small-world-machine-assets`) mit CDN-Verteilung.
    3. *Stufe 3:* On-Demand Engine Ingest (`GltfLoader.loadFromCatalog()`) & CLI (`npx small-world-machine add kit <name>`).
  - Nukleus des Starter-Kits: `wall_lamp.glb`, Holzkisten, Ölfass, Schutt-Polygonberg, Noir-Materialien und Mocap-Locomotion-Pool.
- **Status:** 95 Testsuiten, 542 Tests, Build/Lint 100% grün.

## 92. Industriefässer: 3 PBR-Varianten & ADR/GHS-Gefahrgut-Kennzeichnung (2026-08-30)
- **Nomenklatur bereinigt:** Begriff „Öl“ durch modulare Fass-Klassifizierung ersetzt (`barrel_oil_black`, `barrel_hazard_yellow`, `barrel_chemical_blue`).
- **3 Fass-Varianten im Industrial Kit ([`public/assets/kits/industrial/`](public/assets/kits/industrial/)):**
  1. `barrel_oil_black`: Verrosteter 200L-Stahldruckbehälter mit 2×3 Rillenbändern und schwarzen Ölrückständen.
  2. `barrel_hazard_yellow`: Gelber Korrosionsanstrich, schwarze Diagonal-Warnstreifen und offizielles ADR Klasse 6.1 / GHS06 Totenkopf-Gefahrgut-Decal.
  3. `barrel_chemical_blue`: Dunkeltürkisblaues Chemiefass, rotes ADR Klasse 3 (Entzündbar) Flammensymbol und deutsche Schablonen-Typografie („ENTZÜNDBAR ACHTUNG! INHALT: 200L GEFAHRGUT“).
- **Kit-Manifest & Metadaten:** `kit.json`, `meta.json` und Vorschaubilder (`preview.jpg`) für alle Varianten erstellt.
- **Status:** 96 Testsuiten, 546 Tests, Build/Lint 100% grün.

## 93. Engine-Vision erweitert: Open Standards & Frictionless Asset Ingestion (2026-08-30)
- **Vision-Pfeiler verankert ([`VISION.md`](VISION.md)):**
  - *Säule 5 (Pain Points):* Beseitigung von Repo-Bloat und geschlossenen Asset-Store-Silos durch das modulare Kit-Format (`model.glb` + `preview.jpg` + `meta.json`).
  - *Philosophie 6:* Verpflichtung zu offenen glTF 2.0-Standards, universeller Interoperabilität mit DCC-Tools (Blender, Kenney, Poly Haven, Sketchfab) und nahtloser KI-Generierung (Tripo, Meshy).
- **Status:** 96 Testsuiten, 546 Tests, Build/Lint 100% grün.

## 94. Artikulierte Diorama-Ratten & Prozedurale Putz-Animation (2026-08-30)
- **Haupt-Putzratte ([`showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)):**
  - Sitzt gut sichtbar auf Holzkiste 3 (`y = 0.45m`) im Halbschatten vorne links.
  - Vollständige artikulierte Anatomie: Haunches/Becken, aufgerichteter Torso, beweglicher Kopf mit Schnauze & rosa Öhrchen, leuchtende Rubinaugen, separate linke/rechte Vorderpfoten und ein 6-gliedriger geschwungener Schwanz.
- **3-Phasen-Verhaltenszyklus (Finite State Machine):**
  1. *Phase 1 (Putz-Phase):* Schnelles zirkuläres Schrubben der Vorderpfoten an Schnurrhaaren und Gesicht mit synchronem Kopfnicken (18 Hz Oszillation).
  2. *Phase 2 (Sicherungs-Phase):* Pfoten an die Brust angelegt, schnelles Schnüffeln & neugieriges Umsehen im Raum.
  3. *Phase 3 (Ohr-Putz-Phase):* Linke Pfote schrubbt hinter dem linken Ohr, Kopf neigt sich seitlich.
  4. *Kontinuierlich:* Geschmeidige Spline-Wellenschwingung des Schwanzes über die Kistenkante.
- **Umgebungs-Ratten:**
  - Ratte 2: Schnüffelnde Ratte am Schutthaufen.
  - Ratte 3: Vorsichtig lauernde Ratte zwischen den Mauereck-Kisten.
- **Status:** 96 Testsuiten, 546 Tests, Build/Lint 100% grün.

## 95. Wiederverwendbare `GroomingRat` & `RatGroomingBehavior` Extension (2026-08-30)
- **Modulare Creature-Extension ([`src/extensions/creatures/`](src/extensions/creatures/)):**
  - `RatGroomingBehavior.ts`: Kapselt die 3-Phasen-Putz-FSM (Face-Washing, Sniffing, Ear-Cleaning) und Spline-Wellen-Kinematik als standardmäßiges Small-World-Machine `Behavior` mit Inspector-Reflexion.
  - `GroomingRat.ts`: Vorgefertigtes artikuliertes 3D-Prefab mit Farb-/Skalierungs-Optionen und automatischer Behavior-Anbindung.
  - Re-exportiert über `src/extensions/index.ts` und Engine-Root `src/index.ts`.
- **Showcase & Tests:**
  - `showcase.ts` auf die modulare `GroomingRat`-Klasse umgestellt (1 Zeile Code für vollständige Lebenssimulation).
  - 5 neue Unit-Tests in [`tests/extensions/GroomingRat.test.ts`](tests/extensions/GroomingRat.test.ts).
  - Dokumentiert in [`REFERENCES.md`](REFERENCES.md).
- **Status:** 97 Testsuiten, 551 Tests, Build/Lint 100% grün.

## 96. Umfassende Test-Coverage für Architektur-Entscheidungen (2026-08-30)
- **4 neue Testsuiten implementiert (101 Testsuiten / 567 Tests):**
  1. [`tests/loaders/AssetKitValidation.test.ts`](tests/loaders/AssetKitValidation.test.ts): Validiert ADR 0011 Modular Asset Kits, `kit.json`/`meta.json`-Schemata, physische Existenz von GLB/Preview-Dateien, Low-Poly-Budgets, Sockets (`LightBulb`) und ADR/GHS-Gefahrgut-Kennzeichnungen.
  2. [`tests/tools/maker/TransformGizmo.test.ts`](tests/tools/maker/TransformGizmo.test.ts): Validiert ADR 0010 Maker 3D-Gizmos, Achsentransformationen (Translate, Rotate, Scale), Screen-Space-Deltas und Entkopplung bei Detach.
  3. [`tests/tools/maker/UndoStack.test.ts`](tests/tools/maker/UndoStack.test.ts): Validiert Command-Pattern, sequentielle Undo/Redo-Ketten, Redo-Zweig-Verwerfung bei neuen Aktionen und Historien-Bereinigung.
  4. [`tests/core/CharacterSockets.test.ts`](tests/core/CharacterSockets.test.ts): Validiert Knöchel-/Handflächen-Socket-Ausrichtung (`mixamorig:LeftHandMiddle1`) und dynamische Transform-Synchronisation bei Charakterbewegung.
- **Status:** 101 Testsuiten, 567 Tests, Build/Lint 100% grün.

## 97. Diorama-Ratten-Ausrichtung (2026-08-31)
- **Schutthaufen-Ratte (`Rat_DebrisSniffer`):**
  - Rotation `rotation.y` von `2.2` auf `0.78` angepasst, sodass die Ratte auf dem Schutthaufen nicht mehr rückwärts in Kiste 2 / die Eckwand blickt, sondern nach vorne-rechts in den offenen, beleuchteten Raum und zur Raummitte/zum Charakter blickt.
- **Status:** 113 Testsuiten, 599 Tests, Build/Lint 100% grün.

---

## 98. Die absolute Grundfeste: Das Stray-Prinzip & Story-First (2026-09-02)
- **Paradigmen-Verankerung in `src/apps/and-now/docs/story.md` & `CONTEXT.md`:**
  - *„Die Story ist alles. Das Technische kommt danach.“*
  - Ausrichtung an Meisterwerken wie *Stray*, *Inside* und *Journey*: Keine 8K-Texturen-Schlachten, kein GPU-Wettrüsten, sondern emotionale Wucht, intime Melancholie, malerische Beleuchtung (Chiaroscuro) und Novotnys persönliche Odyssee (die Kaffeedosen-Urne des Großvaters durch das zerstörte Wien tragen).
  - Verbindlicher Entwicklungsgrundsatz: Alle emotionalen Schicksale, narrative Knotenpunkte und Begegnungen auf Novotnys Reise werden vor neuen technischen Features unerschütterlich geklärt und geschärft.
- **Status:** 112 Testsuiten, 626 Tests, Build/Lint 100% grün.

---

## 99. Der 2-Phasen-Höhepunkt: Begräbnis & Abrechnung (2026-09-02)
- **Dramaturgische Weichenstellung (*Stray* trifft *The Last of Us*):**
  - **Vorletztes Ziel (Emotionaler Schutz-Bogen & Katharsis):** Das würdevolle Begräbnis am Wiener Zentralfriedhof („A schene Leich“ mit den Pompfinebrern). Solange Novotny die Kaffeedose im Rucksack trägt, regieren Vorsicht, Schutz und Trauer.
  - **Letztes Ziel (Die Abrechnung):** Sobald die Asche in geweihter Friedhofserde ruht, fällt die hemmende Angst ab. Novotny hat ab diesem Moment *nichts mehr zu verlieren*. Mit dem entschlüsselten Medaillon marschiert die Figur direkt in die Rossauer Kaserne und stellt Hofrat Brandstätter und die mörderische Bunker-Bürokratie persönlich zur Rede.
- **Status:** 112 Testsuiten, 626 Tests, Build/Lint 100% grün.

---

## 100. Multi-Agent Kollaboration: Irisierender Ölfleck & Skill-Refinements (2026-09-07)
- **Irisierender Ölfleck-Shader (`OilSlickMaterial` in `src/apps/and-now/scenes/character-diorama/`):**
  - Kollaborative Ausarbeitung (Alice/Bob) basierend auf Referenzfoto für realistische Dünnschichtinterferenz (Airy-Formel & Cauchy-Dispersion).
  - Volle WebGL2- und WebGPU/WGSL-Parität mit proceduralem Hash-Noise, FBM und Chiaroscuro-Lichtstimmung.
  - Integration in das Charakter-Diorama ([`showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)).
- **Runtime-Verifikation & Fixes:**
  - Behebung von Pre-Processor Token-Injektionen in Shader-Kommentaren (`// [WGSL_LIGHTING]`).
  - Behebung von WGSL-Parameter-Shadowing durch Block-Scope-Isolation (`{ let i = mod_i; [CHUNK] }`).
  - Erfolgreiche Abnahme im Diorama via WebGPU und WebGL.
- **Skill- & Regel-Erweiterungen:**
  - [`collaborate/SKILL.md`](.agents/skills/collaborate/SKILL.md): Lifecycle nach Konsens geschärft (Umsetzungs- & QA-Schleife mit `[ABNAHME_ERTEILT]` vor `/collaborate --stop`).
  - [`coding-guide/SKILL.md`](.agents/skills/coding-guide/SKILL.md): Neue Richtlinien für Template-Tokens (Makro-Schutz in Kommentaren) und WGSL Entry-Point Scope-Isolation.
- **Status:** Kollaborations-Session sauber mit `/collaborate --stop` beendet (`oil.pid` archiviert), Skills aktualisiert.

---

## 101. Laternen-Bug bei Yoshi gefunden & pragmatisch gelöst (2026-09-09)
- **Live-Diagnose (Character Diorama, alle drei Figuren geprüft):** Männlich und Weiblich hängen
  die Laterne in jeder Pose korrekt in der linken Hand. Bei **Yoshi** schwebte sie komplett
  losgelöst auf Hüft-/Schwanzhöhe bzw. am Boden.
- **Root Cause (kein Formel-Bug):** Live-Logging der aufgelösten Hand-Bone-Weltposition zeigte,
  dass `mixamorig:LeftHandIndex1` bei Yoshi nirgendwo in der Nähe seiner sichtbaren Stummelärmchen
  liegt (die z.B. im `idle_torch`-Pose am Maul hochgezogen sind, während der Bone auf
  Bauchnabelhöhe sitzt). Ursache: Yoshi ist laut Eintrag 77 ein Easter-Egg mit rein automatischem
  Mixamo-Auto-Rigging auf einem Sketchfab/Nintendo-Mesh — Skin-Bindung und Skelett-Semantik passen
  dort nicht zusammen. Bone-Tracking ist damit grundsätzlich das falsche Werkzeug, kein
  Koeffizient hätte das repariert.
- **Fix:** `_syncLanternTransform()` in [`character-diorama/showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)
  und [`flakturm-tunnel/showcase.ts`](src/apps/and-now/scenes/flakturm-tunnel/showcase.ts)
  (identisches Pattern in beiden Szenen) bekommt für `characterType === "yoshi"` einen eigenen,
  von Hand kalibrierten Fest-Offset relativ zur Charakter-Wurzel statt Bone-Tracking — bewusste,
  mit dem User abgestimmte Pragma-Lösung, da Yoshi kein kanonischer Story-Charakter ist. Live in
  beiden Szenen (Diorama: alle Idle/Walk-Posen; Flakturm-Tunnel: `?char=yoshi`) verifiziert,
  Männlich/Weiblich als Regressionscheck erneut bestätigt.
- **Status:** `npx tsc --noEmit` grün, keine Scope-Erweiterung über den Lantern-Fix hinaus.

---

## 102. Zweiter, unabhängiger Laternen-Bug: falsches Parent-Objekt (2026-09-09)
- **User-Report widersprach der obigen "erledigt"-Verifikation:** Ein vom User geteilter
  Screenshot (Männlich, `idle_torch`) zeigte die Laterne deutlich losgelöst von der Hand — obwohl
  Eintrag 101 genau diese Kombination als korrekt bestätigt hatte. Hartes Neuladen beim User
  änderte nichts.
- **Repro-Schlüssel:** Reine Charakter- oder Kamera-Rotation zeigte den Bug NICHT (beides weiterhin
  korrekt). Erst das Rotieren des **gesamten Dioramas** (`_dioramaRoot.rotation.y`, genau das, was
  die eingebaute Turntable-Funktion tut) reproduzierte ihn zuverlässig bei jedem Winkel außer 0.
- **Root Cause:** `_lanternGroup` wurde in [`character-diorama/showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)
  fälschlich an `_dioramaRoot` gehängt statt an `this.scene` (den echten Welt-Root) — anders als im
  Schwester-File `flakturm-tunnel/showcase.ts`, das dem im Docstring dokumentierten Muster korrekt
  folgt. `_syncLanternTransform()` berechnet und setzt aber immer eine **Welt**-Position; das ist
  nur korrekt, wenn der Parent eine Identitäts-Transformation hat. `_dioramaRoot` ist exakt das
  Objekt, das die Turntable-Funktion dreht — sobald das passiert (auch nur kurz, z.B. durch
  Ausprobieren der Turntable-Taste), driftet die Laterne unsichtbar in Weltkoordinaten weg,
  bleibt aber bei Rotation 0 unauffällig. Erklärt, warum die vorherige Verifikation (Eintrag 101,
  nie mit rotiertem Turntable getestet) den Bug nicht fand.
- **Fix:** Eine Zeile — `this._dioramaRoot!.add(this._lanternGroup)` → `this.scene.add(this._lanternGroup)`.
  Numerisch über einen vollen 360°-Sweep von `_dioramaRoot.rotation.y` verifiziert: Laterne-zu-Hand-
  Abstand konstant ~1cm bei jedem getesteten Winkel (vorher: bis zu mehreren zehn cm).
- **Lektion:** Ein Fix ist nicht "verifiziert", nur weil er am Standard-Blickwinkel funktioniert —
  Objekte, die an einen rotierbaren Parent gehängt sind, brauchen einen Test, der genau diese
  Rotation durchspielt.
- **Status:** `npx tsc --noEmit` grün, Debug-Instrumentierung vollständig entfernt.

---

## 103. Yoshi-Sonderfall aus Eintrag 101 zurückgenommen: war Messfehler, nicht Bone-Defekt (2026-09-10)
- **Anlass:** User fragte, ob Yoshis Fest-Offset-Notlösung (Eintrag 101) mit den frischen
  Erkenntnissen aus Eintrag 102 jetzt sauberer gelöst werden kann.
- **Neue Analyse:** Vollständiger Bone-Positions-Dump von Yoshis vollem Skelett (34 Bones) im
  bereits eingeblendeten `idle_torch`-Pose zeigt: seine gesamte linke Arm-Kette
  (Shoulder/Arm/ForeArm/Hand/Thumb1/Index1, inkl. dem in Eintrag 101 verdächtigten
  `mixamorig:LeftHandIndex1`) clustert sauber und plausibel an seiner Brust — nicht bei Hüfte/
  Schwanz wie ursprünglich gemessen. Die alte Messung (Eintrag 101) war vermutlich ein
  Bind-Pose-Snapshot vor dem Einblenden der Animation, kein echter Rig-Defekt.
- **Fix:** Yoshi-Sonderfall (Fest-Offset relativ zur Charakter-Wurzel) in
  [`character-diorama/showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts)
  und [`flakturm-tunnel/showcase.ts`](src/apps/and-now/scenes/flakturm-tunnel/showcase.ts)
  entfernt — er nutzt jetzt denselben generischen Bone-Tracking-Pfad wie Männlich/Weiblich. Über
  einen simulierten 180-Frame-`walk_torch`-Loop verifiziert: Laterne-zu-Bone-Abstand konstant
  ~1cm (identisch zum menschlichen Fall). Live in `idle_torch`, `idle_1` und `walk_torch`
  bestätigt; Männlich als Regressionscheck erneut geprüft.
- **Lektion:** Ein Live-gemessener "Fakt" (Bone X ist weit von der Mesh entfernt) kann trotzdem
  falsch sein, wenn die Messung zum falschen Zeitpunkt im Animations-Lifecycle stattfand — vor
  einer teuren Sonderlösung lohnt sich ein zweiter, sauber getimter Messdurchlauf.
- **Status:** `npx tsc --noEmit` grün, Debug-Instrumentierung (Bone-Marker-Helper, `__app`-Hook)
  vollständig entfernt.

---

## 104. Flakturm-Tunnel-Review: Geschwindigkeit, Selbstverdeckung, Zoom/Drehung, Beleuchtung (2026-09-10/11)
- **Anlass:** User-Review von Szene 2 mit fünf vagen Kritikpunkten (zu schnell, kaum sichtbare
  Animationen, Bewegungsgrenzen nicht eingehalten, keine Treppenanimation, Figur oben zu klein).
- **Geschwindigkeit:** `speed` in `StageMovementBehavior` von `0.15` über testweise `0.06` auf
  final `0.09` gesetzt.
- **"Fehlt immer ein Bein"-Befund:** Nach anfänglicher Fehleinschätzung (eigene Screenshots waren
  schlicht zu dunkel, vom User mit helleren Screenshots widerlegt) echtes, reproduzierbares
  Phänomen bestätigt: reine Projektionsgeometrie, kein Rig-/Mesh-Fehler. Bei einer permanent
  fixen Kamera fällt die gedachte Linie zwischen den beiden Füßen bei bestimmten Blickwinkeln
  exakt mit der Kamera-Sichtlinie zusammen — derselbe Effekt wie zwei Zaunpfähle, die sich von
  einem Ende der Reihe aus gesehen gegenseitig verdecken. Frustum- und Occlusion-Culling live
  ausgeschlossen (beide Male keine Änderung bei Deaktivierung). Fix: neue `startFacingNudge`-Option
  auf `StageMovementBehavior` (~8° Versatz der Start-Blickrichtung), verhindert, dass die Szene
  exakt auf der kritischen Linie startet — kein Fix "am Bein", das Skelett war immer korrekt.
- **Zoom & manuelle Drehung ergänzt:** Mausrad zoomt die sonst fixe Kamera entlang ihrer eigenen
  Z-Achse (geklemmt zwischen `CAMERA_MIN_Z`/`CAMERA_MAX_Z`); `[SHIFT]+[←]/[→]` dreht die Figur
  manuell auf der Stelle, ohne mit normaler Bewegung zu kollidieren (`StageMovementBehavior`
  währenddessen deaktiviert).
- **Beleuchtungs-Bug:** Die Spielfigur nutzte `BasicMaterial` — vollständig unlit, ignorierte
  Umgebungslicht, Richtungslicht und sogar die eigene Handlaterne komplett. Fix: `StandardMaterial`
  (matt, `roughness: 0.92`), analog zu `character-diorama`. Der gemalte Hintergrund bleibt bewusst
  unlit (2D-Kunst, keine 3D-Oberfläche).
- **Datei:** [`flakturm-tunnel/showcase.ts`](src/apps/and-now/scenes/flakturm-tunnel/showcase.ts)
- **Lektion:** Ein Live-Screenshot-Eindruck ("beide Beine sichtbar") kann selbst unrepräsentativ
  sein, wenn er nur einen Frame aus einer ganzen Animationsschleife zeigt — vor einer Verifikation
  lohnt sich ein Sample über den vollen Loop, nicht nur ein Blick.
- **Status:** `npx tsc --noEmit` grün, live über mehrere Sitzungen verifiziert.

---

## 105. Docs-Kapitel "2.5D-Grundlagen" erstellt, mehrfach erweitert (2026-09-11)
- **Anlass:** User wollte 2.5D-Grundlagen systematisch lernen (Perspektive, Fluchtpunkt,
  Bewegungsbereiche, Kameras), direkt am eigenen Projekt statt abstrakt.
- **Ergebnis:** Neues Engine-Docs-Kapitel [`docs/guides/2-5d-scenes.md`](docs/guides/2-5d-scenes.md)
  (zunächst als interaktive HTML-Seiten unter `.agents/notes/reference/` erprobt, dann als
  reguläres Docs-Kapitel formalisiert) — Perspektive/Fluchtpunkt-Abgleich, mehrere Fluchtpunkte
  bei verzweigten Hintergründen (Treppe vs. Tunnel als Beispiel aus genau dieser App), alle 7
  Kamera-Strategien, Zonen-Autorenschaft, Selbstverdeckung (Eintrag 104), ein Minimalbeispiel und
  die Lektionen aus diesem Projekt. Enthält ein echtes annotiertes Vermessungsbild des
  Flakturm-Hintergrunds (tatsächliche Bildmitte vs. gemalter Fluchtpunkt).
- **Nicht and-now-spezifisch, aber hier vermerkt:** dieses Kapitel lebt im allgemeinen Engine-Docs-
  Baum (`docs/guides/`), nicht in diesem App-Ordner, da es als Referenz für jedes künftige 2.5D-
  Projekt gedacht ist — der Anstoß und alle Beispiele kommen aber vollständig aus dieser App.
- **Status:** mehrfach erweitert (Fluchtlinien-Regel, Treppen-Fund aus Eintrag 106), ins Deutsche
  übersetzt (2026-09-12, siehe allgemeines Backlog).

---

## 106. Zone C (Treppe): Fluchtlinien-Kante lag im Schatten statt auf der Stufe (2026-09-11)
- **Anlass:** User-Hypothese: ein sauber gezogener Wegbereich unter einer rollwinkelfreien Kamera
  sollte entweder aus 2 waagerechten + 2 Fluchtlinien-Kanten bestehen (flacher Boden, z.B. Tunnel)
  oder — bei einem im Raum gedrehten Vieleck wie einer schräg wegführenden Treppe — aus zwei
  eigenen Fluchtlinien-Paaren mit je einem eigenen Fluchtpunkt.
- **Verifikation:** Beide Fälle an den echten Zonen-Daten nachgerechnet (Zone A/B passen zum
  ersten Fall, Zone C korrekt zum zweiten), dann direkt gegen die echte Kunst gemessen
  (`public/assets/and-now/flakturm_bg.webp`, Punkte annotiert). Ergebnis: Zone Cs rechte Kante
  (Handlauf-Seite) stimmte fast exakt; die linke Kante war falsch — ihr oberer Punkt (`P3`) lag bei
  `u=0.278` sichtbar neben der gemalten Stufenkante, im Schattenbereich daneben statt darauf.
- **Fix:** `DEFAULT_ZONE_POINTS.zone_c`s `P3` in [`flakturm-tunnel/showcase.ts`](src/apps/and-now/scenes/flakturm-tunnel/showcase.ts)
  von `u: 0.278` auf `u: 0.305` korrigiert (v, P0/P1/P2 unverändert). Vorher/Nachher gegen die
  echte Kante annotiert und verglichen (`docs/public/guides/2-5d-scenes/treppe_*`).
- **Lektion:** Die vom User vorgeschlagene Fluchtlinien-Konvergenz-Prüfung fand einen echten,
  sichtbaren Trace-Fehler, den reines Hinschauen auf die Zonen-Form allein nicht aufgedeckt hätte
  — jetzt auch als allgemeine Technik in `docs/guides/2-5d-scenes.md` §4/§5 dokumentiert.
- **Status:** live verifiziert, Build sauber.

---

## 107. Character-Diorama: echte Laufbewegung ergänzt, HUD-Fixes (2026-09-12)
- **Anlass:** Figur im Diorama konnte sich bisher nur auf der Stelle drehen (Pfeiltasten) und
  Animationen abspielen, ohne dass sich die Position je änderte (`_playerRig.position` wurde nur
  einmal beim Laden gesetzt).
- **Fix:** Echte `StageMovementBehavior`+`StageZone`-Bewegung über den ganzen begehbaren Boden
  (±1,9 Welteinheiten Halbausdehnung, Marge zu den Wänden bei ±2,1), `scale: 1.0` durchgehend —
  echte 3D-Tiefe über die frei orbitende Kamera, keine erzwungene Perspektive nötig (Diorama ist
  genau der "Doesn't apply"-Fall aus `docs/guides/2-5d-scenes.md` §3). Bestehende Pfeiltasten-
  Drehung bleibt erhalten, jetzt aber hinter `[SHIFT]` (sonst hätten sich beide Systeme jeden
  Frame um `rotation.y` gestritten — dieselbe Konvention wie im Flakturm-Tunnel). Position bleibt
  beim Charakterwechsel (Taste `C`) erhalten statt auf die Ursprungspose zurückzuspringen.
- **Flakturm-Tunnel-HUD:** die Status-Box folgte der Figur über die Bühne (`worldToScreen` auf
  Kopfposition), was sie z.B. weit oben auf der Treppe verdeckte, wo sie ohnehin schon klein ist.
  Jetzt fix am oberen Bildschirmrand. Zusätzlich um Live-`(u,v)`-Position und aktuelle Skalierung
  erweitert — dieselben Werte, die bisher nur per Konsole während Zonen-Verifikationen auslesbar
  waren.
- **Dateien:** [`character-diorama/showcase.ts`](src/apps/and-now/scenes/character-diorama/showcase.ts),
  [`flakturm-tunnel/showcase.ts`](src/apps/and-now/scenes/flakturm-tunnel/showcase.ts)
- **Status:** live verifiziert (manuelles Frame-Pumping: Laufen, exaktes Randklemmen, SHIFT-Drehung
  ohne Bewegungskonflikt), Teil von Commit `b179870c` (v0.77.28).

---

## 108. npm-Workspaces-Restrukturierung: and-now zieht nach `apps/and-now/` um (2026-09-12)
- **Anlass:** Vorarbeit für ADR 0016 (Flakturm-Szene im Maker editier-/speicherbar machen). Der
  User wollte vor dieser Feature-Arbeit eine dauerhafte strukturelle Weichenstellung: Apps sauber
  von der Engine trennen, damit künftig aus Erfolg/Misserfolg gelernt werden kann statt in einem
  Monat alles nochmal umzubauen (siehe `.agents/notes/backlog.md`, Eintrag vom selben Datum, für
  die volle technische Begründung/Alternativen-Abwägung).
- **Was sich für and-now konkret ändert:** `src/apps/and-now/` → `apps/and-now/` (eigenes
  Package `@small-world-machine/and-now`, `dependencies: {"@small-world-machine/engine": "*"}`). Alle Importe in
  `showcase.ts`/`prologue.ts`/`OilSlickMaterial.ts` gehen jetzt über den Package-Namen
  `@small-world-machine/engine` statt relativer Pfade in ein gemeinsames `src/`.
- **Verhalten unverändert:** keine funktionale Änderung an Flakturm-Tunnel, Character-Diorama oder
  Prologue — reine Struktur-/Import-Migration, live im Browser nachverifiziert (alle drei Szenen
  laden fehlerfrei, HUD/Bewegung/Rendering wie zuvor).
- **Dateien:** [`flakturm-tunnel/showcase.ts`](apps/and-now/scenes/flakturm-tunnel/showcase.ts),
  [`character-diorama/showcase.ts`](apps/and-now/scenes/character-diorama/showcase.ts),
  [`prologue/prologue.ts`](apps/and-now/scenes/prologue/prologue.ts)
- **Status:** live verifiziert (tsc/eslint/vitest/build grün, Browser-Check aller drei Szenen ohne
  Konsolenfehler). Nächster Schritt (separat): ADR-0016-Code, damit Flakturm tatsächlich im Maker
  läuft.

---

## 109. ADR 0016 vollständig umgesetzt: Flakturm-Tunnel ist jetzt Maker-fähig (2026-09-12)
- **Anlass:** Der oben angekündigte "nächste Schritt" — die Flakturm-Tunnel-Szene im Maker
  öffnen/bearbeiten/speichern können. Umgesetzt in drei Phasen (siehe `docs/adr/0016-...md` und
  die neue `docs/adr/0017-gltf-extension-plugin-registry.md` für Details).
- **Was sich für and-now konkret ändert:** `flakturm-tunnel/showcase.ts`s `uvToWorld`-Closure
  wurde zu `projection: {mode:"flat-plane", width:16, height:9, z:0, centerY:4.5}` (reine Daten
  statt Funktion) — Verhalten unverändert, aber jetzt Maker-roundtrip-fähig. Die drei Zonen
  (`zone_a`/`b`/`c`) sind weiterhin identisch definiert, ihre Mathematik (`getScaleAt`,
  `getLocalAxes`) wurde intern auf beliebige Punktzahl verallgemeinert, bleibt aber für diese
  bestehenden 4-Punkte-Zonen byte-identisch zum bisherigen Verhalten (regressionsgetestet).
  `character-diorama` bleibt bewusst bei `projection:{mode:"custom"}` (sein Boden-Mapping v→Z
  passt nicht ins `flat-plane`-Schema, das v→Y annimmt) — funktional unverändert, aber (noch)
  nicht Maker-roundtrip-fähig.
- **Neu:** Maker kann jetzt eine 2.5D-Bühnen-Szene komplett von Grund auf bauen — Hintergrundbild
  importieren (Seitenverhältnis-sicher), Zonen durch Klicken zeichnen, Punkte per Drag oder im
  Property-Panel verfeinern, alles über `SW_stage_zone` speicherbar/ladbar. Bisher nur an einer
  synthetischen Testzone live verifiziert (siehe Backlog), noch nicht am echten
  Flakturm-Hintergrundbild end-to-end durchgespielt (Nachziehen: eine Zone am echten Bild
  nachzeichnen und mit den bestehenden `DEFAULT_ZONE_POINTS`-Werten vergleichen, um Maker als
  Autoring-Werkzeug für diese konkrete Szene zu validieren).
- **Dateien:** [`flakturm-tunnel/showcase.ts`](apps/and-now/scenes/flakturm-tunnel/showcase.ts),
  [`character-diorama/showcase.ts`](apps/and-now/scenes/character-diorama/showcase.ts)
- **Status:** Engine-Teil (Phase 0/1) und Maker-UI-Teil (Phase 2) live verifiziert (`tsc`/`eslint`/
  `vitest` 752/752, `npm run build` grün, mehrere Live-Browser-Checks in Maker inkl. echtem
  Flakturm-Hintergrundbild-Import). Ein echter, vom User live entdeckter Rendering-Bug
  (importiertes Hintergrundbild stand auf dem Kopf) gefunden und gefixt. Nächster Schritt (falls
  gewünscht, separat): die drei echten Flakturm-Zonen tatsächlich in Maker nachzeichnen/abgleichen.

---

## 110. Wien 2100: Großvaters Faltplan (Stadtkarte & Schnellreise-System) (2026-09-14)
- **Diegetische Entscheidung (Story-First & Graphic-Noir-Doktrin):**
  - Kein steriler Sci-Fi-PDA / Pip-Boy, sondern Františeks zerfledderter, vergilbter Vorkriegs-Stadtplan (Wien 2026 / Falk-Plan) mit 50 Jahren handgezeichneten Rötelstift-Notizen, Kaffeerändern, Tesafilm-Streifen und Gefahrenmarkierungen.
  - Generiertes Graphic-Noir-Karten-Asset ([`public/assets/and-now/map/vienna_map.jpg`](public/assets/and-now/map/vienna_map.jpg)) mit Donau, Donaukanal, Stephansdom, Ringstraße, Arenbergpark, Prater/Riesenrad, Rossauer Kaserne und Simmering/Zentralfriedhof.
- **Interaktive Map-Modal-Komponente ([`ViennaMapModal.ts`](apps/sample-apps/and-now/ui/ViennaMapModal.ts)):**
  - Universell einbindbares 2D-Overlay mit Hotkey `[M]` und `[ESC]`.
  - Interaktive Pins mit Chiaroscuro-Halo-Pulsieren, Fraktions-Farben und kanonischen Standorten:
    1. *Flakturm Arenbergpark (3. Bezirk):* Szene 2 / Versorgungstunnel & Treppenaufgang.
    2. *Koje 42 (3. Bezirk):* Szene 1 / Prolog & Großvaters Vermächtnis.
    3. *Das Bermudadreieck (1. Bezirk):* Alchimisten-Keller / Giftmischer (Pharma-Netzwerk).
    4. *Wurstelprater & Riesenrad (2. Bezirk):* Ringelspiel-Syndikat / Kasperl-Bande.
    5. *Rossauer Kaserne (9. Bezirk):* Das Super-Amt / AZS-Bürokratie (Hofrat Brandstätter).
    6. *Wiener Zentralfriedhof (11. Bezirk):* Tor 2 / Die Pompfinebrer (Hauptziel der Urnenreise).
    7. *Safehouse Schelleingasse (4. Bezirk):* Creator Echo (S.R. Manuskripte).
    8. *Character Diorama Studio:* 3D-Bühne & Ratten-FSM.
  - Františeks handschriftliche Notiz-Karten im Vintage-Typografie-Look für jeden Schauplatz.
- **Diegetische Schnellreise (Fast Travel Transit):**
  - Atmosphärische Graphic-Noir-Transit-Vignette ([`public/assets/and-now/map/transit_tunnel.jpg`](public/assets/and-now/map/transit_tunnel.jpg)) mit einsamem Wanderer im gefluteten U-Bahn-Schacht Karlsplatz, Chiaroscuro-Laternenlicht und dynamischen Stimmungs-Einzeilern.
- **Szenen-Integration & Test-Coverage:**
  - Standalone-Kartenseite ([`scenes/map/`](apps/sample-apps/and-now/scenes/map/)) und Scene-Hub-Card ([`index.html`](apps/sample-apps/and-now/index.html)).
  - Hotkey `[M]` und HUD-Buttons in [`flakturm-tunnel`](apps/sample-apps/and-now/scenes/flakturm-tunnel/showcase.ts) und [`character-diorama`](apps/sample-apps/and-now/scenes/character-diorama/showcase.ts).
  - 4 neue Unit-Tests in [`apps/sample-apps/and-now/tests/ViennaMap.test.ts`](apps/sample-apps/and-now/tests/ViennaMap.test.ts).
- **Status:** 141 Testsuiten, 779 Tests, Build/Lint 100% grün.

---

## 111. Visuelle Kompromisslosigkeit: Sin-City Graphic Noir Shader & Selektive Farbisolation (2026-09-14)
- **Shader-Upgrade (`filter_noir.glsl` & `filter_noir.wgsl` in `packages/engine/src/core/materials/shaders/chunks/`):**
  - **Tusche-Chiaroscuro:** Hard Comic S-Curve (`smoothstep(0.06, 0.88, luma)` + `pow(ink, 1.35)`) mit tiefen, gecrushten Tuscheschatten und strahlenden Highlights auf subtilem, warmem Pergament-Grauwert.
  - **Selektive Farbisolation (Color is Meaning):**
    1. *🟡 Bernstein/Gold:* Großvaters Handlaterne, Halogen- & Kerzenlicht (`isAmber`).
    2. *🔴 Karminrot:* AZS-Sperrstempel, Blut, tödliche Gefahr (`isRed`).
    3. *🟢 Smaragdgrün:* Alchemie, Penicillin & Gifte im Bermudadreieck (`isEmerald`).
  - Volle WebGL2- und WebGPU/WGSL-Parität ohne Rebuild-Overhead.
- **Szenen-Steuerung & Hotkeys:**
  - Taste **<kbd>[N]</kbd>** (oder HUD-Button *„🎬 Noir“*) schaltet in [`flakturm-tunnel`](apps/sample-apps/and-now/scenes/flakturm-tunnel/showcase.ts) und [`character-diorama`](apps/sample-apps/and-now/scenes/character-diorama/showcase.ts) in Echtzeit zwischen Normal-Rendering und dem radikalen Sin-City Graphic-Noir-Look um.
- **Status:** 141 Testsuiten, 779 Tests, `tsc`, `lint:fix` und `build:lib` 100% grün.

---

## 112. Die Sin-City Colorkey-Dramaturgie („Farbe ist Drama, keine Dekoration“) (2026-09-14)
- **Dramaturgisches Kernprinzip (Dramatik in Perfektion):**
  - Bestimmte Schlüsselszenen werden aus Regiegründen radikal auf reines Schwarz/Weiß (gecrushte Chiaroscuro-Tusche) reduziert und besitzen **genau eine einzige, isolierte Schlüsselfarbe (Colorkey)**:
    1. *Koje 42 / Prolog:* Reines Schwarz/Weiß mit isoliertem 🟡 **Bernsteingold** (Großvaters Kerosin-Laterne & flackernde Röhre des Amts-Terminals) als letzter Funke menschlicher Wärme.
    2. *Kältekammer K-42:* Reines Schwarz/Weiß mit dem winzigen, eisigen 🟢 **Blausäure-Smaragdtupfer** am Hals des Großvaters zur Entlarvung des Mordes.
    3. *Bermudadreieck (Alchemie-Gewölbe):* Reines Schwarz/Weiß mit 🟢 **Smaragdgrün** (brodelnde Reagenzien, Narkotika und toxische Injektoren).
    4. *Zentralfriedhof (Beisetzung):* Reines Schwarz/Weiß mit 🔴 **Karminrot / Purpurgold** auf der Schärpe des Ober-Kondukteurs im Weihrauchnebel.
    5. *Tribunal Rossauer Kaserne (Akt IV Finale):* Reines Schwarz/Weiß mit dem stechenden 🔴 **Karminrot** des AZS-Sperrstempels zur finalen Abrechnung.
- **Dokumentation:** Vollständig in [`story.md`](apps/sample-apps/and-now/docs/story.md) und [`concept-dossier.html`](apps/sample-apps/and-now/docs/concept-dossier.html) als feste Kernsäule verankert.
- **Status:** 141 Testsuiten, 779 Tests 100% grün.

---

## 113. Fraktions-Kasten & Klassen-Archetypen (Sin-City Concept-Art) (2026-09-14)
- **Erweiterung der Figuren-Hierarchien:**
  - Jede Fraktion besitzt eine 4-stufige Kasten-Hierarchie (*Anführung &rarr; Innerer Kreis &rarr; Handlanger &rarr; Enforcer/Schläger*).
  - Neu generierte & integrierte Klassen-Archetypen im radikalen Sin-City Comic-Stil:
    1. *Die Pompfinebrer (Enforcer):* **Der Schaufler** ([`proto_pompfinebrer_schaufler.jpg`](public/assets/and-now/concepts/proto_pompfinebrer_schaufler.jpg)) — massiver Friedhofswächter im Kutscherrock mit geschliffener Eisenschaufel als Streitaxt, abgesägter Doppelflinte und Bernstein-Grablaterne.
    2. *Das AZS (Ordnungsdienst):* **Die Schleusenwache** ([`proto_azs_schleusenwache.jpg`](public/assets/and-now/concepts/proto_azs_schleusenwache.jpg)) — schwer gepanzerte Bunkerwache mit Visierhelm/Gasmaske, Lichtbogen-Taser-Stab, StG-77 und leuchtendem Karminrot-AZS-Armband.
- **Dossier- & Asset-Integration:**
  - Vollständig in [`vienna_2100_art_dossier.md`](file:///Users/srottensteiner/.gemini/antigravity-cli/brain/d044e884-918e-4a48-b2ae-7e98ae599157/vienna_2100_art_dossier.md) und [`concept-dossier.html`](apps/sample-apps/and-now/docs/concept-dossier.html) eingebunden.
- **Status:** 141 Testsuiten, 779 Tests 100% grün.

---

## 114. Kanonische Bewaffnung: Steyr AUG A3 M2 (2026-09-14)
- **Authentischer Militär-Standard für Wien 2100:**
  - Die Ordonnanzwaffe der AZS-Wachen und Rossauer-Kaserne-Garnisonen wurde kanonisch auf das **Steyr AUG A3 M2** (modernisiertes Bullpup-Sturmgewehr mit Picatinny-Schienen, NATO-Magazinschacht, moderner Optik und 5,56mm-Munition) festgelegt.
  - Vorkriegs-Lore (~2050): Perfekt passend zur österreichischen Bundesheer-Modernisierungslinie vor dem Kollaps.
  - Dokumentiert in [`story.md`](apps/sample-apps/and-now/docs/story.md), [`concept-dossier.html`](apps/sample-apps/and-now/docs/concept-dossier.html) und im Art-Dossier; als Pflicht-Spezifikation für zukünftige AZS-Bild-Prompts hinterlegt.
- **Status:** 141 Testsuiten, 779 Tests 100% grün.

---

## 115. Protagonisten-Starterwaffe: Glock 17 (Pistole 80) des Großvaters (2026-09-14)
- **Kanonische Seitenwaffe für Novotny:**
  - Als Starter-Schusswaffe führt Novotny Františeks originale Dienstpistole: die **Glock 17 (Pistole 80, 9×19mm Parabellum)** aus Deutsch-Wagram.
  - *Narrativer Fundort:* Novotny birgt die Waffe zusammen mit dem Medaillon und der Kapuzinergruft-Fahrkarte im Prolog-Heist aus der AZS-Asservatenkammer im Flakturm Arenberg.
  - *Charakter & Patina:* Glattpoliertes Polymergriffstück, verblasstes Vorkriegs-Wappen, 100% verlässlich im Schlamm und Schachtstaub.
  - *Werkbank-Modding:*
    1. *Schalldämpfer („Kanal-Flüsterer“)*: Aus altem Kfz-Ölfilter für leise Schleichpassagen.
    2. *TU-Laserzielhilfe*: Modifiziertes Rotpunkt-Modul aus einem TU-Vermessungsgerät.
    3. *33-Schuss-Magazin („Wiener Stange“)*: Verlängertes AZS-Magazin.
- **Dokumentation:** In [`story.md`](apps/sample-apps/and-now/docs/story.md) und [`concept-dossier.html`](apps/sample-apps/and-now/docs/concept-dossier.html) festgeschrieben.
- **Status:** 141 Testsuiten, 779 Tests 100% grün.

---

## 116. Das 3-Stufen-Nahkampfsystem: Psychologische Wucht, Brutalität & Non-Lethal (2026-09-14)
- **Nahkampf als physischer & emotionaler Horror:**
  - Novotny ist ein schmaler 22-jähriger Schacht-Inspektor. Nahkampf ist im Graphic-Noir-Stil niemals saubere Akrobatik, sondern ein verzweifeltes Ringen im Dreck, Schweiß und Atem des Gegners.
  - **Die 3 mechanischen und narrativen Stufen:**
    1. *Stufe 1 (Non-Lethal / Stealth):* **Elektroschocker / AZS-Viehtreiber** — Lautloses Subdue im bläulich-weißen Lichtbogen ohne Blutvergießen.
    2. *Stufe 2 (Brutale Abwehr / Werkzeug):* **Wiener Totschläger & „Wiener Hebel“** — Dumpfe Knochenschläge auf Schlüsselbeine und Gelenke; Rüstungsbrecher gegen Helme und Schilde der Schleusenwache.
    3. *Stufe 3 (Die letzte Verzweiflung / Tödliche Intimität):* **Glock Feldmesser 78 (FM 78)** — Todbringender Nahkontakt auf zehn Zentimeter. Man spürt das Reißen von Stoff und den Widerstand an Rippenknochen. Im Sin-City-Stil reine Chiaroscuro-Tusche mit isoliertem **Karminrot-Colorkey** an Novotnys zitternden Händen. Hinterlässt Novotny traumatisiert und nach Luft ringend.
- **Dokumentation:** In [`story.md`](apps/sample-apps/and-now/docs/story.md) und [`concept-dossier.html`](apps/sample-apps/and-now/docs/concept-dossier.html) verankert.
- **Status:** 141 Testsuiten, 779 Tests 100% grün.

---

## 117. Erzähl-Architektur: Kinetischer Graphic-Noir statt Psycho-Simulation (2026-09-14)
- **Klare, respektvolle Design-Abgrenzung:**
  - *Disco Elysium* ist ein textgewaltiger literarischer Meilenstein, setzt aber auf 24 debattierende Skill-Stimmen, Würfel-Checks und ein abstraktes Gedanken-Kabinett-Menü, was für eine actionreichere, atmosphärische Graphic-Noir-Erfahrung zu statisch und überfrachtet wäre.
  - **Die „Sin-City Caption Box“-Doktrin für „And Now?“:**
    1. *Eine einzige lakonische Off-Stimme:* Novotnys eigene, trockene Gedanken im knappen Chiaroscuro-Kasten (1–2 messerscharfe Zeilen).
    2. *Wiener Bauchgefühl & Schmäh:* Intuitive Multiple-Choice-Dialoge mit situativem Timing und Wiener Fatalismus statt Skill-Tree-Overhead.
    3. *Kinetischer Spielfluss:* Die Atmosphäre entsteht aus Licht, Schatten, Soundkulisse und schnellem Dialogtempo.
- **Dokumentation:** In [`story.md`](apps/sample-apps/and-now/docs/story.md) eingepflegt.
- **Status:** 141 Testsuiten, 779 Tests 100% grün.

---

## 118. Session-Abschluss & Bereitstellung für den nächsten Einstieg (2026-09-14)
- **Gesamtergebnis der Nacht-Session:**
  1. *🗺️ Großvaters Faltplan (Wien 2026 ➔ 2100):* Interaktive Map-Modal-Komponente ([`ViennaMapModal.ts`](apps/sample-apps/and-now/ui/ViennaMapModal.ts)) mit Chiaroscuro-Pins, diegetischem Schnellreise-Transit, Františeks Notizen und Live-Vorschau der Schauplatz-Artworks & Fraktions-Archetypen.
  2. *🎬 Sin-City Graphic Noir Shader & Colorkey-Dramaturgie:* Echter Comic-Tusche-Look mit selektiver Farbisolation (🟡 Bernstein, 🔴 Karminrot, 🟢 Smaragd) in GLSL/WGSL und Hotkey `[N]`.
  3. *👥 Kasten- & Figuren-Archetypen:* 6 Protagonisten/Enforcer generiert und eingebunden (Kondukteur, Schaufler, Brandstätter, Schleusenwache, Dekanin, Hutschmeister).
  4. *🔫 Waffen-Standard:* **Steyr AUG A3 M2** als AZS-Ordonnanz und **Františeks Glock 17 (Pistole 80)** als Starter-Waffe aus dem Prolog-Heist.
  5. *⚔️ 3-Stufen-Nahkampf:* Elektroschocker (Stealth), Wiener Totschläger / Hebel (Rüstungsbrecher), Glock FM 78 Feldmesser (tödliche Intimität / Colorkey Rot).
  6. *🧠 Erzähl-Doktrin:* Kinetischer Graphic-Noir mit lakonischer 1-Stimme-Off-Box („Sin City Caption Box“) statt überfrachtetem Psycho-Skilltree.
- **Startpunkt für die nächste Session:**
  - 1. *Sin City Caption Box:* In-Game-Overlay für Novotnys innere Monologe bauen (`NoirCaptionOverlay`).
  - 2. *Prolog Koje 42:* Kaffeedosen-Urnen-Interaktion und Heist-Vorbereitung.
  - 3. *Neuer Schauplatz als 2.5D-Bühne:* Bermudadreieck oder Zentralfriedhof Tor 2.
- **Verifikations-Status:** 141 Testsuiten, 779 Tests, `tsc`, `lint:fix`, `build:lib` **100% grün**.

---

## 119. Die Fraktions-Klassenmatrix, Kasten-Tiefen & Graphic-Noir Prototypen (2026-09-14)
- **Erweiterung des visuellen und mechanischen Fraktions-Rosters:**
  - Codierung von 3–4 distinkten Klassen/Rollen für alle 6 Wiener Fraktionen mit klaren Silhouettenwerten, Chiaroscuro-Lichtspiel und Sin-City Colorkeys:
    1. *Das AZS:* Sektionschef (Hofrat), Schleusenwache (Schild/Taser), Kanzlei-Grenadier (**Steyr AUG A3 M2**), Dekont-Spürer (ABC/Säure-Schaum).
    2. *Die Pompfinebrer:* Ober-Kondukteur (Zeremonienmeister/Buffs), Schaufler (Schwere Schaufel-Streitaxt/Doppelflinte), Gruftspäher (Infiltrator/Fallen), Einbalsamierer (Support/Formaldehyd).
    3. *Das Konsulat:* Doyen (Aristokratischer Botschafter mit Degenstock & Zigarre), Attachée (Schattenagentin mit Schalldämpfer & Chiffrierwalze), Palais-Gardist (Kevlar-Galauniform/Bajonett).
    4. *Die Aschenbrenner (Spittelau):* Schornsteinfeger-Gildengroßmeister (Ruß-Zylinder/Druckschleusen), Oberheizer (Schlackekoloss mit Glüh-Schürhaken & Flammenlanze), Schlotkraxler (Rußfänger/Vertikal-Akrobat).
    5. *Das Ringelspiel-Syndikat:* Hutschmeister (Pate mit Kasperl-Klinge), Kasperl-Schläger (Terror-Enforcer mit rissiger Holzmaske & Nagelpritsche), Rekommandeuse (Kirmes-Scharfschützin/Feuerwerk).
    6. *Die Giftmischer:* Dekanin (Chef-Toxikologin mit Neurotoxinen), Sanitäter (Adrenalin-Berserker/Knochensäge), Probensammler (Kanal-Pipettierer).
- **Generierte & eingebundene Assets:**
  - `proto_weapon_steyr_aug_a3_m2.jpg`: Steyr AUG A3 M2 mit Picatinny-Schienen, Reflexvisier und `AZS-ORD-77`-Stempelung.
  - `proto_konsulat_doyen.jpg`: Der Doyen im Palais Metternich (Monokel, Orden, Adler-Degenstock, Colorkey Bernstein).
  - `proto_konsulat_attachee.jpg`: Die Attachée in der Regengasse (Leder-Trench, Schalldämpfer, Chiffrierwalze, Colorkey Rubinrot).
  - `proto_aschenbrenner_heizer.jpg`: Der Oberheizer in Spittelau (Schweißbrille, glühende Schlackenharke, Dampfrohre, Colorkey Glut-Orange).
  - `proto_ringelspiel_kasperl.jpg`: Der Kasperl-Schläger im Wurstelprater (Kasperlmaske, Nagel-Pritsche, Riesenrad, Colorkey Blutrot).
  - `proto_protagonist_novotny.jpg`: Novotny im Schacht-Trenchcoat mit Glock 17 & Kaffeedosen-Urne im Chiaroscuro.
- **Aktualisierte Komponenten:**
  - [`ViennaMapModal.ts`](apps/sample-apps/and-now/ui/ViennaMapModal.ts): Eingepflegte Standorte für Palais Metternich & Spittelau mit Live-Archetyp-Vorschauen & Zitaten.
  - [`concept-dossier.html`](apps/sample-apps/and-now/docs/concept-dossier.html): Galerie der Archetypen und Waffen erweitert.
  - [`story.md`](apps/sample-apps/and-now/docs/story.md) & [`vienna_2100_art_dossier.md`](vienna_2100_art_dossier.md): Vollständige Kastenmatrix dokumentiert.

---

## 120. Die 2-Ebenen-Dramaturgie: Welt-Atmosphäre vs. Sin-City Regie-Eingriff (2026-09-14)
- **Klarstellung der visuellen Doktrin:**
  - Das Spiel läuft **nicht dauerhaft in reinem Schwarz-Weiß mit Colorkey**, um visueller Ermüdung vorzubeugen und die morbide Wiener Haptik (Patina-Grün, Donaukanal-Petrol, Gaslaternen-Bernstein, verblichenes Schönbrunner Gelb, nasser Kopfstein) zu erhalten.
  - **Die 2 Ebenen:**
    1. *Ebene 1 (Baseline / 85–90% der Spielzeit):* Malerischer, atmosphärisch gedämpfter Graphic-Noir (*Dishonored × Disco Elysium*) mit vollem, nuanciertem Farbraum und volumetrischem Licht.
    2. *Ebene 2 (Dramaturgische Intervention / 10–15% der Spielzeit):* Radikales Sin-City Chiaroscuro (Tusche-Schatten + 1 isolierter Colorkey) als gezielte Regie-Zäsur für Schockmomente (K-42 Mord-Indiz Blausäure-Smaragd), Trauma-Echos (Großvater-Laterne Bernstein), Stufe-3-Nahkampf (Karminrot) und Tribunale.
- **Dokumentation:** Vollständig synchronisiert in [`story.md`](apps/sample-apps/and-now/docs/story.md) und [`concept-dossier.html`](apps/sample-apps/and-now/docs/concept-dossier.html).

---

## 121. GitHub Pages Deployment & AssetManager Base-URL Resolution (2026-09-14)
- **Problem & Ursachenanalyse:**
  - Beim Deployment der Dokumentation und Showcases auf GitHub Pages unter dem Subpfad `/small-world-machine/showcases/` schlugen Asset-Requests für Texturen (`wall_tiles.jpg`), 3D-Modelle (`wall_lamp.glb`, `character.glb`) und UI-Kartenbilder mit einem HTTP 404 fehl.
  - Root-relative Pfade (`/assets/...`) wurden vom Browser relativ zur Domain-Root (`rottensteiner-stefan.github.io/assets/...`) statt zum Vite-Base-Pfad aufgelöst.
- **Zentrale Architektur-Lösung:**
  - [`AssetManager`](packages/engine/src/loaders/AssetManager.ts) um die Kern-Methode `resolveUrl(url: string): string` erweitert:
    - Löst root-relative Pfade (`/assets/...`) und bare relative Pfade automatisch gegen `import.meta.env.BASE_URL` (Vite-Build-Pfad) bzw. eine konfigurierte `_baseUrl` auf.
    - Absolute URLs (`http://`, `https://`, `//`) sowie explizit relative Pfade (`./`, `../`) bleiben unberührt.
    - Zentral verknüpft in `_fetchWithProgress`, `loadImage` (inkl. Fallback), `streamBinary` und allen Lade-Pipelines (`Texture.fromUrl`, `GltfLoader`).
  - [`ViennaMapModal.ts`](apps/sample-apps/and-now/ui/ViennaMapModal.ts): UI-Karten, Vignetten und Archetyp-Vorschaubilder mit `resolveAssetUrl` angebunden.
- **Verifikation:**
  - Neue Vitest-Suite [`AssetManagerResolveUrl.test.ts`](packages/engine/tests/loaders/AssetManagerResolveUrl.test.ts) hinzugefügt.
  - Alle 142 Testsuiten (782 Tests), `npm run typecheck`, `npm run lint:fix`, `npm run build:lib` und Vite-Build mit `--base=/small-world-machine/showcases/` **100% grün**.

---

## 122. VitePress Documentation Base Path Link Alignment (2026-09-14)
- **Problem & Ursachenanalyse:**
  - In der VitePress-Dokumentation (`docs/apps/*.md`) verlinkten Markdown-Tabellen für interaktive Szenen und Konzept-Dossiers direkt auf `/showcases/...` mit `{target="_blank"}`.
  - Da VitePress bei externen Links mit benutzerdefinierten Attributen den konfigurierten `base: "/small-world-machine/"` nicht automatisch voranstellt, löste der Browser den Link gegen die GitHub-Pages-Wurzel (`https://rottensteiner-stefan.github.io/showcases/...`) auf und lieferte einen 404-Fehler.
- **Lösung:**
  - Alle direkten Showcase- und Dossier-Links in [`docs/apps/and-now.md`](docs/apps/and-now.md), [`docs/apps/maker.md`](docs/apps/maker.md), [`docs/apps/yad.md`](docs/apps/yad.md) und [`docs/apps/light-cycle-arena.md`](docs/apps/light-cycle-arena.md) auf den vollen GitHub-Pages-Subpfad `/small-world-machine/showcases/...` aktualisiert.
- **Verifikation:**
  - `npm run docs:build` ausgeführt und die generierten HTML-Dateien in `docs/.vitepress/dist/apps/` erfolgreich auf korrekte Pfadauflösung geprüft.

---

## 123. WebGPU Swapchain Texture Lifecycle & Offscreen Target Fix (2026-09-14)
- **Problem & Ursachenanalyse:**
  - Im *Character Diorama Studio* trat beim Rendern / Ändern der Fenstergröße unter WebGPU folgender Laufzeitfehler auf:
    `Destroyed texture [Texture (unlabeled 1620x3128 px, TextureFormat::BGRA8Unorm)] used in a submit.`
  - **Root Cause 1:** In [`MainRenderPass.ts`](packages/engine/src/renderers/passes/MainRenderPass.ts) griff der Opaque-Texture-Capture für transparente Materialien (wie Wasserpfützen / Glas) über eine bedingte Abfrage fälschlich auf `renderer.gpuCanvasContext.getCurrentTexture()` zu, wenn kein HDR-Postprocessing aktiv war. Bei Offscreen-Renderdurchläufen (z.B. der Planar-Reflection-Kamera für die Pfützenreflexion in ein eigenes `RenderTarget`) wurde so die Swapchain-Textur des Canvas anstelle der Zieltextur des Offscreen-RenderTargets erfasst.
  - **Root Cause 2:** In [`WebGPURenderer.render()`](packages/engine/src/renderers/WebGPU/WebGPURenderer.ts) wurde `this._context.getCurrentTexture().createView()` bei JEDEM `render()`-Aufruf (auch bei Offscreen-Sub-Passes und HDR-Passes) vorschnell angefordert und anschließend verworfen. Kam es zwischen Sub-Passes zu Größenanpassungen, war die aufgenommene Swapchain-Textur bereits zerstört, bevor der CommandBuffer übergeben wurde.
- **Architektur-Lösung:**
  - `WebGPURenderer` um die Getter `public get activeColorTexture(): GPUTexture` und `public get activeDepthTexture(): GPUTexture` erweitert, die zuverlässig die Textur des aktiven RenderTargets bzw. `_hdrTexture` / Canvas-Swapchains liefern.
  - [`MainRenderPass.ts`](packages/engine/src/renderers/passes/MainRenderPass.ts) nutzt nun `renderer.activeColorTexture` für `captureOpaqueTexture`.
  - [`WebGPURenderer.render()`](packages/engine/src/renderers/WebGPU/WebGPURenderer.ts) ruft `getCurrentTexture().createView()` nur noch dann auf, wenn tatsächlich direkt auf den Swapchain-Framebuffer gezeichnet wird (`!isOffscreen && !postProcessing.enabled`).
- **Verifikation:**
  - Vitest-Suiten [`WebGPUOffscreenTargetFormat.test.ts`](packages/engine/tests/renderers/WebGPUOffscreenTargetFormat.test.ts) und [`MainRenderPass.test.ts`](packages/engine/tests/renderers/MainRenderPass.test.ts) erweitert.
  - Alle 142 Testsuiten (786 Tests), `typecheck`, `lint:fix`, `build:lib` und `docs:build` **100% grün**.

---

## 124. Etablierung des 4-Akte Golden Paths, Storyline-Präfix & Lore-Präzisierung (2026-09-15)
- **Kanonische Story-Architektur & Golden Path:**
  - Fixierung der linearen, kuratierten 4-Akte-Dramaturgie (*The Last of Us* trifft *Stray* im postapokalyptischen Wien) in [`story.md`](apps/sample-apps/and-now/docs/story.md) (Abschnitt 10):
    1. *Akt I (Flakturm Arenberg):* Abschied & Ausbruch (Koje 42 ➔ Kältekammer K-42 ➔ Asservatenkammer & Kaffeedose ➔ Druckschleuse).
    2. *Akt II (Zentrum & Kanäle):* Trümmer-Reise (Bermudadreieck ➔ Verzweigung Karlsplatz/Wienfluss ➔ Kapuzinergruft).
    3. *Akt III (Simmering & Zentralfriedhof):* Das heilige Gelübde („A schene Leich“ & Emotionaler Höhepunkt 1).
    4. *Akt IV (Rossauer Kaserne):* Die Abrechnung mit Hofrat Brandstätter & dem AZS-System (Höhepunkt 2).
- **Lore-Präzisierung & Widerspruchsfreiheit:**
  - *Welt vs. Protagonist:* Die Außenwelt existiert und kämpft bereits seit Jahrzehnten ums Überleben (etablierte Fraktionen, Schmuggelrouten, Hehler). **Novotny persönlich** war ihr/sein ganzes Leben lang in den tiefen Schächten des Bunkers Arenberg isoliert und hat noch nie den echten Himmel gesehen.
  - *Identität:* Der Nachname **Novotny** wird konsequent geschlechtsneutral geführt, um dem Spieler die freie Wahl der Identität zu ermöglichen.
- **Sparring-Konvention:**
  - Etablierung des `Storyline:`-Präfixes für spontane kreative Impulse und Regie-Anmerkungen.
- **Dokumentation & Schauplatz-Kanon:**
  - Vollständige Mermaid-Diagramme für Makro-Ablauf und Akt-I-Stage-Flow in [`story.md`](apps/sample-apps/and-now/docs/story.md) verankert.
  - Erweiterung des Schauplatz-Rosters auf **23 kanonische Schlüssel-Locations** (Hinzunahme von #21 *Rossauer Kaserne / AZS-HQ*, #22 *Café Hawelka & Dorotheergasse* und #23 *Prunksaal der Nationalbibliothek / Hofburg*).

---

## 125. Festlegung der „Wide-Linear“ Hub-and-Spoke Architektur (2026-09-15)
- **Design-Entscheidung & Scope-Kontrolle:**
  - Verwerfen sowohl von linearen Schläuchen (*The Last of Us* ohne Erkundung) als auch von aufblähenden 200-Stunden-Open-World-Sandkästen.
  - Etablierung des **Wide-Linear Hub-and-Spoke-Prinzips** (*Dishonored / Deus Ex / Metro Exodus*):
    - 1 eindeutiger, geführter **Golden Path** pro Akt / Bezirk (z.B. *Katakomben ➔ Bermudadreieck*).
    - 2–3 kompakte, optionale **Mikro-Erkundungs-Räume** (z.B. *Café Hawelka*, verlassener Würstelstand, U-Bahn-Notausstieg) auf 2–3 Straßenzügen.
    - Belohnung der Erkundung durch **„Smart Solutions“** (Abkürzungen, Schmiergeld-Relikte, Türcodes, Lüftungsschächte), die alternative, gewaltfreie Lösungswege eröffnen, ohne neuen Modellierungs-Overhead zu erzeugen.
- **Dokumentation:**
  - Vollständig in [`story.md`](apps/sample-apps/and-now/docs/story.md) (Abschnitt 10.A) integriert.

## 126. Story-Review & 2C-Festlegung: Die Treasure des Medaillons (2026-09-15)
- **Review etabliert:** Autoren-Kritik („Authoren-Hütchen") als lebendes Dokument [`story-review.md`](apps/sample-apps/and-now/docs/story-review.md) angelegt — Gesamturteil, Chronologie-Checks, drei Entscheidungspunkte, sortierte offene Fragen + sechs neue proaktive Fragen, Scope-Empfehlung, interaktiver Arbeitsplan.
- **Entscheidungspunkt 2C festgelegt (Treasure des Medaillons):**
  - **Brandstätter** ist ein Relikt und Architekt der alten Welt: planen/ausführte den finalen Schlag gemeinsam mit korrupten IAEA-Beamten, Diplomaten und Wirtschaftskapitänen (selbst ohne Nuklearzugang; orchestrierte die, die sie hatten; stieg im Vakuum auf). „Ost-West" = Wien als Spionage-/Diplomatie-Drehscheibe (CIA/KGB-Folklore als kulturelles Fundament). In der Rossauer Kaserne gibt es Archive, die selbst er nicht kennt/betreten kann (Ebene über ihm).
  - **Die Achse „Eine Welt, zwei Visionen":** Brandstätter beschloss, die alte Welt zu beenden und neu zu stempeln; František beschloss, ihre Wahrheit zu bewahren.
  - **František** war der „Eingeweihte wider Willen" — „Mädchen für alles" bei Brandstätter, installierte Kameras/Aufnahmegeräte, sammelte unbemerkt Schattenkopien, war zu klein zum Aufhalten, aber fähig, Beweise zu sichern.
  - **Das Medaillon** ist Františeks eigene heimliche Schattenkopie (die „technischen Eingeweide" = seine Arbeit) — das Erbstück der Bewahrung, Zwillingsstück zur Kaffeedosen-Urne.
  - **Dreigenerationen-Widerstandslinie:** Übergabe von Codes/Daten an den Sohn Fritz (AZS-Kanalspäher); František → Fritz → Novotny, willentlich oder nicht; Fritz' Verschwinden wird zum Widerstands-Opfer.

---

## 127. Vollständige Auflösung der Review-Entscheidungspunkte & Technik-Kanon (2026-09-15)
- **2A (Die D-Linie vs. Linie 71):**
  - Präzisierung auf Wiener Fakten: **Linie 71** ist die legendäre Friedhofs-Linie nach Simmering (*„den 71er nehmen“*). Novotny folgt den 71er-Gleisen in Akt III zur Beisetzung.
  - **Linie D** fuhr über den Ring / Oper (nahe Kapuzinergruft). Die gefundene Linie-D-Fahrkarte in Akt I führt exakt zur Kapuzinergruft.
- **2B (Rossauer Kaserne vs. UNO-City):**
  - **Rossau (Akt IV Finale):** Liefert Františeks persönliche Rache & Brandstätters Entmachtung durch das dechiffrierte Medaillon.
  - **UNO-City / IAEA:** Bleibt das globale Weltgeheimnis jenseits der Donau (Sequel / Epilog).
  - **Brandstätter-Motiv-Präzisierung (§2D, „vernichten" → „an der Weitergabe hindern"):** Brandstätter wollte das belastende Medaillon daran hindern, die Wahrheit ans Schatten-Netzwerk weiterzugeben. Als hübsches Schmuckstück ohne Tauschwert im hungrigen Wien fiel es in der Inventarliste nicht auf – er erkannte nicht, was der alte Laufbursche darin versteckt hatte. Erst als Novotny es aus der Asservatenkammer stiehlt, verbindet er die Punkte; erst dann wird die Verfolgung zur existenziellen Besessenheit.
- **2C-Split & Kapuzinergruft:**
  - Kapuzinergruft als toter Briefkasten der Familie Novotny und eines geheimen Schatten-Netzwerks. Enthält das Dechiffrier-Gegenstück und Hinweise auf Widerstandszellen im Umland (DLC-Seeds für Wienerwald & Semmering).
- **Drei-Generationen-Kanon:**
  - **Fritz Novotny (geb. ~2045):** War beim Schlag ~5 Jahre alt. Seine Erinnerung an echtes Sonnenlicht trieb ihn als Kanalspäher in die Unterwelt.
  - **Ober-Inspektor Pollak:** Brandstätters Ausführer im Flakturm Arenberg; setzte den Blausäure-Stich in K-42.
- **Geräte- & Technik-Realismus (Kein Cyberpunk, kein CRT-Anachronismus):**
  - **Amts-Terminal 2100:** Robustes Industrie-Handheld (gepanzertes Metall, flacher LC-Bildschirm mit Pixelfehlern, mechanische Klick-Tasten und Drehschalter, **kein Touchscreen**).
  - **Wiener Energie-Realismus:** Strom aus Donau-Wasserkraft (Freudenau/Nußdorf) und Windkraftanlagen; Biogas aus Gärung für Gaslaternen.
  - **Wiener Parks:** Dienen als atmosphärische, ressourcenschonende Atempause-Oasen zwischen Missionen.
  - **Starke Fraktions-Verdichtung:** Keine überfrachteten Fallout-Quest-Gilden, sondern kuratierte Barrieren entlang des Golden Path.

---

## 128. Festlegung des Titels: „The Whisper — A Viennese Requiem“ (2026-09-15)
- **Titel-Entscheidung & Philosophie:**
  - Der bisherige Arbeitstitel *„And Now?“* wird durch den vielschichtigen, stimmungsvollen Titel **„The Whisper — A Viennese Requiem“** (Dt.: *„Das Flüstern — Ein Wiener Requiem“*) abgelöst.
  - **Dramaturgischer Kernleitsatz:**
    > *„Drei Generationen hat es gebraucht, Brandstätter das Handwerk zu legen. Widerstand für das Gute — selbst wenn es das Leben kostet. Aber das ist okay, der Tod fühlt sich in Wien zu Hause.“*
  - **Doppelte Bedeutung von „The Whisper“:**
    1. Das leise, konspirative Flüstern des Drei-Generationen-Widerstands und der toten Briefkästen über 50 Jahre hinweg.
    2. Das Flüstern des Windes durch die zerstörten Kuppeln, die verrosteten 71er-Gleise und die Gruften der Stadt.
  - **Wirkung:** Hebt das Spiel über vordergründige Plot-Gimmicks hinaus auf das Niveau eines epischen, melancholischen Kammerspiels (*The Last of Us / Stray / Disco Elysium*) und spiegelt die sakrale, musikalische und würdevolle Natur von Novotnys Reise wider.
- **Dokumentation:**
  - Titel und Leitsatz als Fundament in [`story.md`](apps/sample-apps/and-now/docs/story.md) eingepflegt.

## 130. Storyline-Ausbau: Saubere Fischzucht & Algenanbau im Haus des Meeres (2026-09-15)
- **Erweiterung der Lebensader (`Storyline:`-Ausbau):**
  - Das saubere Wasser der Hochquellenleitung ermöglicht es, **saubere Fische in der Stadt zu züchten** – ein Luxus, den sich nur wenige leisten können. Alle anderen hoffen, beim Fischen keinen **verstrahlten Teufel aus der Donau** zu fangen.
  - **Das Haus des Meeres (Flakturm Esterházypark, Schauplatz #20)** ist der Betriebsort: Ein Teil des unverstrahlten Wassers speist die intakten Becken – hier findet **saubere Fischzucht und Algenanbau zu Nahrungszwecken** statt, als stiller Gegenpol zu den verstrahlten Donau-Fängen.
- **Dokumentation:** Fisch-Algen-Ökonomie als Unterpunkt der Kernsäule *„Die Lebensader"* sowie als *„Wirtschaftliche Rolle"* in [`story.md`](apps/sample-apps/and-now/docs/story.md) (§1 & Schauplatz #20) verankert.

## 131. Umbau: Haus des Meeres – Zweiteilung Oben/Unten & entschlackte Fauna (2026-09-15)
- **Lektor-Fix (Konsistenz mit der Fischzucht):** Die ursprünglich als *viridis* rein "Mutanten-Dungeon" beschriebene Zone lag quer zur sauberen Fischzucht. Aufgelöst durch klare Zweiteilung:
  - **Oben (das lebende Haus):** Intakte Ober- & Mittelstockwerke mit sauberer Fischzucht und Algenanbau, gehütet von der Kaste der **Beckenwärter**.
  - **Unten (der tote Sitz):** Geborstene Riesenbecken, brackiger Stalaktiten-Sumpf als gefährliche Durchgangszone nach oben.
  - **Kern (entschlackt):** Nur noch **eine Handvoll** skurriler, scheuer amphibischer Höhlenjäger in den tiefsten abgedichteten Becken – kein 11-stöckiges Monsterstockwerk.
- **Dokumentation:** Schauplatz #20 in [`story.md`](apps/sample-apps/and-now/docs/story.md) entsprechend umgebaut (Rolle, Zweiteilung Oben/Unten, Gameplay & Loot inkl. Zuchtfische).



## 129. Storyline-Impuls: Die 1. Wiener Hochquellenwasserleitung als Lebensader (2026-09-15)
- **Kanonischer Welt-Pfeiler (`Storyline:`-Impuls):**
  - Was 1873 zur Wiener Weltausstellung begann, entscheidet bis 2100, dass Wien noch immer Leben hervorbringt: Die **1. Wiener Hochquellenwasserleitung** bringt **frisches Wasser aus über 100 km entfernten Bergen** (Rax, Schneeberg) – trotz Fallout und Strahlung.
  - Dieses Wasser ist **mehr wert als alles Gold der Erde** – die Grundlage, um Nahrung anzubauen und Tiere zu tränken. Wer die Leitung kontrolliert, kontrolliert das Überleben der Stadt (stilles Machtzentrum, das alle Fraktionen umschmeicheln und heimlich umkämpfen).
  - Die Quelle in den Bergen ist der narrative Keim des DLC *„Der Weiße Quell"* – die Reise zum reinsten, letzten unverstrahlten Brunnen der alten Welt.
  - **Vertiefung (Hygiene & Würde):** Das Wasser gibt den Menschen außerdem etwas zum **Trinken, Waschen und zur Hygiene** – die stillen Selbstverständlichkeiten halten Krankheit und Verzweiflung fern und sind ein Ausdruck von Würde (Gegenbild zur Bunkergrippe aus verunreinigter Umluft).
- **Dokumentation:** Als neue Kernsäule *„Die Lebensader"* in [`story.md`](apps/sample-apps/and-now/docs/story.md) (§1) verankert, ohne Bruch zu bestehendem Kanon (Bunkerfilter, Aschenbrenner, DLC „Weißer Quell").



### 132. Milestone 1 Vertical Slice: Spielbarer Prolog (Koje 42 ➔ Kältekammer K-42) (2026-09-16)
- **Umsetzung & Gameplay-Features:**
  - **Interaktive Erkundung & 2.5D-Bühnen-Steuerung:**
    - Nach Ablauf des 60-Sekunden-Intros (oder sofortigem Überspringen via `[LEERTASTE]` / HUD-Button) wechselt die Szene in den freien Erkundungsmodus.
    - Novotny lässt sich mit `WASD` / Pfeiltasten innerhalb der Raumgrenzen von Koje 42 steuern, inklusive geschmeidiger Blickrichtungs-Interpolation und dynamischem Laternenlicht-Flickern.
  - **Hotspot- & Monolog-System ([`HotspotManager.ts`](apps/sample-apps/and-now/ui/HotspotManager.ts)):**
    - Automatischer Proximity-Check für interaktive Schlüsselobjekte (`[E]` Prompt Overlay).
    - *Koje 42 Hotspots:* Großvater Františeks Kaffeemühle (Nussbaum/Messing mit Zündholz-Versteck), Stockbett, versiegeltes Amts-Terminal 2100, verriegelte Flur-Panzertür und das gelöste Lüftungsgitter.
    - *Sin-City Noir Caption Box:* Mehrseitige, stimmungsvolle innere Monologe im düsteren Graphic-Novel-Look mit bernsteinfarbenen Akzenten.
  - **Sektor 0 / Kältekammer K-42 & Colorkey-Moment:**
    - Durchklettern des Lüftungsgitters initiiert den nahtlosen Übergang in den gefrierenden Leichenkeller (Sektor 0).
    - 3D-Leichenschubladen (K-40 bis K-44), Ammoniak-Kühlrohre mit Frostpartikeln und die herausgezogene Wanne **Fach K-42** mit Františeks Leichnam.
    - **Sin-City Colorkey Shock (🟢 Smaragdgrüner Blausäure-Einstich):** Bei Untersuchung von Fach K-42 fokussiert ein smaragdgrüner Spotlight den Hals und entlarvt den Mord durch Ober-Inspektor Pollak / Hofrat Brandstätter.
    - Dynamische Aktualisierung des Auftrags-Banners: *„Asservatenkammer infiltrieren & Františeks Medaillon vor der Kompostierung bergen!“*
  - **Vollständige Taktik-HUD & Modal-Verdrahtung:**
    - `[T]` / Button öffnet das Amts-Terminal 2100 (`TerminalModal`) mit Sterbefall-Akte GZ 2100-AZS/0815, Auto-Journal und Dosimetrie.
    - `[M]` / Button öffnet Großvaters handgezeichneten Faltplan (`ViennaMapModal`).
    - Titel & Hub-Einträge konsistent auf **„The Whisper — A Viennese Requiem“** harmonisiert.
- **QA & Test-Coverage:**
  - Neue Testsuite [`HotspotManager.test.ts`](apps/sample-apps/and-now/tests/HotspotManager.test.ts) hinzugefügt.
  - 144 Testsuiten (793 Tests) 100% grün, `npm run typecheck`, `npm run lint` und `npm run build:lib` fehlerfrei.

---

## 133. Asset-Sourcing- & Textur-Doktrin: Open Sources, Handvoll-Regel & Hybrider Ansatz (2026-09-16)
- **Modell- & Prop-Sourcing:**
  - *Grundsatz:* Freie Online-Quellen (Poly Haven, ambientCG, Kenney, Sketchfab CC0) werden aktiv genutzt, statt Standard-Requisiten zeitaufwändig manuell neu zu bauen.
  - *Handvoll-Regel:* Stets **3 bis 5 Kandidaten** gegeneinander testen, bevor eine finale Auswahl getroffen oder etwas selbst konstruiert wird.
  - *Tripo3D API:* Bleibt primäre Schnittstelle für maßgeschneiderte Low-Poly-Geometrie aus 2D-Konzeptzeichnungen.
- **Textur-Strategie (Hybrid-Benchmark):**
  - *Große Basispakete (CC0):* ambientCG und Poly Haven liefern physikalisch saubere Grund-PBR-Maps (Normal, Roughness, AO) für Beton, Asphalt, Backstein, Rost und Holz.
  - *Noir-Stilisierung:* Der Engine-eigene Post-Processing-Pipeline (`OutlinePass`, ACES Filmic, Chiaroscuro) überzieht alle Texturen mit dem einheitlichen Graphic-Novel-Look.
  - *Signature Props:* Narrative Schlüssel-Assets (Kaffeedose, Amts-Terminal, Blausäure-Decals, Wiener Straßenschilder) werden gezielt hochauflösend und maßgeschneidert selbst erstellt.
- **Dokumentation:** Festgehalten in [`.agents/notes/asset-sourcing-guideline.md`](.agents/notes/asset-sourcing-guideline.md).

---

## 134. Option B: Bunker Kit PBR Expansion (Stockbett & Kältekammer K-42) (2026-09-16)
- **Asset-Veredelung gemäß „Handvoll-Regel“:**
  - **Stockbett (Koje 42):**
    - 3 Konzept-Kandidaten generiert (*Military Angle-Iron*, *Industrial Bolted Frame*, *Flakturm Standard Tier Bunk*).
    - Sieger-Modell: *Flakturm Standard Tier Bunk* mit geschweißtem Stahlrahmen, dünnen Matratzen, Militär-Wolldecken und Ausrüstungsregal.
    - Generiert via Tripo3D API und konvertiert via `fbx2gltf` nach [`public/assets/kits/bunker/bunk_bed/model.glb`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/public/assets/kits/bunker/bunk_bed/model.glb) (1.57 MB).
  - **Kältekammer Leichenschublade K-42 (Sektor 0):**
    - 3 Konzept-Kandidaten generiert (*Cold Storage Drawer K-42*, *Autopsy Wheeled Gurney*, *Brutalist Shrouded Tray*).
    - Sieger-Modell: *Cold Storage Drawer K-42* mit gebürstetem Edelstahl, gefrorener Kondensation, Leichen-Silhouette und forensischem Zehen-Anhänger `K-42`.
    - Generiert via Tripo3D API und konvertiert via `fbx2gltf` nach [`public/assets/kits/bunker/morgue_tray/model.glb`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/public/assets/kits/bunker/morgue_tray/model.glb) (1.14 MB).
- **Runtime-Ingestion in Prologue-Szene ([`prologue.ts`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/apps/sample-apps/and-now/scenes/prologue/prologue.ts)):**
  - Automatischer Austausch der prozeduralen Whitebox-Primitive durch die neuen glTF-Kits in `_loadPropKits()`.
  - PBR-Shader-Tuning (`roughness`, `metallic`) abgestimmt auf Graphic-Noir Outline- & Chiaroscuro-PostProcessing.
  - Manifest [`public/assets/kits/bunker/kit.json`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/public/assets/kits/bunker/kit.json) und Metadaten aktualisiert.
- **QA:** 144 Testsuiten (793 Tests) 100% grün, `npm run typecheck`, `npm run lint` und `npm run build:lib` fehlerfrei.

---

## 135. Vienna Flakturm PBR Kit: Texturen, Stencils, Decals & Modulare Requisiten (2026-09-16)
- **Vollständige PBR-Textur-Sets ([`public/assets/kits/flakturm/textures/`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/public/assets/kits/flakturm/textures/)):**
  - `concrete_board`: Brettschalungs-Beton mit horizontalen Holzmaserungen, Schalungsfugen und Poren (Albedo, Normal, Roughness, AO).
  - `brick_aged`: Altwiener Ziegelmauerwerk mit Mörtelfugen und Kalkausblühungen (Albedo, Normal, Roughness, AO).
  - `concrete_weathered`: Monumentaler Außenbeton mit vertikalen Wassernasen & Rußstreifen (Albedo, Normal, Roughness, AO).
  - `steel_corroded`: Korrodierter Walz- und Panzerstahl mit Rostflecken (Albedo, Normal, Roughness, Metalness, AO).
  - `steel_painted`: Lackierter olivgrauer Bunker-Stahl mit Kratzern & Nieten (Albedo, Normal, Roughness, Metalness, AO).
- **Decals & Stencils ([`public/assets/kits/flakturm/decals/`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/public/assets/kits/flakturm/decals/)):**
  - `sign_hausangehoerige.png`: Typografischer Stencil *"NUR FÜR HAUSANGEHÖRIGE!"* (authentische historische Vorlage).
  - `sign_sektor0.png`: AZS-Dienstplakette *"SEKTOR 0 — KÄLTEKAMMER / ZUTRITT STRENGSTENS UNTERSAGT"*.
  - `sign_koje42.png`: Zonen-Kennzeichnung *"KOJE 42 / FLAKTURM ARENBERG"*.
  - `hazard_stripes.png`: 45°-Gelb/Schwarz-Sicherheits-Warnstreifen mit Kantenabplatzungen.
  - `guide_stripe_glow.png`: Phosphoreszierender Leitstreifen für Orientierung bei Bunkerausfall.
  - `rebar_damage.png`: Wanddurchbruch mit herausragenden Bewehrungsschlaufen (Moniereisen).
- **3D-Modelle & Modulare Generatoren ([`FlakturmKit.ts`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/apps/sample-apps/and-now/builder/FlakturmKit.ts)):**
  - [`bunker_blast_door/model.glb`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/public/assets/kits/flakturm/props/bunker_blast_door/model.glb) (1.03 MB): Zweiflügelige schwere Panzer-Stahltür mit Querverriegelung und Sehschlitzen.
  - [`debris_rubble_pile/model.glb`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/public/assets/kits/flakturm/props/debris_rubble_pile/model.glb) (1.57 MB): Haufen aus zerbrochenem Beton, Ziegelbrocken und Moniereisen.
  - `FlakturmKit.createFluorescentLamp`: Modulare Industrie-Leuchtstoffleuchten (Käfig-Wannenleuchte & nackte Röhre) mit integriertem Licht und Flackern.
  - `FlakturmKit.createConduitRun`: Modulare Aufputzkabel mit Bakelit-Verteilerdosen und Wandschellen.
- **QA:** 145 Testsuiten (797 Tests) 100% grün, Testsuite [`FlakturmKit.test.ts`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/apps/sample-apps/and-now/tests/FlakturmKit.test.ts) hinzugefügt.

---

## 136. Flakturm Gitter-Schachttür (Ventilation & Escape Mesh Hatch) (2026-09-16)
- **Analyse & Asset-Herkunft ([`flakturm_ref_18.jpg`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/.agents/scratches/Flaktum/flakturm_ref_18.jpg)):**
  - Entdeckung der charakteristischen, in Brusthöhe in die Ziegelwand eingelassenen quadratischen Stahl-Gitterklappe mit Drahtgeflecht, die in einen dunklen Schleich-/Versorgungsschacht führt.
- **Asset-Umsetzung:**
  - **3D glTF Modell:** [`bunker_vent_hatch/model.glb`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/public/assets/kits/flakturm/props/bunker_vent_hatch/model.glb) (995 KB) via Tripo3D & `fbx2gltf` erstellt.
  - **Prozeduraler Generator:** `FlakturmKit.createVentHatch({ width, height, openAngle })` in [`FlakturmKit.ts`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/apps/sample-apps/and-now/builder/FlakturmKit.ts) mit animierbarem Scharnier (`DoorHinge`), Wandzarge, Riegel und Drahtgitter-Geflecht implementiert.
  - Manifest [`public/assets/kits/flakturm/kit.json`](file:///Users/srottensteiner/PhpstormProjects/small-world-machine/public/assets/kits/flakturm/kit.json) und Tests aktualisiert.
- **QA:** 145 Testsuiten (798 Tests) 100% grün.

---

## 137. Bunker-Kit QS-Pass: Morgue-Tray-Geometrie & Decal-Qualität (2026-09-16)
- **Anlass:** Review der Bunker-Kit-Ergebnisse gegen die echten Flakturm-Referenzfotos
  (`.agents/scratches/Flaktum/`). Texturen & `terminal_2100` wurden als gelungen bestätigt;
  zwei konkrete Qualitätsmängel gefunden und behoben.
- **Bug 1 — Morgue-Tray-Geometrie (Tripo3D-Modell):** `morgue_tray/model.glb` hatte Griff +
  ID-Plakette an allen vier Seiten der Schublade — unsinnig, da real nur das Kopfende (das aus
  der Wand herausragt) einen Griff trägt; die Längsseiten sind offen/zugänglich, die Rückseite
  (Fußende der Leiche) steckt im Wandschrank und ist nie zu sehen. Da Tripo3D nur einen einzigen
  gemergten Mesh-Node ohne Teile-Trennung liefert, war eine chirurgische Korrektur unmöglich.
  - **Fix:** Neuer prozeduraler Builder `BunkerKit.createMorgueTray()`
    (`apps/sample-apps/and-now/builder/BunkerKit.ts`, analog zu `FlakturmKit.ts`) —
    Griff + ID-Plakette (Decal-Textur) sitzen konstruktiv nur am Kopfende (+Z), die
    Längsseiten (`SideRim_0/1`) und das Fußende (`FootEndCap`) bleiben blank. Zwei benannte
    Sockets (`NeckSpotlightTarget`, `ToeTag`) für szenenspezifisches Dressing (Leichentuch,
    Zyanid-Decal) exportiert.
  - `prologue.ts`: `_buildKaeltekammer()` nutzt jetzt `BunkerKit.createMorgueTray()` statt der
    alten flachen Slab-Platzhalter-Box; `_loadPropKits()` lädt nur noch die ID-Plakette
    (`sign_koje42.png`) als Textur nach, statt das fehlerhafte GLB zu laden.
  - Fehlerhaftes Asset entfernt: `public/assets/kits/bunker/morgue_tray/` (Modell + Tripo-Rohdaten)
    gelöscht, Eintrag aus `bunker/kit.json` entfernt (Prop ist jetzt reiner Code wie
    `FlakturmKit`s prozedurale Requisiten).
  - Neue Testsuite `tests/BunkerKit.test.ts`: verifiziert, dass Griff/Plakette ausschließlich am
    Kopfende sitzen und die Sockets korrekt exponiert werden.
  - **Visuell verifiziert** im laufenden Dev-Server (Debug-Kamera-Teleport via `_loop()`,
    `CameraStrategyType.MANUAL`): Plakette „KOJE 42 / FLAKTURM ARENBERG" + Griff nur am
    Kopfende sichtbar, Seiten und Fußende bestätigt blank.
- **Bug 2 — Decal-Qualität ("MS Paint"-Bitmap-Font):** `sign_hausangehoerige.png`,
  `sign_sektor0.png` und `sign_koje42.png` waren in einer winzigen, blockig-pixeligen
  Bitmap-Schrift gerendert (kein Antialiasing); `sign_sektor0.png` schnitt den Warntext
  zusätzlich am Rand ab. `guide_stripe_glow.png` war nur ein flacher, kontrastloser
  Rausch-Fleck ohne erkennbares Leitstreifen-Muster.
  - **Fix:** Alle vier Decals mit echten TrueType-Fonts (Rockwell Bold, Arial Black/Bold) bei
    4x Zielauflösung neu gerendert und mit LANCZOS herunterskaliert (saubere Kanten statt
    Pixel-Treppen), inkl. Verwitterung (Rost-Bleeding an Schraubenlöchern, Schmutz-Drips,
    gebürstetes Metall) und korrektem Textumbruch. `guide_stripe_glow.png` zeigt jetzt ein
    gerichtetes Chevron-Muster mit Glow-Bloom und Abnutzungsflecken.
  - Generator-Skript nicht im Repo (lag im git-ignorten Scratchpad) — bei Bedarf erneut
    schreiben (Pillow + Rockwell.ttc/Arial Black, 4x Supersampling).
- **Weitere Textur-Durchsicht (Wände/Türen, auf Wunsch):** `concrete_board`, `concrete_weathered`
  und `brick_aged` halten gegen die Referenzfotos gut stand. `steel_corroded` (Rost wirkt als
  großflächige Cluster-Noise-Blobs, wenig fotografisch) und `steel_painted` (rein flache Farbe
  mit Kratzern, keine Nieten trotz Beschreibung) sind spürbar schwächer — bewusst nicht
  angefasst, um keine Inkonsistenz zwischen neuer Albedo und bestehender Normal-Map
  einzuführen; als Kandidat für einen eigenen, dedizierten Nachschärf-Pass vorgemerkt.
- **QA:** 146 Testsuiten (801 Tests) 100% grün, `npx tsc --noEmit`, `npm run lint` und
  `npm run build:lib` fehlerfrei.

---

## 138. Flakturm-Textur-Set: Voller Nachschärf-Pass (alle 5 Materialien) (2026-09-16)
- **Anlass:** Nachfolge zu #137 — auf Wunsch auch `steel_corroded`/`steel_painted` sowie
  Beton/Ziegel überarbeitet, statt nur die zuvor als schwach identifizierten Sets stehen zu
  lassen. Ziegel sollten außerdem sichtbar beschädigt/abgesplittert wirken (Nachkriegsruine).
- **Diagnose (warum ein reiner Albedo-Fix nicht reicht):** Bei `steel_corroded` lagen Rost-Flecken
  in der Albedo, Rauheit und Metallness auf drei **nicht korrelierten** Rausch-Mustern —
  Rauheit/Metallness waren zudem identisch statt invers zueinander. Ein isolierter Albedo-Fix
  hätte diese Inkonsistenz nur verschoben, nicht behoben.
- **Lösung — kohärente Neugenerierung aller Kanäle aus einer gemeinsamen Maske je Material**
  (Pillow + NumPy, nicht im Repo — git-ignorter Scratchpad, bei Bedarf neu schreiben):
  - **Rauschen:** Erste Fassung nutzte eine Summe zufälliger Sinuswellen für exakt kachelbares
    Rauschen — zu wenige Wellen pro Oktave erzeugten aber ein sichtbares diagonales Moiré/Gewebe.
    Ersetzt durch spektral geformtes FFT-Rauschen (gefiltertes weißes Rauschen im Frequenzraum),
    isotrop und exakt periodisch ohne Nachbearbeitung.
  - **Präzise Flächenkontrolle:** Schadens-/Rostflächen werden per Perzentil-Schwellwert
    (`np.quantile`) auf eine exakte Ziel-Flächendeckung kalibriert, statt auf einen festen
    Schwellwert zu raten, der je nach Rauschverteilung stark schwankt.
  - **Höhen→Normal-Konvertierung:** Ein gemeinsames Height-Field pro Material wird per
    zentraler Differenz (wrap-safe via `np.roll`) in die Normal-Map umgerechnet, sodass Bump,
    Rauheit, Metallness und AO immer zur selben zugrunde liegenden Struktur gehören.
  - **`steel_corroded`:** Rost jetzt als spärliche Flecken (~5 % Saat) mit dünnen, vertikal
    abtropfenden Rostschlieren (Schwerkraft-Streaking) statt großflächiger Cluster-Blobs;
    Rauheit/Metallness invers und deckungsgleich zur Rost-Maske.
  - **`steel_painted`:** Echtes Nietenraster (kachelbar, radialer Dome-Normal-Bump), echte
    lineare Kratzer (gezeichnete Liniensegmente statt Rausch-Höhenlinien, die wie Kontur-Wirbel
    aussahen), sparsame Lackabplatzer mit dünnem Rost-Saum an der Bruchkante.
  - **`concrete_weathered`:** Der alte Riss-Ansatz (Kontur-Band um ein Blob-Level) erzeugte
    geschlossene Comic-Umrandungen um die Flecken; ersetzt durch echte dünne, dichte
    Haarriss-Sprenkel; Ruß-/Wasserschlieren beibehalten und verfeinert.
  - **`brick_aged`:** Vollständig neu mit echtem Läufer-Verband (versetzte Fugen), 5 %
    komplett fehlende Steine (Kavität mit Schutt-Textur statt Vollschwarz), ~28 % der Steine mit
    abgeplatzten Ecken/Kanten, feine verzweigte Haarrisse (Ridge-Noise statt Kontur-Band-Bug),
    Ausblühungs-Flecken (helle Mineralablagerung) und Ruß-Streaking — deckt explizit den
    Wunsch „Ziegel sollen auch kaputt/abgesplittert wirken" ab.
  - **`concrete_board`:** Bereits solide, nur Ruß-/Wasserschlieren verfeinert.
  - **Türen:** Werden laut [`kit.json`](public/assets/kits/flakturm/kit.json) über
    `steel_corroded`/`steel_painted` texturiert — damit über den Steel-Pass mit abgedeckt.
- **Verifikation:** Alle 5×4–5 Kanäle (Albedo/Normal/Roughness/[Metalness]/AO) einzeln visuell
  geprüft (Kohärenz zwischen Kanälen, keine Moiré-Artefakte, 512×512 RGB Format erhalten).
  Nicht live im Renderer verifiziert — keines der 5 Materialien ist bisher in einer Szene
  verdrahtet (reine Kit-Assets wie die Flakturm-Props, siehe #135/#136).
- **QA:** 146 Testsuiten (801 Tests) weiterhin grün (reine Asset-Änderung, kein Code).

---

## 139. Analyse `scripts/pbr.sh`: defekt, Engine hat den korrekten Ersatz schon (2026-09-16)
- **Anlass:** Hinweis, `scripts/pbr.sh` (ImageMagick-CLI, Photo→PBR-Ableitung) für die
  Textur-Arbeit aus #138 zu prüfen und zu testen.
- **Befund — Tool ist defekt in dieser Umgebung:** Der „Normal"-Schritt
  (`-bias 50% -convolve '0,-1,0,-1,0,1,0,1,0' -solarize 50% -level 50%,0%`) kollabiert auf ein
  fast-flaches, fast-schwarzes **Einzelkanal**-Ergebnis — unabhängig von Input oder
  `NORM_STRENGTH` (getestet bis 500 %). Verifiziert an drei Inputs: meiner Rost-Albedo, meiner
  Ziegel-Albedo, und zur Kontrolle an einem trivialen sauberen Schwarz-Weiß-Verlauf (härtester,
  einfachster Testfall) — auch dort bricht es. Kein Tuning-Problem, sondern strukturell falsch:
  es gibt keine getrennte X/Y-zu-R/G-Kanal-Kodierung, also wäre es selbst korrigiert keine
  standardkonforme Tangent-Space-Normal-Map. Roughness/Specular/AO kollabieren ebenso auf
  fast-flache Werte. Vermutete Ursache: Skript für `magick` (ImageMagick 7) geschrieben, hier ist
  aber nur `convert` (IM 6.9.13 Q16) installiert — andere Prozent-/Quantum-Semantik.
- **Besserer, bereits vorhandener Ersatz gefunden:** [`TextureFilters.ts`](packages/engine/src/tools/common/dsp/TextureFilters.ts)
  — die reinen Funktionen hinter dem MaterialStudio-Tool (`generateHeightMap`,
  `generateNormalMap`, `generateSpecularMap`, `generateRoughnessMap`, `generateAOMap`,
  `generateEdgeMap`). Per `tsx` + `pngjs` headless (ohne Browser) direkt getestet: echter
  Sobel-Normal-Encoder, korrekt um Mittelgrau/Blau zentriert mit echtem Signal — kein Kollaps.
  Roughness/Specular brauchen pro Material einen passenden `threshold` (sehr dunkle Albedo
  braucht viel niedrigeren `specThresh` als der Default) — normales Parameter-Tuning, kein Bug.
- **Entscheidung:** `pbr.sh` NICHT verwendet. Die in #138 bereits deployten, aus einer
  gemeinsamen Maske pro Material kohärent abgeleiteten Texturen bleiben unverändert — sie
  garantieren durch Konstruktion korrekte physikalische Korrelation zwischen den Kanälen.
  `TextureFilters.ts` wäre der richtige Kandidat für zukünftige Arbeit an einer echten
  Foto-Albedo (dort passt „hell = erhöht" tatsächlich), nicht für meine synthetischen Albedos
  (Risiko invertierter Bumps, z. B. helle aber physisch vertiefte Mörtelfugen).
- **Dokumentation:** Projekt-Memory `project_pbr_sh_broken` angelegt.

---

## 140. Korrektur zu #139: `pbr.sh` ist unabhängig von der ImageMagick-Version defekt (2026-09-16)
- **Anlass:** Nutzer hat echtes ImageMagick 7 (`magick`) via MacPorts installiert
  (`/opt/local/lib/ImageMagick7/bin/magick`, IM 7.1.2-30) — Re-Test der #139-Vermutung
  ("vermutlich IM6-vs-7-Kompatibilität").
- **Ergebnis: Vermutung war falsch.** Mit dem echten `magick`-Binary reproduziert sich exakt
  derselbe Kollaps (Normal-Map weiterhin nahezu schwarz/einkanalig, AO weiterhin ~0/255).
  Schrittweise durch die Operator-Kette auf dem Verlaufs-Testbild verfolgt: `-solarize 50%`
  invertiert jeden Wert über der 50 %-Mitte (ein Höhenfeld-Gradient kann aber legitim auf beiden
  Seiten der Mitte landen — das faltet eine Vorzeichen-Hälfte des Signals auf die andere), und
  `-level 50%,0%` hat Schwarz-/Weißpunkt vertauscht, was das ohnehin schon nach unten gefaltete
  Ergebnis zusätzlich in ein enges dunkles Band presst. Das ist ein Logikfehler in der
  Operator-Kette selbst, unabhängig von IM6 oder IM7. Roughness/Specular (einfache
  Sigmoidal-Contrast-/Gamma-Transforms ohne `solarize`) zeigten unter echtem IM7 an einem
  kontrastreicheren Testbild spürbar mehr Varianz — die sind nicht strukturell kaputt.
- **Entscheidung bleibt:** `pbr.sh` weiterhin nicht verwendet; `TextureFilters.ts` bleibt der
  richtige Kandidat für einen künftigen Foto-Albedo-Workflow.
- **Dokumentation:** `project_pbr_sh_broken`-Memory korrigiert (Abschnitt „Why" ersetzt statt
  nur ergänzt, damit die veraltete IM6-vs-7-Vermutung nicht als Tatsache stehen bleibt).

---

## 141. Echte Nietengeometrie fürs Terminal-2100-Modell (2026-09-16)
- **Anlass:** Die Case-/Bezel-Schrauben aus dem Concept-Art
  (`public/assets/kits/bunker/terminal_2100/preview.jpg`) hat Tripo3D nur in die Normal-Map
  gebacken (Fake-Bump per Licht, keine echte Silhouette) — auf Wunsch als echte 3D-Geometrie
  ergänzt, analog zum Morgue-Tray-Fix (#134/#137): Tripo liefert nur einen einzigen gemergten
  Mesh-Node, also keine chirurgische Bearbeitung möglich, stattdessen Ergänzung per Code.
- **Neue Bausteine in [`BunkerKit.ts`](apps/sample-apps/and-now/builder/BunkerKit.ts):**
  `createRivet()` (Schlitzschrauben-Kopf), `createBoltArray()` (Set an (x,y,z)-Positionen),
  `createTerminalBoltSet()` (8 Nieten: 4 Case-Ecken + 4 Bildschirm-Bezel-Ecken).
- **Stolperstein — Tripo-Modell ist eine verzerrte „Pille", keine flache Platte:** Die
  `meta.json`-Maße (0,38 × 0,52 × 0,15) stimmen nicht mit der echten Mesh-Geometrie überein;
  die Tripo-Rekonstruktion aus einem Einzelbild hat die Tiefe massiv aufgebläht (echte
  Halb-Extents ≈ 0,235 × 0,396 × 0,499 — Tiefe ist die GRÖSSTE statt der kleinsten Dimension).
  Mit den dokumentierten Maßen wären die Nieten ~6× zu tief im Modell vergraben gewesen.
  **Fix:** Neue Helper-Methode `_measureLocalHalfExtents()` in `prologue.ts` misst die
  tatsächliche Bounding-Box am geladenen Mesh (inkl. des intern verschachtelten
  Tripo/FBX-Korrekturfaktors ×100) statt der Doku zu vertrauen. Nieten werden zusätzlich per
  Ellipsoid-Projektion (`z = halfDepth·√(1−x²/halfWidth²−y²/halfHeight²)`) auf die tatsächliche
  gerundete Oberfläche gesetzt statt auf eine flache Ebene.
- **Visuell verifiziert** im laufenden Dev-Server (gleiche Debug-Kamera-Teleport-Technik wie
  bei #137): Nieten sitzen sichtbar als echte, Licht-reagierende 3D-Beulen mit Schlitz-Detail
  auf der realen Oberfläche — nicht vergraben, nicht schwebend.
- **QA:** 146 Testsuiten (804 Tests) grün, `tsc --noEmit`, `lint` und `build:lib` fehlerfrei.
  Drei neue Tests in `BunkerKit.test.ts` (Rivet-Struktur, Bolt-Array-Positionierung,
  Terminal-Bolt-Set innerhalb der realen Halb-Extents).

---

## 142. Kit-Texturen & FlakturmKit-Requisiten erstmals in der Szene verdrahtet (2026-09-16)
- **Anlass:** Bisher war der gesamte Textur-/Requisiten-Katalog aus #135/#138 reines
  unverdrahtetes Kit-Material (siehe Bestandsaufnahme oben). Jetzt erstmals in `prologue.ts`
  in Betrieb genommen.
- **Neue Methode `_applyKitTextures()`** (aufgerufen nach `_loadPropKits()`, nicht parallel dazu
  — dazu gleich mehr): lädt alle 5 Flakturm-Texturs-Sets und mutiert die bereits vorhandenen,
  von mehreren Whitebox-Meshes geteilten `StandardMaterial`-Instanzen direkt (ein Fund reicht,
  da z. B. `concreteWallMat` schon von BackWall/Ceiling/RightWall/LeftWallTop geteilt wird).
  Jede Fläche bekommt eine eigene `Texture.fromImage()`-Kopie mit individuellem `repeat`, damit
  unterschiedlich große Wände nicht dieselbe UV-Kachel-Dichte erzwungen bekommen.
  - **Zwei kleine Material-Splits nötig:** `LeftWallBack`/`LeftWallFront` (Türlaibung) und
    `BedPost_0..3` teilten sich vorher `concreteWallMat` bzw. `rustSteelMat` mit Wänden bzw.
    der Panzertür — aufgeteilt in eigene `brickWallMat`/`paintedSteelMat`-Instanzen, damit sie
    unabhängig `brick_aged` bzw. `steel_painted` statt `concrete_board`/`steel_corroded`
    bekommen können.
  - **Zuordnung:** `concrete_board` → Koje-42-Wände/Decke/Boden; `brick_aged` → Türlaibung;
    `concrete_weathered` → Kältekammer-Boden/Rückwand; `steel_corroded` → Panzertür +
    Lüftungsgitter; `steel_painted` → Bettpfosten (Fallback), Schubladen-Rack, Morgue-Tray.
- **Bug gefunden & gefixt — Race Condition:** `_loadPropKits()` und `_applyKitTextures()` liefen
  zuerst parallel (`void`/`void`). `_loadPropKits()` ersetzt aber `this._bunkBedMesh` durch das
  geladene `bunk_bed.glb` (entfernt den prozeduralen Platzhalter mit `BedPost_0..3` aus der
  Szene) — je nach Timing lief die Textur-Anwendung auf dem bereits entfernten Platzhalter ins
  Leere. Gefixt durch Sequenzierung (`await _loadPropKits()` vor `await _applyKitTextures()`);
  jetzt ist das Verhalten deterministisch (kein Fehler, korrekt wirkungslos im Erfolgsfall, da
  das echte GLB eigene Materialien mitbringt — greift aber korrekt, falls das GLB-Laden
  fehlschlägt und der Platzhalter sichtbar bleibt).
- **Neue Requisiten aus `FlakturmKit.ts` erstmals platziert** (vorher nur in
  `FlakturmKit.test.ts` verifiziert, nie in einer Szene benutzt):
  - `createFluorescentLamp()` ersetzt die nackten `PointLight`-Deckenlampen in Koje 42 und
    Kältekammer durch echte Käfig-Leuchtstoffröhren-Fixtures (Licht + Geometrie im selben
    Objekt).
  - `createConduitRun()` — Aufputzkabel mit Verteilerdosen an der Koje-42-Rückwand.
  - `createDebrisCluster()` — Schutthaufen in der Kältekammer-Ecke.
- **Visuell verifiziert** im laufenden Dev-Server: Ziegel-Türlaibung, Rost-Streifen auf der
  Panzertür, Beton-Schalungsstruktur an der Decke, Käfigleuchte, Schutthaufen und
  Beton-Sprenkelung im Kältekammer-Boden alle sichtbar bestätigt; alle 8 texturierten
  Zielobjekte per Skript auf `diffuseMap`-Vorhandensein gegengeprüft.
- **QA:** 146 Testsuiten (804 Tests) grün, `tsc --noEmit`, `lint` und `build:lib` fehlerfrei.

### 135. Koje 42 3D-Prop-Library & Kit-Erweiterung via Tripo3D (2026-09-18)
- **Konzept-zu-3D Pipeline für Koje 42 abgeschlossen:**
  - Aus den 4 Graphic-Noir Raumansichten wurden 10 isolierte 3D-Modellierungsreferenzen generiert und in `.agents/scratches/tripo_refs/` archiviert.
  - Alle 10 Requisiten wurden per Tripo3D in game-ready Low-Poly `.glb`-Meshes mit vollständigen PBR-Texturen konvertiert und katalogisiert:
    1. `bunker/metal_stool`: Desolater Industrie-Metallhocker mit abgenutztem Sitz.
    2. `bunker/kerosene_lantern`: Františeks Messing-Kerosinlaterne mit `FlameGlow` Light-Socket.
    3. `bunker/combat_boots`: Novotnys abgetretene Schnürstiefel mit Profilsohle.
    4. `bunker/metal_desk`: Schwerer olivgrüner Schreibtisch mit Schublade.
    5. `bunker/wall_shelf_supplies`: Rustikales Holz-Wandregal mit gefalteten Wollpullovern.
    6. `bunker/mess_tin_set`: Bunker-Blechgeschirr (Emaille-Tasse, 2 Teller, Besteck).
    7. `bunker/hanging_towels`: Wandleiste mit Schmiedehaken & fleckigen Leinentüchern.
    8. `bunker/worn_rug`: Verschlissener Orient-Teppich für die Südwand.
    9. `flakturm/ceiling_lamp`: Gusseiserne Bunker-Wannenleuchte mit Schutzgitter & `BulbLight`-Socket.
    10. `flakturm/vent_wall_breach`: Flakturm-Lüftungsschacht-Kasten mit aufklappbarem Lamellengitter (Fluchtweg).
- **Kit-Standards & ADR 0011 eingehalten:**
  - Alle Props besitzen valide `meta.json`-Dateien und Vorschau-Bilder (`preview.jpg`).
  - `public/assets/kits/bunker/kit.json` und `public/assets/kits/flakturm/kit.json` vollständig aktualisiert.
  - `AssetKitValidation.test.ts` verifiziert alle 33 Tests zu 100% grün.
- **QA:** `build:lib`, `lint` und alle 146 Testsuiten (832 Tests) fehlerfrei bestanden.

### 136. Koje 42 Szenen-Integration: 10 Modular Props & Fluchtschacht (2026-09-18)
- **Vollständige 3D-Szenenbestückung in `prologue.ts`:**
  - `_loadPropKits()` lädt alle 10 neuen modularen glTF-Assets (`metal_desk`, `metal_stool`, `kerosene_lantern`, `combat_boots`, `wall_shelf_supplies`, `mess_tin_set`, `hanging_towels`, `worn_rug`, `ceiling_lamp`, `vent_wall_breach`) parallel zu den bestehenden Props (`coffee_grinder`, `terminal_2100`, `bunk_bed`).
  - **Beleuchtungs-Sockets & Dynamik:**
    - `kerosene_lantern` erhält warmen `FlameGlow`-PointLight (`#d49a3d`, 2.5 Intensity) mit feinem Flackern im Render-Loop.
    - `ceiling_lamp` erhält kühlen Industrie-`BulbLight`-PointLight (`#dbe8f5`, 2.0 Intensity).
  - **Lüftungsschacht-Platzierung (Fluchtweg):**
    - `vent_wall_breach` an der Ostwand (gegenüber der Panzertür) bodennah bei `(2.38, 0.35, 0.8)` platziert (`rotation.y = -Math.PI / 2`).
  - **Interaktive Hotspots & Story-Dressing:**
    - Hotspot-Array um Františeks Arbeitsplatz (`desk_supplies`), Lager & Stiefel (`bed`), Kaffeemühle (`grinder`), Amts-Terminal (`terminal`), Panzertür (`door`) und Geheimen Fluchtschacht (`vent`) präzisiert.
- **QA & Build-Status:**
  - 146 Testsuiten (835 Tests) zu 100% grün.
  - `npm run lint` und `npm run build:lib` fehlerfrei.

### 137. Deklarative Level-Deskriptoren (`koje42.level.json`), Engine `KitRegistry` & Schema-Validierung (2026-09-18)
- **Architektur-Meilenstein (ADR 0020 & Masterplan 0):**
  - Vollständiger Übergang von imperativen, hartkodierten TypeScript-Szenen zu deklarativen Level-Deskriptoren (`*.level.json`) und automatischer Kit-Metadaten-Verarbeitung.
- **Engine-Erweiterung (`KitRegistry`):**
  - Neue Schnittstelle `KitRegistry` in `packages/engine/src/loaders/kit/KitRegistry.ts` (Dependency Injection, instanzbasiert, strikt kein globaler Singleton).
  - Automatisches Auslesen von `meta.json` (`recommendedScale`, Sockets wie `FlameGlow`, `BulbLight` mit automatischer `PointLight`/`SpotLight`-Erzeugung).
  - Zweistufige Hierarchie: Prefab-Defaults aus `meta.json` vs. Instanz-Overrides aus `.level.json` (`lightOverrides`, `materialOverrides`).
  - Unit-Tests: `packages/engine/tests/loaders/KitRegistry.test.ts` (5/5 Tests grün).
- **Level-Schema & Validierung:**
  - `public/schemas/level.schema.json` (JSON Schema Draft 2020-12) definiert formale Spezifikation für Level (`props`, `lights`, `hotspots`, `stageZone`, `environment`).
  - Unit-Tests: `packages/engine/tests/loaders/LevelValidation.test.ts` validiert Schemakonformität via Ajv (4/4 Tests grün).
- **Deklarative Koje 42 (`koje42.level.json`):**
  - Vollständige Extraktion aller 12 Props, Wandlichter, Scheinwerfer und 6 interaktiven Story-Hotspots aus `prologue.ts` in `koje42.level.json`.
- **Refactoring `prologue.ts`:**
  - Trennung von Dressing (JSON) und Story-Controller (TypeScript).
  - Laden des Raums über `await this._kitRegistry.loadLevel("/scenes/prologue/koje42.level.json", this.scene)`.
  - Dynamische Bindung von Level-Hotspots (`open_terminal`, `transition_kaeltekammer`).
- **QA & Build:**
  - 148 Testsuiten (844 Tests) zu 100% grün.
  - `npm run lint` (0 Fehler, 0 Warnungen) und `npm run build:lib` fehlerfrei.
### 138. Thermo-Nuclear Code Quality Review: Blocker-Sanierung & Release v0.82.0 (2026-09-18)
- **Repository-Weite Blocker-Bereinigung (P0):**
  - **[BLK-R1]**: Puffer-Reallokation in `WebGLClusterCullPass` entkoppelt und Zuweisungs-Desyncs bei Clustered Lighting behoben.
  - **[BLK-R2]**: Out-of-Bounds Spot Shadow Array-Zugriffe in WGSL (`lighting.wgsl`, `lighting_pbr.wgsl`) und GLSL (`light_calc.frag.glsl`, `light_calc_pbr.frag.glsl`) abgesichert.
  - **[BLK-R3]**: 60-FPS WebGPU Pipeline-Rebuild Churn im Post-Processing (`BloomPassGPU`, `PostProcessPass`) durch Texture-View Caching eliminiert.
  - **[BLK-R4]**: Stale Directional-Light-Referenzen in `AbstractRenderer.extractLights()` beim Ausblenden von Sonnenlichtern bereinigt.
  - **[BLK-R5]**: Fallback-Kaskade (`WebGPU` $\to$ `WebGL2` $\to$ `WebGL1`) in `RendererFactory` gegen Driver-Blocklists und Kontextfehler gehärtet.
  - **[BLK-C1]**: 2D GPU-Textur- und Ref-Count-Lecks bei `WebGLTextureManager.dispose()` behoben.
  - **[BLK-C2]**: Physics Broadphase Octree Bounds Aktualisierung (`PhysicsBroadphase.update()`) für dynamisch wandernde Collider korrigiert.
  - **[BLK-C3]**: `Matrix4.scale()` Overload-Signaturen und Fallback-Validierung für aufrufende Codes ohne `target` repariert.
- **QA & Build-Status:**
  - 150 Testsuiten (865 Tests) zu 100% grün.
  - `npm run typecheck`, `npm run lint` und `npm run build:lib` fehlerfrei.
  - Version Bump auf `0.82.0`.



## 139. Asset-First-Refactor Koje 42 & Kältekammer: Kit-Props statt Greybox (2026-09-29)
- **Anlass:** Mit inzwischen 3 vollen Asset-Kits ist es Zeit, Assets konsequent in der Szene
  einzusetzen statt prozeduralen Fallback zu pflegen. User-Auftrag: „Koje 42 endlich damit
  stücken, das Programmatische entfernen/reduzieren."
- **Deklarative Level-Bestückung repariert (P0-Bug):** `koje42.level.json` wurde zwar geladen,
  aber der absolute URL-Pfad `/scenes/prologue/koje42.level.json` 404'te still in Dev **und**
  Build — d.h. seit dem Umstieg auf Level-Deskriptoren (Eintrag 137) stand die Koje faktisch
  **ohne** die Kit-Möbel da (nur Architektur + imperativ geladene Props). Fix: Laden über
  Vite-`new URL("./…", import.meta.url)` — funktioniert jetzt zuverlässig in Dev und Build.
  Ebenso neues `kaeltekammer.level.json` (Wandschutt + kalte Deckenleuchte), an die
  Morgue-Gruppe gebunden.
- **Prozeduralen Fallback entfernt (−197 Zeilen netto in `prologue.ts`):** Schreibtisch,
  Hocker, Laterne, Kaffeemühle, Regal, Handtücher, Stockbett, Stiefel, Teppich, Terminal,
  Lüftungsgitter, Deckenleuchte — alle früheren Cube-Prozedur-Platzhalter gelöscht. Die
  Bestückung kommt ausschließlich über die echten glTF-Kit-Props (`koje42.level.json`). Auch
  die prozedurale Leuchtstoff-Duplikat-Deckenleuchte und die Remove-Bookkeeping-Logik
  (`this.scene.remove(...)`) entfielen.
- **Kältekammer K-42:** `FlakturmKit.createDebrisCluster` und die prozedurale Kalt-
  Leuchtstoffröhre durch Kit-Props (`debris_rubble_pile`, `ceiling_lamp` kalt) ersetzt.
  Laugeflächen-Wechsel auf das morgue-taugliche `concrete_damp_efflorescence`-Kit-Material.
- **Blast-Door-Asset-Erkenntnis (QS-pflichtig):** `flakturm/bunker_blast_door` rendert bei
  `recommendedScale` als fast-würfelförmiger Block (~0.92×1.0×0.94m, gemessen via
  Bounding-Volume + Vertex-Normalen) statt der Meta-Angabe 1.8×2.2×0.25m — die Dokumentation
  des Assets ist unzuverlässig (Tripo3D-Quirk). Nachtrag in `backlog.md` als Asset-QS-Punkt.
- **Entscheidung Tür:** Die Blast-Door wird als **statische** geschlossene Panzertür montiert
  (Vorderfläche bündig zur Innenwand, Überlauf-Tiefe verschwindet im nicht-modellierten Flur);
  das „Tür öffnet sich" der Timeline wird als **Lichtstrahl-Choreografie** erzählt
  (Flur-Spot-Licht wird breiter/heller + subtiler Vorwärts-Creak), statt eine en-masse-
  Drehbewegung des würfelförmigen Blocks zu erzwingen.
- **Fail-Fast statt stummem Greybox:** Fehlende Kit-Props melden sich jetzt mit
  `console.error` (markiert den genauen Level/Bereich), nicht mehr unsichtbar.
- **QA:** 201 Testdateien / 1194 Tests grün, inkl. Schema-Validierung beider Level-Deskriptoren
  und Kit-Manifest-Referenzprüfung; `typecheck`, `lint` und `build:lib` fehlerfrei.
  Visuell im Dev-Server verifiziert (alle 17 Kit-Props im Objektbaum, Render-Frame nicht schwarz).

## 140. Kit-Decals in der Szene — Beschilderung & Materialschäden aus den vorhandenen Assets (2026-09-29)
- **Auftrag:** Weiter im Asset-First-Programm — die bislang ungenutzten Flakturm-Decal-Assets
  endlich in der Szene einsetzen statt auf weitere prozedurale Deko zu setzen.
- **Umgesetzt (statisch, alle aus `flakturm/decals/`):**
  - KOJE 42: „Koje 42"-Wand-Stencil am Türbereich (linke Backsteinwand, flipX gegen die
    Planen-Spiegelung der +Y-Drehung) + „Nur für Hausangehörige!"-Schild an der Rückwand
    unterhalb der Konduit-Bande.
  - KÄLTEKAMMER: „AZS – Sektor 0"-Badge über dem Fächerschrank, Beton-/Bewehrungs-Schaden an
    der Rückwand über dem Schutt, 45°-Warnzone auf dem Boden vor der herausgezogenen K-42-Lade,
    und ein leuchtender Guidance-Streifen entlang des Mittelgangs Richtung Ausgang (Textur ist
    quer, daher lange Streifenachse per gekapselter Rotation auf Z gelegt).
- **Technische Erkenntnis:** Die Engine hat kein Decal-System — Decals = transparente Ebenen
  (Plane + StandardMaterial mit `diffuseMap = alphaMap`, `transparent=true` →
  depthWrite automatisch aus, `cullMode=NONE`). Für die +X-Wand muss die Textur via
  `Texture.flipX()` gegengespielt werden (Y-Achsen-Drehung spiegelt den Stencil).
- **QA:** Alle 6 Decals im Dev-Server verifiziert (Material geladen 512px, korrekte
  Welt-Achsen: Schild-Normalen zum Raum, Streifen lang auf Z, y=0.006 über dem Boden), keine
  Console-Fehler. 201 Testdateien grün; der einzige Rote (`SDFShaderChunks` isContextLost) ist
  bekannte WebGPU-Last-Flakiness (isoliert grün), nicht Decal-bedingt.

## 143. T1 – Panzertür-Neubau: `bunker_blast_door_leaf` als animierbares Einzelblatt (2026-10-12)
- **Auftrag (kollaboratives Rework `rework-scene`, Task T1):** Der alte Flügel (9,6 MB GLB,
  11,3k Tris, überstehende Tragösen + verschmolzener Radeinbau + wellige Kanten, Log 139)
  wird ersetzt — die Timeline-Tür soll real per Flügel-Animation öffnen statt Licht-Choreo.
- **Generierungs-Versuch-und-Irrtum (gesamte Iteration dokumentiert im Core-Board F19):**
  Text-to-3D liefert bei drei unabhängigen Versuchen (Modelle P1 & v3.1-20260211) konsistent
  zu dicke, klobige Blöcke (0,5–0,8 m tief) mit Überständen über der Oberkante bzw. ohne
  Rad/Sehschlitz. Der projektübliche Image-to-3D-Pfad (`seedream_v4`-Referenz ohne Rahmen →
  `tripo generate image-to-model`, face_limit 9000) liefert das qualitativ richtige Ergebnis:
  **isoliertes Einzelblatt**, gerade Hard-Surface-Kanten, keine Oberkanten-Überstände,
   4-Speichen-Schließrad + Sehschlitz + Scharnierknuckles, saubere manifold Geometrie.
- **Moderator-Entscheidungen (verbindlich, im Board F20):** (1) Freigabe des v4-Blattes als
  Basis-Flügel; (2) zweiter Flügel = **gespiegeltes Duplikat** (`scale.x=-1`) — kein zweites
  Asset; (3) Tiefe per **nicht-uniformer Z-Skalierung** beim Placing in die Wand; (4) **[OPEN]**
  Doppelseitige Tür-Lesbarkeit für spätere Korridor-Level (Backface aktuell flach) — in
  `meta.json`-Description dokumentiert.
- **Technische Kenndaten:** 7.593 Tris (Tier-3-konform, ADR 0011 §1.1), GLB 2,2 MB (< 3-MB-
  Schranke; eingebettete PBR-Textur bewusst beibehalten, da sie den freigegebenen Look trägt).
  Datei-Einheiten = 0,5× der Aufstellgröße: gemessen 0,354×0,998×0,666 m (Tiefe inkl. Rad-Nabe);
  `recommendedScale 2.0` → ~0,708×1,996 m; `HingePivot`-Socket bei x=−0,177 (Datei-Einheiten,
  skaliert mit; = äußere Scharnierkante) für die T1b-Flügel-Rotation.
- **Verpackung:** `model.glb` (2,2 MB) + `meta.json` v2.0.0 + `preview.jpg` ersetzt; `kit.json`
  aktualisiert; Grandfathered-Baseline in `AssetKitValidation.test.ts` auf die neuen
  Messwerte (7593 Tris / 2.231.512 B verringert (bisher 11.333/10.034.536).
- **Verifikation:** `AssetKitValidation.test.ts` 36/36 grün, `npm run lint:fix`, `build:lib`,
  voller Testlauf 260 Dateien / 1668 Tests grün. Laufzeit-Inspektion in der Szene
  (`window.__prologue`) + Peer-Plausibilitäts-Review folgen mit T1b (Tür-Animation).
- **Offen:** T1b (Flügel-Rotation um `HingePivot`, Timeline-Beat als echte Flügel-Animation),
  Peer-Review des Assets, doppelseitige Variante [OPEN].

## 144. T1b – Panzertür-Flügel-Animation verdrahtet & live verifiziert (2026-10-12)
- **Umgesetzt in `prologue.ts`:** beide Flügel (`bunker_blast_door_leaf`) werden per
  `loadProp` geladen, der rechte Spiegel-Flügel (`scale.x=-1`, `[0,π/2,0]`, Tiefe 0,35) an
  Scharnier-Pivots (`BlastDoorHingeLeft` z=+0,708 / `Right` z=−0,708 bei x=−2,385 y=0,95)
  montiert, `cullMode NONE` (Moderator-Entscheidung [OPEN] Doppelseitigkeit). Neue
  `_DOOR_OPEN_ANGLE = π·⅖`; `update()` rotiert die Pivots um
  `openness · Winkel · Richtung` (Timeline-Beat schiebt `_targetDoorAngle = −π/4,5`),
  Licht-Beam bleibt als Stütz-Atmosphäre.
- **Live-Leitplanke (Board F23 „RENDER BLOCKER" später widerrufen, s. u.):** Messreihe über
  `window.__prologue`: geschlossen AABB L z∈[0…0,708], R z∈[−0,708…0], offen rotieren Pivots
  ±1,257 rad (~72°), Flügel schwingen in den unmodellierten Korridor (−X), Türdurchgang frei.
- **„Unsichtbare Tür" = Mess-Phantom:** temporäre Engine-Instrumentierung belegte, dass der
  Mesh jeden Frame in den Opaque-Batch gelangt und ein gültiger Indexed-Draw (count 22.779,
  EBO) mit fehlerfreier Weltmatrix (kein NaN) ausgeführt wird. Sichtprüfung über die
  Vision-Bridge scheiterte zunächst, weil dunkler Stahl auf dunkler Wand unterbelichtet ist;
  nach korrektem Setzen einer echten `Color`-Instanz als `emissiveColor` und mit halb
  geöffneten Flügeln (je 36°) wiesen Screenshots die **sichtbar angeschrägten Flügel** nach
  (Vision: „left door slab is angled inward (open)") — die Tür hat stets gerendert.
- **Hinweis an die Engine-Lane:** weißes Identifikations-Schild oberhalb des Türrahmens
  rendert gespiegelt/auf dem Kopf (Phase-B-Prop, nicht T1b) — offen für später.
- **Verifikation:** `npm run lint:fix`, `typecheck`, `build:lib`, voller Testlauf 267 Dateien /
  1726 Tests grün; Session-Mailbox (`session-mailbox`-Skill) aktiv: Claim+pfadbezogener
  Commit der eigenen Pfade, Debug-Instrumentierung in `Scene.ts`/`WebGL2Renderer.ts` entfernt
  (beide Dateien wieder HEAD-sauber), `rendererType` wieder `BEST`.
- **Offen:** Sichtbarkeit der offenen Tür im Beat-Frame (Standard-Beat-Kamera blickt auf
  x≈−1,2; die geöffnete Tür liegt bei x≈−2,4 weit links — Kamera-/Inszenierungsentscheidung),
  Peer-Review des Assets, doppelseitige Variante [OPEN].

## 145. Prologue: sechs Plane-Decals → echte Decals (ADR 0029) (2026-10-12)

- **Migration:** die sechs `StandardMaterial`-Planes aus `_placeSceneDecals` (Koje-42-Stencil, „Nur für Hausangehörige", Sektor-0-Plakette, Rebar-Schaden, Warnzone, Leucht-Guidance) sind jetzt `decals[]` in `koje42.level.json` / `kaeltekammer.level.json` (Kältekammer relativ zur Morgue-Gruppe). `_createDecalPlane`/`_placeSceneDecals` und der `Plane`-Import entfallen. Standardgrößen (`size` = [Breite, Höhe, Tiefe]) stehen in `flakturm/kit.json`.
- **Ausrichtung:** Wand-Decals `rotation [π/2, yaw, 0]` (Normale +Z bzw. +X), Boden-Decals ohne Rotation, Guidance-Streifen `[0, π/2, 0]`. `flipX()` am Koje-Stencil entfällt (Decal-UV ist aufrecht); Texture-Repeat/Offset werden ignoriert.
- **Sicht geprüft** (Prologue im Browser, `window.__prologue`): alle sechs Decals im Decal-Pfad (`renderList.decals` = 6), „KOJE 42", „NUR FÜR HAUSANGEHÖRIGE" und „AZS · SEKTOR 0" aufrecht und nicht gespiegelt, Streifen läuft entlang der Raumachse. Warnzone/Rebar nur grob gesichtet, kein Pixelvergleich mit dem Altzustand.
- **Loader-Fix:** `KitRegistry` setzte `scale` aus `size` als (w, h, d); die Projektionsachse ist aber Y. Jetzt (w, d, h).
- **Offen:** Tiefe 0,5 m an den Wänden projiziert auch auf Props nahe der Wand (Regal vor dem Hausangehörigen-Schild); bei Bedarf Tiefe pro Platzierung verkleinern.

## 146. Tür-Aufräumrunde: Beat-Kamera-Nudge, [OPEN]-Schluss, T1-Peer-Review, Schild-Befund (2026-10-12)

- **Item 1 (Beat-2-Kamera):** Look-Ziel des Tür-open-Beats (Phase 2) von `(-1.2, 1.2, 0)` auf
  `(-2.05, 1.1, 0.0)` gedreht (Kamera-Position unverändert). Hintergrund: Der Open-Moment lag
  vorher außerhalb des Bildes — die echte Flügel-Animation wäre unsichtbar geblieben. Live
  verifiziert: Panzertür im Beat-Frame (links/mitte-links, ca. halbe Rahmenhöhe), Beam spielt
  ein, Raumkontext (Charakter, Schreibtisch, Betten) bleibt sichtbar.
- **Item 2 (doppelseitige Tür [OPEN] geschlossen):** Live bestimmt: beide Leaf-Materialien
  `cullMode="none"` UND `getRenderManifest().state.culling="none"`; `WebGL2Renderer` deaktiviert
  bei NONE-Culling `GL_CULL_FACE` beim Draw (Z. 1316 ff.) → Rückseiten werden rastiert. Die
  flache, unbelichtete Rückseite ist die dokumentierte Moderator-Konzession, kein Culling-Fehler.
  Pixel-Okklusionstests waren wegen des unmodellierten (schwarzen) Flurs nicht trennend.
- **Item 3 (T1-Peer-Review PASS):** Unabhängige Dateiprüfung `model.glb`: glTF2, Länge 2.231.512 B
  == deklariert, 1 Node/1 Mesh/1 Material/3 eingebettete Texturen (keine externen URIs), 0 Anim/
  Skins; 22.779 Indizes/3 = exakt 7.593 Tris (Tier-3), 10.036 Vertices, POSITION/NORMAL/
  TEXCOORD_0; Primitive-min `[-0.177, -0.499, -0.333]` = HingePivot-Socket verankert, Maße
  deckungsgleich mit `meta.json`. Review-Punkt aus Log 143 aufgelöst.
- **Item 4 (gespiegeltes Schild):** Diagnose (Lesen, keine Fremddatei-Beschreibung): Der Koje-42-
  Schild las geradeaus normal, schräg/fern spiegelig und erschien in Nahaufnahme nicht am
  deklarierten Level-Punkt — Artefakt der laufenden Decal-Migration des Kollegen (uncommitteter
  Größen-Mapping-Fix + Platzierung). Durch **Log 145** (bbfe9c19) behoben; Besitzer bestätigte
  alle Decals aufrecht. Formaler Board-Schluss unter Verweis auf 145.
- **Verifikation:** `lint:fix`, `typecheck`, `build:lib`, 267 Dateien / 1726 Tests grün;
  Commit `648b3772` (Nudge, path-scoped); Session-Mailbox aktiv (Koordination, Claims des
  Kollegen respektiert, Item-4-Handoff).
