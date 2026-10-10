# Commercial Indie Game Roadmap & Publisher Strategy

> **Small World Machine Guide:** From atmospheric prototype to commercial release on Steam, PlayStation & Xbox — specifically designed for solo developers and small indie teams.

---

## 1. The sweet-spot calculus: playtime & pricing

For a solo developer with a day job, choosing the playtime is the most important strategic decision of the entire project.

```
+---------------------------------------------------------------------------------------+
|  PLAYTIME SWEET SPOT: 1.5 TO 3.5 HOURS (MAXIMUM: 4 HOURS)                             |
|                                                                                       |
|  [ 10 min. vertical slice ] -> [ 1.5 hr core playtime ] -> [ 3.0 hr masterpiece ]    |
|  - Built with Maker           - Hand-placed lighting        - No artificial padding  |
|  - Pitch demo / Next Fest     - High replayability          - 60 FPS on standard PCs |
+---------------------------------------------------------------------------------------+
```

### Why 1.5 to 3.5 hours is the mathematical optimum:
1. **The "Steam 2-hour refund paradox":**
   Steam allows unconditional refunds under 2 hours of playtime. Beginners often fear this. The reality of modern indie hits: if a game lasts 2.5 to 3 hours, has a compelling mood/lighting, and is emotionally moving, almost nobody refunds it. Players instead praise it in reviews: *"Finally a game that respects my time and doesn't force an artificial 40-hour grind."*
2. **Quality density beats padding:**
   1 hour of high-caliber atmosphere, hand-placed lighting mood (in the **Maker** editor), and flawless puzzles/mechanics beats 15 hours of generic copy-paste worlds by a wide margin.
3. **Effort calculation for solo developers:**
   - 1 hour of polished 3D gameplay = roughly 200–350 net working hours (level design, sound, pacing, QA).
   - A 2.5-hour game is realistically and sustainably achievable in 600–900 working hours over 12–18 months of part-time work.

### Successful reference titles compared:
| Title | Team size | Playtime | Retail price | Reception & sales |
|---|---|---|---|---|
| ***A Short Hike*** | 1 developer | 1.5 – 2.0 hrs | ~$7.99 | > 1M sales, 99% positive reviews, IGF Grand Prize |
| ***Inside*** (Playdead) | Small indie team | 3.0 – 3.5 hrs | ~$19.99 | Global masterpiece, > 50 awards |
| ***Journey*** (thatgamecompany) | Small team | 2.0 hrs | ~$14.99 | One of the most influential games of the decade |
| ***Chants of Sennaar*** | 2 developers | 4.0 – 5.0 hrs | ~$19.99 | Overwhelming indie hit of 2023 |
| ***Limbo*** | Small team | 3.0 hrs | ~$9.99 | Millions sold, benchmark for modern pacing |
| ***Stray*** | Small core team | 4.5 – 5.0 hrs | ~$27.99 | Indie GotY contender, benchmark for atmosphere |

---

## 2. The technical path: from TypeScript/WebGPU to Steam & consoles

Small World Machine is built in **TypeScript** for **WebGPU / WebGL 2**. How does this code get onto Steam and consoles as a native `.exe`?

```
                              [ Small World Machine Game Code ]
                               (TypeScript / WebGPU / PBR)
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
         [ PC / Steam / Mac ]                          [ PS5 / Xbox / Switch ]
                 │                                               │
           Tauri v2 / CEF                               WebAssembly / native C++
   (Rust core + Steamworks SDK)                        (publisher porting partner)
                 │                                               │
                 ▼                                               ▼
         Steam store launch                            Sony / Microsoft DevNet
```

