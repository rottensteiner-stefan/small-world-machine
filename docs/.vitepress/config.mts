import { defineConfig } from "vitepress";

export default defineConfig({
  base: "/small-world-machine/",
  title: "Small World Machine",
  description:
    "Eine leichtgewichtige, hochperformante, modulare 3D-Game-Engine für das Web, gebaut mit TypeScript.",
  themeConfig: {
    nav: [
      { text: "Spiele & Apps", link: "/apps/the-whisper" },
      { text: "Anleitungen", link: "/guides/getting-started" },
      { text: "Erweiterungen", link: "/extensions/" },
      { text: "Architekturentscheidungen (ADRs)", link: "/adr/" },
      { text: "Recherche", link: "/research/" },
      { text: "API-Referenz", link: "/api/index.html", target: "_blank" },
      { text: "Showcases & Hub", link: "/showcases/index.html", target: "_blank" },
    ],
    sidebar: {
      "/apps/": [
        {
          text: "Spiele & Welten",
          items: [
            { text: "Überblick & Index", link: "/apps/" },
            { text: "The Whisper — A Viennese Requiem", link: "/apps/the-whisper" },
            { text: "YAD (Dungeon Crawler)", link: "/apps/yad" },
            { text: "Light Cycle Arena", link: "/apps/light-cycle-arena" },
            { text: "Maker (Welteneditor)", link: "/apps/maker" },
          ],
        },
      ],
      "/extensions/": [
        {
          text: "Erweiterungen & Ökosystem",
          items: [
            { text: "Ökosystem-Überblick", link: "/extensions/" },
            { text: "VFX Extras (@small-world-machine/vfx-extras)", link: "/extensions/vfx-extras" },
            { text: "Geometrie Extras (@small-world-machine/geometry-extras)", link: "/extensions/geometry-extras" },
            { text: "Physik Extras (@small-world-machine/physics-extras)", link: "/extensions/physics-extras" },
            { text: "glTF Erweiterungen (@small-world-machine/gltf-extensions)", link: "/extensions/gltf-extensions" },
          ],
        },
      ],
      "/guides/": [
        {
          text: "Erste Schritte",
          items: [
            { text: "Überblick & Index", link: "/guides/" },
            { text: "Installation & Einrichtung", link: "/guides/getting-started" },
            { text: "Kommerzielle Indie-Roadmap", link: "/guides/commercial-indie-roadmap" },
          ],
        },
        {
          text: "Kernkonzepte",
          items: [
            { text: "Architektur & Überblick", link: "/guides/architecture" },
            { text: "Materialien & Shader", link: "/guides/materials" },
            { text: "Schatten", link: "/guides/shadows" },
            { text: "Ein neues Material hinzufügen", link: "/guides/adding-materials" },
            { text: "Shader-Importer", link: "/guides/shader-importers" },
            { text: "Konfiguration & Einrichtung", link: "/guides/configuration" },
            { text: "Koordinatensystem & Kamerastrategien", link: "/guides/coordinate-system" },
            { text: "2.5D-Szenen & Hintergründe", link: "/guides/2-5d-scenes" },
            { text: "Gamification & Interaktionen", link: "/guides/interactions" },
            { text: "Physik & RigidBodies", link: "/guides/physics" },
            { text: "Audio-System", link: "/guides/audio" },
            { text: "Zustandsautomaten (FSM)", link: "/guides/state-machines" },
            { text: "EventBus & Game-Loop", link: "/guides/eventbus" },
            { text: "Modulares Ökosystem & Schichtung", link: "/guides/extensions" },
            { text: "Ein eigenes Spiel bauen", link: "/guides/custom-game" },
          ],
        },
        {
          text: "Werkzeuge & Editoren",
          items: [
            { text: "Werkzeuge im Überblick", link: "/guides/toolchain" },
            { text: "Maker (3D-Welteneditor)", link: "/guides/maker" },
            { text: "The Forge (Fenstermanager im Spiel)", link: "/guides/forge" },
            { text: "Material Studio", link: "/guides/material-studio" },
            { text: "Pixler (Pixel-Art-Editor)", link: "/guides/pixler" },
            { text: "Xtractor (Sprite-Extraktor)", link: "/guides/xtractor" },
            { text: "Map Generator (ASCII-Raster-Level)", link: "/guides/map-generator" },
          ],
        },
      ],
      "/adr/": [
        {
          text: "Architekturentscheidungen",
          items: [
            { text: "Überblick & Index", link: "/adr/" },
            { text: "0001: Config-Form (benannte Schlüssel)", link: "/adr/0001-config-shape-named-keys-not-tagged-arrays" },
            { text: "0002: TAA-Jitter in gemeinsamer ViewProj", link: "/adr/0002-taa-jitter-shared-viewproj-matrix" },
            { text: "0003: Globaler Hit-Stop", link: "/adr/0003-hit-stop-is-global-not-per-entity" },
            { text: "0004: Globale Punkt-/Spot-Licht-Obergrenze", link: "/adr/0004-point-spot-light-global-cap" },
            { text: "0005: CCD nur für Kugeln", link: "/adr/0005-ccd-sphere-only-scope" },
            { text: "0006: PCSS nur für Directional Lights", link: "/adr/0006-pcss-directional-light-only" },
            { text: "0007: Clustered Forward+ Lighting", link: "/adr/0007-clustered-lighting-webgl2-webgpu-only" },
            { text: "0008: HZB-Occlusion-Culling", link: "/adr/0008-hzb-occlusion-culling-webgpu-only" },
            { text: "0009: Charakter-Pipeline & Mixamo", link: "/adr/0009-character-pipeline-and-mixamo-rigging-standard" },
            { text: "0010: Maker-Editor-Architektur", link: "/adr/0010-maker-editor-architecture" },
            { text: "0011: Modulare Asset-Kits", link: "/adr/0011-modular-asset-kits-and-remote-catalog" },
            { text: "0012: Das Streuner-Prinzip", link: "/adr/0012-atmospheric-indie-game-design-and-rendering-philosophy" },
            { text: "0013: Vereinheitlichte Flüssigkeits-Materialien", link: "/adr/0013-unified-liquid-surface-material" },
            { text: "0014: Modulare Domänen-Schichtung", link: "/adr/0014-modular-ecosystem-and-domain-layering" },
            { text: "0015: App-First-Regel für Genre-Code", link: "/adr/0015-app-first-genre-code-extraction-rule" },
            { text: "0016: 2.5D-Bühnen-Zonen als glTF-Erweiterung", link: "/adr/0016-2-5d-stage-zones-as-a-gltf-extension" },
            { text: "0017: glTF-Extension-Plugin-Registry", link: "/adr/0017-gltf-extension-plugin-registry" },
            { text: "0018: glTF Data-Level Extensions", link: "/adr/0018-gltf-data-level-extensions-and-ecosystem-package" },
            { text: "0019: Modulare Environment-Texturierung", link: "/adr/0019-modular-environment-texturing-and-scale-doctrine" },
            { text: "0020: Deklarative Level-Deskriptoren", link: "/adr/0020-declarative-level-descriptors-and-kit-runtime" },
            { text: "0021: Ökosystem-Pakete für exotische Geometrien & Physik", link: "/adr/0021-ecosystem-packages-exotic-geometry-and-physics" },
            { text: "0022: GPU-Instanzierte VFX-Pipeline & vfx-extras", link: "/adr/0022-gpu-instanced-vfx-pipeline-and-extras-package" },
            { text: "0023: Physik-Modernisierung & Constraint-System", link: "/adr/0023-physics-engine-modernization-and-constraint-system" },
            { text: "0024: Tools-Ökosystem-Paket", link: "/adr/0024-tools-ecosystem-package" },
          ],
        },
      ],
      "/research/": [
        {
          text: "Technische Recherche & Studien",
          items: [
            { text: "Überblick & Index", link: "/research/" },
            { text: "AAA-Rendering-Techniken", link: "/research/aaa-engine-techniques" },
            { text: "Öl- & Pfützen-Shader-Techniken", link: "/research/oil-puddle-shader-technique" },
            { text: "Showcase-Feature-Audit", link: "/research/showcase-feature-audit" },
            { text: "Plan 0: Level-Deskriptoren (2026-09-18)", link: "/research/plan-0-level-descriptors-2026-09-18" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/rottensteiner-stefan/small-world-machine" }],
    footer: {
      message: "Veröffentlicht unter der MIT-Lizenz.",
      copyright: "Copyright © 2026 Stefan Rottensteiner",
    },
  },
});
