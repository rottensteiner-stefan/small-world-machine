import { isEditingTextInput } from "@small-world-machine/engine";

export type MapLocationStatus = "available" | "current" | "locked" | "in_development" | "target";

export function resolveAssetUrl(path?: string): string {
  if (!path) return "";
  const isAbsolute =
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("//") ||
    path.startsWith("blob:") ||
    path.startsWith("data:");
  if (isAbsolute) return path;

  const base =
    (typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
    "";
  if (base && base !== "./") {
    if (path.startsWith("/")) {
      return base.endsWith("/") ? base + path.substring(1) : base + "/" + path.substring(1);
    } else if (!path.startsWith("./") && !path.startsWith("../")) {
      return base.endsWith("/") ? base + path : base + "/" + path;
    }
  }
  return path;
}

export interface MapLocation {
  id: string;
  title: string;
  district: string;
  subtitle: string;
  faction: string;
  factionColor: string;
  xPercent: number;
  yPercent: number;
  status: MapLocationStatus;
  statusLabel: string;
  targetUrl?: string;
  grandfatherNote: string;
  transitText: string;
  threatLevel: "Sicher" | "Mittel" | "Tödlich" | "Sperrzone" | "Neutral";
  conceptImage?: string;
  archetypeImage?: string;
  archetypeRole?: string;
  archetypeQuote?: string;
}

export const VIENNA_LOCATIONS: MapLocation[] = [
  {
    id: "flakturm_arenberg",
    title: "Flakturm Arenbergpark",
    district: "3. Bezirk (Landstraße)",
    subtitle: "Szene 2 // Versorgungstunnel & Treppenaufgang",
    faction: "AZS-Vorposten & Zivilsektor",
    factionColor: "#38bdf8",
    xPercent: 71,
    yPercent: 61,
    status: "available",
    statusLabel: "ERKUNDBAR",
    targetUrl: "../flakturm-tunnel/index.html",
    grandfatherNote:
      "„Der alte Gefechtsturm hält noch. Die Schleusenwache lässt sich mit Filterkaffee bestechen, aber im Tunnel nach Simmering steht das Grundwasser knietief.“",
    transitText:
      "Zwei Stunden durch den abgesoffenen U3-Versorgungsschacht. Nur das stete Tropfen von der Decke und das ferne Summen der Schleusenlüftung begleiten Novotnys Schritte.",
    threatLevel: "Mittel",
    conceptImage: "/assets/the-whisper/concepts/proto_azs_schleusenwache.jpg",
    archetypeImage: "/assets/the-whisper/concepts/proto_azs_schleusenwache.jpg",
    archetypeRole: "Die Schleusenwache (Ordnungsdienst)",
    archetypeQuote: "„Passierschein 7b vorweisen oder sofort auf den Boden!“",
  },
  {
    id: "koje_42",
    title: "Koje 42 (Großvaters Quartier)",
    district: "3. Bezirk (Flakturm-Tiefbunker)",
    subtitle: "Szene 1 // Der Prolog & Großvaters Vermächtnis",
    faction: "AZS-Zivilschutzverwaltung",
    factionColor: "#94a3b8",
    xPercent: 63,
    yPercent: 61,
    status: "available",
    statusLabel: "ERKUNDBAR",
    targetUrl: "../prologue/index.html",
    grandfatherNote:
      "„Hier hat alles begonnen. Die alte Kaffeedose mit meiner Asche steht unter der Pritsche. Trag sie zum Zentralfriedhof, Bub. Schenk mir a schene Leich.“",
    transitText:
      "Novotny steigt die engen Wendeltreppen in den feuchten Wohnsektor 4 hinab. Der Gestank von Karbid und muffigem Linoleum erfüllt die Luft.",
    threatLevel: "Sicher",
    conceptImage: "/assets/the-whisper/concepts/proto_pompfinebrer_kondukteur.jpg",
  },
  {
    id: "bermudadreieck",
    title: "Das Bermudadreieck",
    district: "1. Bezirk (Innere Stadt)",
    subtitle: "Historische Kellergewölbe // Alchimisten-Labor",
    faction: "Die Giftmischer (Pharma-Netzwerk)",
    factionColor: "#a855f7",
    xPercent: 48,
    yPercent: 36,
    status: "in_development",
    statusLabel: "IN ENTWICKLUNG",
    grandfatherNote:
      "„Die Giftmischer hüten das letzte Penicillin und Narkosemittel. Meister Stephanus' uralte Destillen laufen noch. Trau den Sanitätern nicht – sie spüren keinen Schmerz.“",
    transitText:
      "Über die eingestürzten Kellergewölbe der Rotenturmstraße ins feuchte, nach Schwefel riechende Labyrinth des Bermudadreiecks.",
    threatLevel: "Mittel",
    conceptImage: "/assets/the-whisper/concepts/concept_bermudadreieck.jpg",
    archetypeImage: "/assets/the-whisper/concepts/proto_giftmischer_dekanin.jpg",
    archetypeRole: "Die Dekanin (Meister-Toxikologin)",
    archetypeQuote:
      "„Penicillin gegen sauberes Grundwasser. Wer nicht zahlen kann, kriegt den Schmerzblocker erst, wenn das Bein schon ab ist.“",
  },
  {
    id: "prater_riesenrad",
    title: "Wurstelprater & Riesenrad",
    district: "2. Bezirk (Leopoldstadt)",
    subtitle: "Die Kasperl-Bastei & Schwarzmarkt-Spielhöllen",
    faction: "Ringelspiel-Syndikat",
    factionColor: "#f59e0b",
    xPercent: 75,
    yPercent: 24,
    status: "in_development",
    statusLabel: "IN ENTWICKLUNG",
    grandfatherNote:
      "„Die Kasperl-Bande bewacht die Dieselgeneratoren mit nagelbewehrten Pritschen und Schrotflinten. Schau den Croupiers niemals zu lang in die Augen.“",
    transitText:
      "Entlang der verrosteten Praterstern-Überführung. Das ferne, klagende Quietschen des Riesenrads schneidet durch den Nebel.",
    threatLevel: "Tödlich",
    conceptImage: "/assets/the-whisper/concepts/concept_prater.jpg",
    archetypeImage: "/assets/the-whisper/concepts/proto_ringelspiel_baron.jpg",
    archetypeRole: "Der Hutschmeister (Syndikat-Pate)",
    archetypeQuote: "„Am Prater gewinnt immer die Bank, Bursche.“",
  },
  {
    id: "rossauer_kaserne",
    title: "Rossauer Kaserne (Das Super-Amt)",
    district: "9. Bezirk (Alsergrund)",
    subtitle: "AZS-Hauptquartier // Die Festung der Bürokratie",
    faction: "Amt für Zivilschutz (Hofrat Brandstätter)",
    factionColor: "#ef4444",
    xPercent: 32,
    yPercent: 32,
    status: "locked",
    statusLabel: "SPERRZONE // ENDSPIEL",
    grandfatherNote:
      "„Brandstätters Hochburg. Ziegelmauern wie ein Monolith am Donaukanal. Hier laufen alle Fäden und die mörderischen AZS-Quoten zusammen. Geh erst dorthin, wenn die Asche begraben ist.“",
    transitText:
      "Vorbei an den Maschinengewehr-Nestern des Donaukanals. Scheinwerfer tasten die dunklen Ziegelfassaden der Kaserne ab.",
    threatLevel: "Sperrzone",
    conceptImage: "/assets/the-whisper/concepts/concept_rossauer_kaserne.jpg",
    archetypeImage: "/assets/the-whisper/concepts/proto_azs_brandstaetter.jpg",
    archetypeRole: "Hofrat Brandstätter (Sektionschef)",
    archetypeQuote: "„Biomasse gehört in den Ofen. Widerspruch zwecklos.“",
  },
  {
    id: "zentralfriedhof",
    title: "Wiener Zentralfriedhof (Tor 2)",
    district: "11. Bezirk (Simmering)",
    subtitle: "Ehrengräber & Krematorium // Ziel der Odyssee",
    faction: "Die Pompfinebrer (Bestatter-Gemeinde)",
    factionColor: "#10b981",
    xPercent: 84,
    yPercent: 84,
    status: "target",
    statusLabel: "HAUPTZIEL // A SCHENE LEICH",
    grandfatherNote:
      "„Tor 2. Bei den alten Lindenbäumen. Die Schaufler tragen Frack und Schrotflinte. Wenn du ihnen mit Respekt begegnest, öffnen sie die geweite Friedhofserde.“",
    transitText:
      "Fünf endlose Kilometer über die staubigen Gleistrassen von Simmering gen Süden, dem Weihrauchnebel der Bestatter entgegen.",
    threatLevel: "Neutral",
    conceptImage: "/assets/the-whisper/concepts/concept_zentralfriedhof.jpg",
    archetypeImage: "/assets/the-whisper/concepts/proto_pompfinebrer_schaufler.jpg",
    archetypeRole: "Der Schaufler (Friedhofswächter)",
    archetypeQuote: "„Für AZS-Spione graben wir sechs Fuß tief.“",
  },
  {
    id: "safehouse_schellein",
    title: "Safehouse Schelleingasse",
    district: "4. Bezirk (Wieden / Hbf)",
    subtitle: "Verlassene Studentenwohnung // Creator Echo",
    faction: "Unabhängiger Zufluchtsort",
    factionColor: "#cbd5e1",
    xPercent: 23,
    yPercent: 80,
    status: "in_development",
    statusLabel: "IN ENTWICKLUNG",
    grandfatherNote:
      "„Eine verstaubte Altbauwohnung nahe dem alten Hauptbahnhof. Unter den Dielen liegen alte Manuskripte eines gewissen S.R. aus den 1990ern. Ein friedlicher Ort.“",
    transitText:
      "Novotny kriecht durch den verbarrikadierten Lichtschacht in das stille, efeuumrankte Refugium der Schelleingasse.",
    threatLevel: "Sicher",
  },
  {
    id: "palais_metternich",
    title: "Palais Metternich (Das Konsulat)",
    district: "3. Bezirk (Botschaftsviertel)",
    subtitle: "Kaiserliche Ruinen // Die Diplomatenkaste",
    faction: "Das Konsulat (Diplomaten & Chiffreure)",
    factionColor: "#eab308",
    xPercent: 56,
    yPercent: 52,
    status: "in_development",
    statusLabel: "IN ENTWICKLUNG",
    grandfatherNote:
      "„Die Herren Diplomaten im Frack. Kalt wie Hundeschnauzen. Zahlen mit Vorkriegsgold und schallgedämpften Pistolen, wenn du ihre toten Briefkästen in den Friedhofsengeln leerst.“",
    transitText:
      "Durch die von Stacheldraht und Marmortrümmern gesäumten Alleen des Botschaftsviertels zum eisernen Tor des Palais Metternich.",
    threatLevel: "Mittel",
    conceptImage: "/assets/the-whisper/concepts/proto_konsulat_attachee.jpg",
    archetypeImage: "/assets/the-whisper/concepts/proto_konsulat_doyen.jpg",
    archetypeRole: "Der Doyen (Palais Metternich)",
    archetypeQuote:
      "„Ein Abkommen ist wie feinstes Meißner Porzellan: Zerbrechlich, aber unbezahlbar.“",
  },
  {
    id: "spittelau_fernwaerme",
    title: "Fernwärmewerk Spittelau",
    district: "9. Bezirk (Alsergrund)",
    subtitle: "Die Müllverbrennung // Die Aschenbrenner-Gilde",
    faction: "Die Aschenbrenner (Hundertwasser-Gilde)",
    factionColor: "#f97316",
    xPercent: 28,
    yPercent: 18,
    status: "in_development",
    statusLabel: "IN ENTWICKLUNG",
    grandfatherNote:
      "„Die goldene Kugel leuchtet selbst durch den Ruß. Die Aschenbrenner kontrollieren den Dampfdruck. Wer den Oberheizer verärgert, sitzt im Winter im Eiskasten.“",
    transitText:
      "Entlang der dampfenden Fernwärmerohre am Donaukanal gen Norden. Schwefelgeruch und heißer Schlackeregen kündigen die Hochöfen an.",
    threatLevel: "Tödlich",
    conceptImage: "/assets/the-whisper/concepts/proto_aschenbrenner_heizer.jpg",
    archetypeImage: "/assets/the-whisper/concepts/proto_aschenbrenner_heizer.jpg",
    archetypeRole: "Der Oberheizer (Hochofen-Meister)",
    archetypeQuote: "„Solang das Feuer brennt, friert Wien nicht. Bring Kohle oder brenn selbst.“",
  },
  {
    id: "character_diorama",
    title: "Character Diorama Studio",
    district: "Entwickler-Labor",
    subtitle: "Szene 3 // 3D-Bühne, PBR-Materialien & Ratten-FSM",
    faction: "Small-World-Machine Engine Studio",
    factionColor: "#38bdf8",
    xPercent: 12,
    yPercent: 88,
    status: "available",
    statusLabel: "STUDIO",
    targetUrl: "../character-diorama/index.html",
    grandfatherNote:
      "„Die Werkbank der Schöpfer. Hier werden Lichtbrechungen, irisierende Öllacken und das Putzverhalten der Wiener Kanalratten geprüft.“",
    transitText: "Wechsle in den dreidimensionalen Inspektionsraum des Character-Dioramas.",
    threatLevel: "Sicher",
    conceptImage: "/assets/the-whisper/concepts/diorama-concept.jpg",
  },
];

export class ViennaMapModal {
  private _container: HTMLElement | null = null;
  private _isOpen = false;
  private _currentLocationId: string;
  private _selectedLocation: MapLocation | null = null;
  private _transitInProgress = false;
  private _boundKeyHandler: (e: KeyboardEvent) => void;

  constructor(currentLocationId = "flakturm_arenberg") {
    this._currentLocationId = currentLocationId;
    this._boundKeyHandler = (e: KeyboardEvent): void => {
      if (isEditingTextInput(e.target) || isEditingTextInput()) return;
      if (e.key === "m" || e.key === "M") {
        if (!this._transitInProgress) {
          this.toggle();
        }
      } else if (e.key === "Escape" && this._isOpen && !this._transitInProgress) {
        this.close();
      }
    };
    this._initModal();
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this._boundKeyHandler);
    }
  }

  public get isOpen(): boolean {
    return this._isOpen;
  }

  public open(): void {
    this._isOpen = true;
    if (!this._container) return;
    this._container.style.display = "flex";
    // Select current location or default to first available
    const initial =
      VIENNA_LOCATIONS.find((loc) => loc.id === this._currentLocationId) ?? VIENNA_LOCATIONS[0];
    if (initial) {
      this._selectLocation(initial);
    }
  }

  public close(): void {
    this._isOpen = false;
    if (!this._container || this._transitInProgress) return;
    this._container.style.display = "none";
  }

  public toggle(): void {
    if (this._isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  public destroy(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this._boundKeyHandler);
    }
    this._container?.remove();
    this._container = null;
  }

  private _initModal(): void {
    if (typeof document === "undefined") {
      return;
    }

    if (document.getElementById("viennaMapModalContainer")) {
      this._container = document.getElementById("viennaMapModalContainer");
      return;
    }

    const container = document.createElement("div");
    container.id = "viennaMapModalContainer";
    container.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(5, 7, 10, 0.88);
      backdrop-filter: blur(8px);
      font-family: var(--font-ui, "Rajdhani", sans-serif);
      color: #e2e8f0;
      user-select: none;
      box-sizing: border-box;
    `;

    container.innerHTML = `
      <div id="viennaMapModalWrapper" style="
        position: relative;
        width: 95vw;
        max-width: 1400px;
        height: 90vh;
        max-height: 860px;
        background: #111418;
        border: 1px solid rgba(255, 184, 77, 0.35);
        border-radius: 8px;
        box-shadow: 0 25px 60px rgba(0, 0, 0, 0.95), 0 0 40px rgba(255, 184, 77, 0.08);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      ">
        <!-- Top Bar -->
        <div style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px;
          background: rgba(18, 24, 32, 0.95);
          border-bottom: 1px solid rgba(255, 184, 77, 0.25);
        ">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 1.4rem;">🗺️</span>
            <div>
              <div style="font-size: 1rem; font-weight: 800; letter-spacing: 1.5px; color: #ffb84d; text-transform: uppercase;">
                Wien 2100 // Großvaters Faltplan
              </div>
              <div style="font-size: 0.75rem; color: #94a3b8;">
                Vorkriegs-Stadtkarte mit handschriftlichen Rötelstift-Notizen & Schleichrouten
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 16px;">
            <div style="font-size: 0.75rem; color: #cbd5e1; background: rgba(0,0,0,0.4); padding: 4px 10px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1);">
              Taste <kbd style="background: rgba(255,184,77,0.2); color: #ffb84d; padding: 2px 6px; border-radius: 3px; font-weight: bold;">[M]</kbd> oder <kbd style="background: rgba(255,255,255,0.15); color: #fff; padding: 2px 6px; border-radius: 3px;">[ESC]</kbd> zum Schließen
            </div>
            <button id="mapCloseBtn" style="
              background: transparent;
              border: 1px solid rgba(255, 255, 255, 0.2);
              color: #cbd5e1;
              width: 32px;
              height: 32px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 1.1rem;
              display: flex;
              align-items: center;
              justify-content: center;
              transition: all 0.15s;
            ">✕</button>
          </div>
        </div>

        <!-- Main Body: Map Canvas (Left) + Detail Card (Right) -->
        <div style="display: flex; flex: 1; min-height: 0; position: relative;">
          <!-- Map Container -->
          <div id="viennaMapCanvasArea" style="
            flex: 1;
            position: relative;
            background: #080a0d;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            border-right: 1px solid rgba(255, 184, 77, 0.2);
          ">
            <!-- Map Texture Image -->
            <div id="viennaMapImgContainer" style="
              position: relative;
              width: 100%;
              height: 100%;
              display: flex;
              align-items: center;
              justify-content: center;
            ">
              <img id="viennaMapImg" src="${resolveAssetUrl("/assets/the-whisper/map/vienna_map.jpg")}" alt="Wien 2100 Stadtplan" style="
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                display: block;
                box-shadow: 0 0 30px rgba(0,0,0,0.8);
                filter: contrast(1.05) brightness(0.95);
              " />
              <!-- Marker Layer over image -->
              <div id="viennaMapPinOverlay" style="
                position: absolute;
                inset: 0;
                pointer-events: none;
              "></div>
            </div>
          </div>

          <!-- Detail & Fast-Travel Drawer -->
          <div id="viennaMapDrawer" style="
            width: 380px;
            background: #0e1217;
            display: flex;
            flex-direction: column;
            padding: 24px;
            box-sizing: border-box;
            gap: 16px;
            overflow-y: auto;
          ">
            <div id="drawerContent">
              <div style="color: #64748b; font-size: 0.9rem; text-align: center; margin-top: 40px;">
                Wähle einen markierten Ort auf der Karte, um Großvaters Notizen einzusehen.
              </div>
            </div>
          </div>
        </div>

        <!-- Transit Overlay Screen (hidden by default) -->
        <div id="viennaTransitOverlay" style="
          position: absolute;
          inset: 0;
          background: #05070a;
          z-index: 100;
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          text-align: center;
        ">
          <div style="
            position: relative;
            max-width: 720px;
            width: 100%;
            border-radius: 8px;
            overflow: hidden;
            border: 1px solid rgba(255, 184, 77, 0.4);
            box-shadow: 0 20px 50px rgba(0,0,0,0.9);
            margin-bottom: 24px;
          ">
            <img src="${resolveAssetUrl("/assets/the-whisper/map/transit_tunnel.jpg")}" alt="Transit Vignette" style="width: 100%; height: auto; display: block;" />
          </div>
          <div id="transitLocationTitle" style="font-size: 1.4rem; font-weight: bold; color: #ffb84d; letter-spacing: 1px; margin-bottom: 8px;">
            SCHNELLREISE...
          </div>
          <div id="transitStoryText" style="
            font-family: var(--font-mono, "JetBrains Mono", monospace);
            font-size: 0.95rem;
            color: #e2e8f0;
            max-width: 650px;
            line-height: 1.6;
            min-height: 50px;
            margin-bottom: 24px;
            background: rgba(0,0,0,0.5);
            padding: 12px 18px;
            border-radius: 6px;
            border-left: 3px solid #ffb84d;
          "></div>
          <div style="display: flex; align-items: center; gap: 12px; width: 320px;">
            <div style="flex: 1; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
              <div id="transitProgressBar" style="width: 0%; height: 100%; background: #ffb84d; transition: width 0.1s linear;"></div>
            </div>
            <span id="transitTimer" style="font-family: monospace; font-size: 0.8rem; color: #ffb84d;">100%</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(container);
    this._container = container;

    // Hook Close Button
    const closeBtn = container.querySelector("#mapCloseBtn");
    closeBtn?.addEventListener("click", () => this.close());
    closeBtn?.addEventListener("mouseenter", (e) => {
      (e.currentTarget as HTMLElement).style.borderColor = "#ffb84d";
      (e.currentTarget as HTMLElement).style.color = "#ffb84d";
    });
    closeBtn?.addEventListener("mouseleave", (e) => {
      (e.currentTarget as HTMLElement).style.borderColor = "rgba(255, 255, 255, 0.2)";
      (e.currentTarget as HTMLElement).style.color = "#cbd5e1";
    });

    // Render Pins once map image loads / or immediately
    const mapImg = container.querySelector("#viennaMapImg") as HTMLImageElement | null;
    if (mapImg) {
      if (mapImg.complete) {
        this._renderPins();
      } else {
        mapImg.addEventListener("load", () => this._renderPins());
      }
    }

    // Window resize recalculation for pin overlay alignment
    window.addEventListener("resize", () => {
      if (this._isOpen) {
        this._renderPins();
      }
    });
  }

  private _renderPins(): void {
    if (!this._container) return;
    const img = this._container.querySelector("#viennaMapImg") as HTMLImageElement | null;
    const overlay = this._container.querySelector("#viennaMapPinOverlay") as HTMLElement | null;
    if (!img || !overlay) return;

    const imgRect = img.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();

    // Map offset inside overlay
    const offsetX = imgRect.left - overlayRect.left;
    const offsetY = imgRect.top - overlayRect.top;
    const mapWidth = imgRect.width;
    const mapHeight = imgRect.height;

    overlay.innerHTML = "";
    overlay.style.pointerEvents = "none";

    VIENNA_LOCATIONS.forEach((loc) => {
      const pinLeft = offsetX + (loc.xPercent / 100) * mapWidth;
      const pinTop = offsetY + (loc.yPercent / 100) * mapHeight;

      const pinEl = document.createElement("div");
      pinEl.className = `vienna-map-pin pin-${loc.id}`;
      pinEl.style.cssText = `
        position: absolute;
        left: ${pinLeft}px;
        top: ${pinTop}px;
        transform: translate(-50%, -50%);
        pointer-events: all;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        z-index: 10;
      `;

      const isCurrent = loc.id === this._currentLocationId;
      const isTarget = loc.status === "target";

      const haloColor = isTarget
        ? "rgba(16, 185, 129, 0.8)"
        : isCurrent
          ? "rgba(56, 189, 248, 0.8)"
          : "rgba(255, 184, 77, 0.6)";

      const badgeColor = isTarget
        ? "#10b981"
        : isCurrent
          ? "#38bdf8"
          : loc.status === "locked"
            ? "#ef4444"
            : loc.status === "in_development"
              ? "#a855f7"
              : "#ffb84d";

      pinEl.innerHTML = `
        <div style="position: relative; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;">
          <!-- Pulsing Halo for active/target -->
          <div style="
            position: absolute;
            inset: -4px;
            border-radius: 50%;
            background: ${haloColor};
            opacity: 0.4;
            animation: pinPulse 2s infinite ease-in-out;
          "></div>
          <!-- Pin Body -->
          <div style="
            position: relative;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            background: #111418;
            border: 2px solid ${badgeColor};
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.8);
            font-size: 13px;
          ">
            ${isTarget ? "⚰️" : isCurrent ? "📍" : loc.status === "locked" ? "🔒" : loc.id === "prater_riesenrad" ? "🎡" : loc.id === "bermudadreieck" ? "🧪" : "⚓"}
          </div>
        </div>
        <!-- Pin Label -->
        <div style="
          margin-top: 4px;
          background: rgba(10, 15, 22, 0.9);
          border: 1px solid ${badgeColor};
          border-radius: 4px;
          padding: 2px 6px;
          font-family: var(--font-mono, "JetBrains Mono", monospace);
          font-size: 10px;
          font-weight: bold;
          color: #fff;
          white-space: nowrap;
          box-shadow: 0 2px 8px rgba(0,0,0,0.8);
        ">
          ${(loc.title.split("(")[0] ?? loc.title).trim()}
        </div>
      `;

      pinEl.addEventListener("mouseenter", () => {
        pinEl.style.transform = "translate(-50%, -50%) scale(1.15)";
        pinEl.style.zIndex = "20";
      });

      pinEl.addEventListener("mouseleave", () => {
        if (this._selectedLocation?.id !== loc.id) {
          pinEl.style.transform = "translate(-50%, -50%) scale(1.0)";
          pinEl.style.zIndex = "10";
        }
      });

      pinEl.addEventListener("click", () => {
        this._selectLocation(loc);
      });

      overlay.appendChild(pinEl);
    });

    // Ensure pulse keyframes style tag exists
    if (!document.getElementById("viennaMapPulseStyle")) {
      const style = document.createElement("style");
      style.id = "viennaMapPulseStyle";
      style.textContent = `
        @keyframes pinPulse {
          0% { transform: scale(0.95); opacity: 0.7; }
          50% { transform: scale(1.4); opacity: 0.1; }
          100% { transform: scale(0.95); opacity: 0.7; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  private _selectLocation(loc: MapLocation): void {
    this._selectedLocation = loc;
    if (!this._container) return;

    // Highlight selected pin
    const pins = this._container.querySelectorAll(".vienna-map-pin");
    pins.forEach((p) => {
      (p as HTMLElement).style.transform = "translate(-50%, -50%) scale(1.0)";
      (p as HTMLElement).style.zIndex = "10";
    });
    const selectedPin = this._container.querySelector(`.pin-${loc.id}`) as HTMLElement | null;
    if (selectedPin) {
      selectedPin.style.transform = "translate(-50%, -50%) scale(1.2)";
      selectedPin.style.zIndex = "25";
    }

    const drawer = this._container.querySelector("#drawerContent");
    if (!drawer) return;

    const isCurrent = loc.id === this._currentLocationId;
    const canTravel = loc.status === "available" && !isCurrent;

    let buttonHtml = "";
    if (isCurrent) {
      buttonHtml = `
        <div style="
          width: 100%;
          padding: 10px;
          background: rgba(56, 189, 248, 0.15);
          border: 1px solid #38bdf8;
          border-radius: 6px;
          color: #38bdf8;
          font-weight: bold;
          font-size: 0.85rem;
          text-align: center;
          font-family: var(--font-mono, "JetBrains Mono", monospace);
        ">
          📍 AKTUELLER STANDORT
        </div>
      `;
    } else if (canTravel) {
      buttonHtml = `
        <button id="btnStartTravel" style="
          width: 100%;
          padding: 12px;
          background: #ffb84d;
          border: none;
          border-radius: 6px;
          color: #111;
          font-weight: 800;
          font-size: 0.95rem;
          letter-spacing: 1px;
          cursor: pointer;
          font-family: var(--font-mono, "JetBrains Mono", monospace);
          box-shadow: 0 4px 15px rgba(255, 184, 77, 0.3);
          transition: all 0.2s ease;
        ">
          ➔ SCHNELLREISE ANTRETEN
        </button>
      `;
    } else if (loc.status === "in_development") {
      buttonHtml = `
        <div style="
          width: 100%;
          padding: 10px;
          background: rgba(168, 85, 247, 0.15);
          border: 1px solid #a855f7;
          border-radius: 6px;
          color: #c084fc;
          font-weight: bold;
          font-size: 0.85rem;
          text-align: center;
          font-family: var(--font-mono, "JetBrains Mono", monospace);
        ">
          🚧 ORT IN ENTWICKLUNG (DEMNÄCHST BETRETBAR)
        </div>
      `;
    } else if (loc.status === "locked") {
      buttonHtml = `
        <div style="
          width: 100%;
          padding: 10px;
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid #ef4444;
          border-radius: 6px;
          color: #fca5a5;
          font-weight: bold;
          font-size: 0.85rem;
          text-align: center;
          font-family: var(--font-mono, "JetBrains Mono", monospace);
        ">
          🔒 SPERRZONE (AUFTRAG NOCH NICHT ERFÜLLT)
        </div>
      `;
    } else if (loc.status === "target") {
      buttonHtml = `
        <div style="
          width: 100%;
          padding: 10px;
          background: rgba(16, 185, 129, 0.15);
          border: 1px solid #10b981;
          border-radius: 6px;
          color: #6ee7b7;
          font-weight: bold;
          font-size: 0.85rem;
          text-align: center;
          font-family: var(--font-mono, "JetBrains Mono", monospace);
        ">
          ⚰️ HAUPTZIEL DER REISE (URNEN-BESTATTUNG)
        </div>
      `;
    }

    drawer.innerHTML = `
      <!-- Status & District Badges -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="
          background: rgba(255, 184, 77, 0.15);
          color: #ffb84d;
          border: 1px solid rgba(255, 184, 77, 0.4);
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 0.7rem;
          font-weight: bold;
          text-transform: uppercase;
        ">${loc.district}</span>
        <span style="
          background: rgba(255, 255, 255, 0.08);
          color: ${loc.status === "available" ? "#4ade80" : loc.status === "target" ? "#10b981" : "#fca5a5"};
          border: 1px solid rgba(255, 255, 255, 0.15);
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 0.7rem;
          font-weight: bold;
        ">${loc.statusLabel}</span>
      </div>

      <!-- Title & Subtitle -->
      <h2 style="margin: 0 0 4px 0; font-size: 1.3rem; color: #fff; line-height: 1.3;">${loc.title}</h2>
      <div style="font-size: 0.8rem; color: #94a3b8; font-family: var(--font-mono, "JetBrains Mono", monospace); margin-bottom: 12px;">
        ${loc.subtitle}
      </div>

      ${
        loc.conceptImage
          ? `
      <!-- Location Concept Preview -->
      <div style="
        position: relative;
        width: 100%;
        height: 120px;
        border-radius: 6px;
        overflow: hidden;
        border: 1px solid rgba(255, 184, 77, 0.3);
        margin-bottom: 12px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.6);
      ">
        <img src="${resolveAssetUrl(loc.conceptImage)}" alt="${loc.title}" style="
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: contrast(1.1) brightness(0.95);
        " />
        <div style="
          position: absolute;
          bottom: 4px;
          right: 6px;
          background: rgba(0,0,0,0.7);
          color: #ffb84d;
          font-size: 0.65rem;
          font-family: var(--font-mono, "JetBrains Mono", monospace);
          padding: 2px 6px;
          border-radius: 3px;
        ">VISUELLER SCHAUPLATZ</div>
      </div>
      `
          : ""
      }

      <!-- Faction & Threat Level -->
      <div style="
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        padding: 10px 12px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        font-size: 0.75rem;
        margin-bottom: 12px;
      ">
        <div>
          <div style="color: #64748b; font-size: 0.65rem; text-transform: uppercase;">Kontrollierende Fraktion</div>
          <div style="color: ${loc.factionColor}; font-weight: bold; margin-top: 2px;">${loc.faction}</div>
        </div>
        <div>
          <div style="color: #64748b; font-size: 0.65rem; text-transform: uppercase;">Gefahrenstufe</div>
          <div style="color: #e2e8f0; font-weight: bold; margin-top: 2px;">⚠️ ${loc.threatLevel}</div>
        </div>
      </div>

      ${
        loc.archetypeImage
          ? `
      <!-- Faction Archetype Character Badge -->
      <div style="
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(18, 24, 32, 0.85);
        border: 1px solid rgba(255, 184, 77, 0.25);
        border-radius: 6px;
        padding: 8px 10px;
        margin-bottom: 12px;
      ">
        <img src="${resolveAssetUrl(loc.archetypeImage)}" alt="${loc.archetypeRole ?? "Fraktions-Figur"}" style="
          width: 44px;
          height: 44px;
          border-radius: 4px;
          object-fit: cover;
          border: 1px solid rgba(255, 184, 77, 0.4);
        " />
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.75rem; font-weight: bold; color: #ffb84d; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">
            ${loc.archetypeRole ?? "Fraktions-Figur"}
          </div>
          <div style="font-size: 0.7rem; color: #94a3b8; font-style: italic; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">
            ${loc.archetypeQuote ?? ""}
          </div>
        </div>
      </div>
      `
          : ""
      }

      <!-- Grandfather's Handwritten Note Card (Graphic Noir Style) -->
      <div style="
        position: relative;
        background: #f4ecd8;
        color: #2b261f;
        padding: 14px 16px;
        border-radius: 4px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.5);
        border-left: 4px solid #b91c1c;
        margin-bottom: 16px;
        font-family: 'Georgia', 'Times New Roman', serif;
        font-size: 0.88rem;
        line-height: 1.5;
        font-style: italic;
      ">
        <div style="
          position: absolute;
          top: -8px;
          right: 12px;
          background: rgba(217, 119, 6, 0.4);
          color: #78350f;
          font-family: var(--font-mono, "JetBrains Mono", monospace);
          font-size: 0.65rem;
          font-weight: bold;
          font-style: normal;
          padding: 1px 6px;
          border-radius: 2px;
          transform: rotate(2deg);
        ">FRANTIŠEKS NOTIZ</div>
        ${loc.grandfatherNote}
      </div>

      <!-- Fast Travel Action -->
      <div style="margin-top: auto;">
        ${buttonHtml}
      </div>
    `;

    // Hook Fast Travel click
    if (canTravel && loc.targetUrl) {
      const travelBtn = drawer.querySelector("#btnStartTravel");
      travelBtn?.addEventListener("click", () => {
        this._startFastTravel(loc);
      });
      travelBtn?.addEventListener("mouseenter", (e) => {
        (e.currentTarget as HTMLElement).style.background = "#ffa726";
        (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
      });
      travelBtn?.addEventListener("mouseleave", (e) => {
        (e.currentTarget as HTMLElement).style.background = "#ffb84d";
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
      });
    }
  }

  private _startFastTravel(loc: MapLocation): void {
    if (!loc.targetUrl || this._transitInProgress || !this._container) return;
    this._transitInProgress = true;

    const transitOverlay = this._container.querySelector(
      "#viennaTransitOverlay",
    ) as HTMLElement | null;
    const titleEl = this._container.querySelector("#transitLocationTitle");
    const storyEl = this._container.querySelector("#transitStoryText");
    const progressBar = this._container.querySelector("#transitProgressBar") as HTMLElement | null;
    const timerEl = this._container.querySelector("#transitTimer");

    if (transitOverlay && titleEl && storyEl && progressBar && timerEl) {
      titleEl.textContent = `REISE NACH: ${loc.title.toUpperCase()}`;
      storyEl.textContent = loc.transitText;
      transitOverlay.style.display = "flex";

      let progress = 0;
      const durationMs = 2400;
      const stepMs = 40;
      const increment = (stepMs / durationMs) * 100;

      const interval = setInterval(() => {
        progress = Math.min(100, progress + increment);
        progressBar.style.width = `${progress}%`;
        timerEl.textContent = `${Math.round(progress)}%`;

        if (progress >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            if (loc.targetUrl) {
              window.location.href = loc.targetUrl;
            }
          }, 200);
        }
      }, stepMs);
    } else if (loc.targetUrl) {
      window.location.href = loc.targetUrl;
    }
  }
}