### A. Steam release (PC, Mac, Linux & Steam Deck)
This path is achievable **immediately, without third parties**:
1. **Wrapper framework: [Tauri v2](https://v2.tauri.app/):**
   - Tauri uses an extremely lean Rust core and the OS's hardware-accelerated webview (or bundled Chromium via CEF).
   - Binary size is often under 15 MB (compared to >150 MB for Electron).
   - Full support for WebGPU, WebGL 2, the Gamepad API, and AudioContext.
2. **Steamworks SDK integration (`steamworks.rs`):**
   - Rust-side binding to Valve's native C++ SDK for achievements, Steam Cloud saves, leaderboards, and the Steam overlay.
3. **Steam Deck verification:**
   - Steam Deck runs on Proton / SteamOS (Arch Linux).
   - Requirements for the green "Deck Verified" badge: clean gamepad mapping (Xbox/Deck layout), automatic on-screen keyboard for text fields, readable UI font sizes, and stable 60 FPS at 1280×800.

### B. Console release (PlayStation 5, Xbox Series X/S, Nintendo Switch)
Consoles don't run a browser as a game app. Three proven industry strategies apply here:
1. **Strategy 1: publisher porting partner (the standard path for indies):**
   - If you work with a publisher (e.g. Raw Fury, Devolver, Team17, Thunderful), their specialized in-house or partner studios (like *BlitWorks* or *Abstraction Games*) handle console porting and certification.
2. **Strategy 2: WebAssembly & embedded runtime:**
   - TypeScript/JS logic and shader calls are mapped natively onto the consoles' graphics APIs (DirectX 12 for Xbox, GNM/GNMX/AGC for PlayStation) via C++ embedding (e.g. embedded V8, QuickJS, or Wasmtime).
3. **Strategy 3: Xbox UWP developer mode:**
   - Xbox Series X/S supports UWP apps via the Microsoft Partner Center, with a modern Edge/Chromium webview container and direct controller passthrough.

---

## 3. Publisher strategy: what indie publishers are really looking for

Indie publishers receive 50 to 100 pitches a week. They're not looking for the next $200-million MMO, but for **low-risk, distinctive gems**.

### Top publishers for atmospheric indie titles:
- **Annapurna Interactive** (*Stray*, *What Remains of Edith Finch*, *Outer Wilds*)
- **Raw Fury** (*Sable*, *Call of the Sea*, *Norco*)
- **Devolver Digital** (*Inscryption*, *Gris*, *Loop Hero*)
- **Kepler Interactive** (*Pacific Drive*, *Clair Obscur*)
- **Fellow Traveller** (*Citizen Sleeper*, *Paradise Killer*)
- **Team17** (*Dredge*, *Blasphemous*)
- **Finji** (*Tunic*, *Chicory*)
- **Thunderful Games** (*Planet of Lana*, *SteamWorld*)

### What must be in the pitch deck (max. 10–12 slides):
1. **The 5-second hook ("elevator pitch"):**
   - *Weak:* "A beautiful 3D exploration game with puzzles and physics." (There are 10,000 of these.)
   - *Strong (like Stray):* "You are a stray cat in a robot-inhabited cyberpunk metropolis, trying to find your way home."
2. **The "vertical slice" (10–15 minutes of playable perfection):**
   - A single room/level lit to a stunning standard with **Maker**.
   - Perfect sound design, one working core mechanic, zero bugs, locked 60 FPS.
   - Publishers don't invest in concepts on paper — they invest in **proven execution quality**.
3. **The asymmetric budget advantage:**
   - A pitch requesting **€40,000 to €80,000** (for audio buyouts, localization, QA, and some living expenses) is a no-brainer micro-investment for a publisher with an extremely fast ROI, compared to €2-million major projects.

---

## 4. The big blind spots: the 1000 questions before launch

Many first-time projects fail on bureaucratic or technical hurdles right before the finish line. Here's the checklist of critical areas:

### A. Technical certification & platform rules (TRCs / XRRs)
Platform holders (Sony TRC, Microsoft XRR, Nintendo Lotcheck) demand strict behaviors:
- **Controller disconnection:** if the player unplugs the gamepad or its battery dies, the game **must** pause immediately and show a dialog.
- **Savegame safety:** if the game is hard-terminated during a write (power outage), the previous save must under no circumstances be corrupted (atomic savegame swapping via `.tmp` $\rightarrow$ `.json`).
- **Load time:** time from click to interactive main menu is usually required to be $\le 10$ seconds.

### B. Savegame architecture & cloud sync
- Strictly separate the save state into a **pure, serializable state JSON** (position, inventory, quest flags).
- Build in schema versioning from day 1:
  ```typescript
  interface SavegameV1 {
    version: 1;
    player: { x: number; y: number; z: number };
    inventory: string[];
  }
  ```
- Write automatic migration functions (`migrateSavegame(data)`) so saves don't become unusable after updates.

### C. Localization (i18n)
- **Minimum standard for Steam:** **EFIGS + CJK** (English, French, Italian, German, Spanish + Simplified Chinese, Japanese, Korean).
- Chinese and Japanese account for up to **30–45% of all sales** on Steam.
- Never bake text into textures or shaders. All UI and dialogue text must be referenced via string-key tables (`i18n.t("ui.door_locked")`).

### D. Audio & music rights
- Music and soundscape carry **50% of the emotional atmosphere**.
- **100% cleared licenses:** every sound effect and every music track needs a written **total buyout contract** (worldwide, unlimited, commercial, free of collecting societies like GEMA/BMI/ASCAP) to prevent copyright strikes and DMCA takedowns.

### E. Legal, tax & business structure
- **Liability limitation:** never sign contracts with Valve, Sony, or publishers as a private individual. Before release: form a liability-limited company (e.g. **UG haftungsbeschränkt** or **GmbH** in Germany/Austria).
- **US withholding tax:** Valve is based in the US. Form **W-8BEN-E** invokes the double-taxation treaty to avoid automatic 30% US tax withholding.
- **Age ratings (IARC):** the free IARC questionnaire, built into the Steam backend, gets your game official USK, ESRB, and PEGI ratings in 15 minutes.

### F. The Steam wishlist law & marketing timing
- **The magic threshold:** a game needs **7,000 to 10,000 Steam wishlists** before release day.
- **Why?** Only above this threshold does the Steam algorithm rank the game as relevant on launch day and place it on the global Steam front page under *"Popular Upcoming"* or *"New Releases"*.
- **Steam Next Fest:** the most powerful marketing tool for indies. A 15-minute playable web/Tauri demo during Next Fest often generates 3,000 to 8,000 wishlists in a single week.

---

## 5. The 3-phase action plan for solo developers

```
+---------------------------------------------------------------------------------------+
| PHASE 1: VERTICAL SLICE (months 1–4)                                                  |
| - Establish core mechanic & a unique vibe.                                            |
| - Fully light 1 level in Maker & score it with sound (10–15 min. playtime)            |
| - Record a 60-second gameplay teaser for social media / Reddit.                       |
+---------------------------------------------------------------------------------------+
                                           │
                                           ▼
+---------------------------------------------------------------------------------------+
| PHASE 2: ANNOUNCEMENT & PITCHING (months 5–8)                                         |
| - Launch the Steam "Coming Soon" page (trailer + screenshots).                        |
| - Send a 10-slide pitch deck to publishers (Annapurna, Raw Fury, Devolver, etc.).      |
| - Participate in Steam Next Fest with a playable demo.                                 |
+---------------------------------------------------------------------------------------+
                                           │
                                           ▼
+---------------------------------------------------------------------------------------+
| PHASE 3: PRODUCTION & LAUNCH (months 9–15)                                            |
| - Complete the 2.5 to 3.5-hour playtime via Maker's prefab kit.                        |
| - Localization (EFIGS + CJK) & audio mastering.                                       |
| - Packaging via Tauri v2 (Steam) or handoff to publisher porting (consoles).           |
| - Release day: launch with >7,000 wishlists.                                          |
+---------------------------------------------------------------------------------------+
```

---

*This document is part of the Small World Machine Developer Guides (`docs/guides/commercial-indie-roadmap.md`).*
