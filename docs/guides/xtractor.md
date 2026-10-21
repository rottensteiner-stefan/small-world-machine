# Xtractor (Image Cropping & Cutting)

Pulling sprites out of a reference sheet or screenshot usually means a detour through an external image editor. **Xtractor** is an in-browser workbench for loading an image, selecting a region of it, and handing that crop directly to [Pixler](/guides/pixler) for further pixel editing — without leaving the page.

## Enabling it

Like the other built-in dev tools, Xtractor is wired up automatically as soon as you call `attachDevTools(app)` from `@small-world-machine/tools` (see [The Forge](/guides/forge#integrating-the-forge-into-your-own-app)):

```typescript
import { SmallWorldMachine } from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

const app = new MyGame();
attachDevTools(app);
app.start();
```

Press **Ctrl+Alt+G** (or **Cmd+Alt+G**) to open the Forge overlay, where Xtractor appears as the "Asset Extractor" window.

::: tip Standalone page
Xtractor is also available as a self-contained page at `/tools/xtractor.html`. The page instantiates the same `Xtractor` class (`new Xtractor({ parent: container })`), so there is no duplicated code. It has no shared event bus, so it cannot hand crops off to Pixler (see [Limitations](#einschraenkungen) below).
:::

::: tip Own package since ADR 0024
`Xtractor` lives in `@small-world-machine/tools` (`packages/tools/`), a separate workspace package layered on top of `@small-world-machine/engine` — see [ADR 0024](/adr/0024-tools-ecosystem-package).
:::

## Loading an image

All routes land at the same 1:1 pixel-scale canvas (on-screen zoom is CSS scaling, not resampling). Input goes through a `UniversalIngestDropzone`:

- **Upload** — click the dropzone to open a file picker.
- **Drag & drop** — drop onto the dropzone or anywhere on the window. Besides images it accepts ZIP archives, SVG, PBR sets and text/JSON.
- **URL** — paste a URL into the text field and click "Load". Cross-origin images without permissive CORS headers won't load; Xtractor shows an explanatory message instead of proxying — downloading and uploading locally is the fallback.
- **Paste from clipboard** — `Ctrl/Cmd+V` pastes an image directly (also on the standalone page, since paste is part of the dropzone).

## Selecting a region

Selection tools, switchable via the toolbar (Hand, Rect, Circle, Wand), plus buttons for Auto-Sprites, RemBG and Normal and Undo/Redo:

- **Rect** (default) — draw a rectangular selection by click-and-drag (minimum 10×10px).
- **Circle** — the same click-and-drag gesture, but crops to an elliptical/circular region instead of a rectangle.
- **Wand** — magic wand / smart masking.
- **Hand** — pans the canvas instead of drawing a selection.

Once a selection exists, you can:

- **Drag** it to reposition, or edit the **X/Y/W/H** number fields for pixel-precise adjustment.
- **Zoom** with the +/- buttons or `Ctrl` + mouse wheel (10%–1000%, zooms around the cursor).
- **Clear** it with the Clear Selection button.

Keyboard: `Ctrl+D` deselect, `Ctrl+0` fit, `Ctrl+1` 100%, `Esc`, arrow keys move the selection (`Shift` ×10), `Delete`/`Backspace` removes the image, `Cmd/Ctrl+Z` / `Shift+Z` undo/redo.

## Sending a crop to Pixler

Once a selection exists, a preview pill with a **"Send to Pixler"** button appears above the chat panel. Clicking it sends the crop (as a PNG data URL) directly into the docked [Pixler](/guides/pixler) window via the engine's shared event bus — this is the one fully functional cross-tool integration in this tool. There is no equivalent handoff to Map Generator or Material Studio.

## The chat panel

The chat panel (`xtractor/AiChatPanel.ts`) connects to a vision/LLM provider — Gemini, OpenAI, Claude, Ollama or a custom HTTP endpoint (`common/ai/providers/`) — configured via the panel's settings with your own API key. The system prompt makes the model answer with deterministic **action chips** in square brackets, which Xtractor executes locally: `[REMBG]`, `[CHROMA_KEY]`, `[AUTOCROP]`, `[CROP]`, `[FLIP_H/V]`, `[ROTATE]`, `[SCALE]`, `[PAD_POT]`, `[RECOLOR]`, `[POSTERIZE]`, `[GRAYSCALE]`, `[INVERT]`, `[SEPIA]`, `[AUTO_LEVELS]`, `[ADJUST]`, `[OUTLINE]`, `[DESPECKLE]`, `[AUTO_SPRITES]`, `[SLICE: N]`, `[NORMAL_MAP]`, `[DEPTH_MAP]`, `[EMISSIVE_MAP]`, `[AO_MAP]` (`common/image/ActionChips.ts`).

Export paths: the slice gallery offers a PNG download per cut, normal/depth maps have a preview with download, and results can be applied to the image (undoable) or sent to Pixler.

## Limitations {#einschraenkungen}

- **No PDF support.** The dropzone does not accept PDFs (no PDF code exists).
- **Slicing is vertical strips only:** `[SLICE: N]` cuts N (1–64) equal strips; there is no row/column grid and no atlas/metadata export. `[AUTO_SPRITES]` detects sprites via connected components instead.
- **No state persistence.** `getState()` returns `null`; reopening the Forge window loses your loaded image, selection and chat history (in-session undo history exists).
- **The standalone `xtractor.html` page has no event bus** — no Pixler handoff.
