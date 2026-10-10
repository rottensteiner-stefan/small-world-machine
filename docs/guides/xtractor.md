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
Xtractor is also available as a self-contained page at `/tools/xtractor.html`. Note that this is a **separate, hand-duplicated copy** of the tool's HTML/CSS/JS, not a thin wrapper around the same class — feature parity between the two is maintained by hand. The standalone page has no shared event bus, so it cannot hand crops off to Pixler (see [Limitations](#einschraenkungen) below).
:::

::: tip Own package since ADR 0024
`Xtractor` lives in `@small-world-machine/tools` (`packages/tools/`), a separate workspace package layered on top of `@small-world-machine/engine` — see [ADR 0024](/adr/0024-tools-ecosystem-package).
:::

## Loading an image

Three ways to get an image onto the canvas, all of which land at the same 1:1 pixel-scale canvas (on-screen zoom is CSS scaling, not resampling):

- **Upload** — the "Upload Image" button opens a file picker dialog.
- **Drag & drop** — drag an image file anywhere onto the canvas.
- **URL** — paste a URL into the text field and click "Load". Cross-origin images that don't send permissive CORS headers won't load; Xtractor shows an explanatory message instead of proxying the request — downloading the image and uploading it locally is the reliable fallback.
- **Paste from clipboard** — `Ctrl/Cmd+V`, while Xtractor is the topmost visible Forge window, pastes an image directly from your clipboard. This only works when Xtractor is docked in the Forge overlay; the standalone page has no paste handling.

## Selecting a region

Two selection tools, switchable via the toolbar:

- **Rect** (default) — draw a rectangular selection by click-and-drag (minimum 10×10px).
- **Circle** — the same click-and-drag gesture, but crops to an elliptical/circular region instead of a rectangle.
- **Hand** — pans the canvas instead of drawing a selection.

Once a selection exists, you can:

- **Drag** it to reposition, or edit the **X/Y/W/H** number fields for pixel-precise adjustment.
- **Zoom** with the +/- buttons or `Ctrl` + mouse wheel (10%–1000%, zooms around the cursor).
- **Clear** it with the Clear Selection button.

## Sending a crop to Pixler

Once a selection exists, a preview pill with a **"Send to Pixler"** button appears above the chat panel. Clicking it sends the crop (as a PNG data URL) directly into the docked [Pixler](/guides/pixler) window via the engine's shared event bus — this is the one fully functional cross-tool integration in this tool. There is no equivalent handoff to Map Generator or Material Studio.

## The chat panel

::: warning This is a mockup, not a real AI assistant
The chat panel on the right looks like an AI assistant, but is not connected to any vision model or backend. It's a hardcoded, regex-based demo: if your message (with an active selection) contains a keyword like "10", "slice", or "cut", it slices the selection into 10 fixed-width vertical strips and shows each as a downloadable PNG. Anything else gets a generic "tell me what to do" response. The source has an explicit `@DEVELOPER_NOTE` marking this as a placeholder for a real `fetch()` call to a vision model backend.
:::

Today this is the only export path in the tool — there is no "download crop" or "copy to clipboard" button for a selection alone; you either send it to Pixler or ask the mock chat to cut it into ten pieces.

## Limitations {#einschraenkungen}

- **PDF upload does not work.** The file picker dialog accepts PDFs, but selecting one just shows a message that PDF support is planned for "Phase 2" — no PDF.js integration exists yet.
- **The chat assistant is entirely a mockup** (see above) — no real AI backend is wired up.
- **Slicing is hardcoded to 10 equal vertical strips.** There is no configurable grid size, no rows, no atlas/metadata export — this falls well short of a general sprite atlas generator.
- **No state persistence.** Reopening the Forge window loses your loaded image, selection, and chat history.
- **The standalone `xtractor.html` page is a separate copy** of the tool with no event bus — no Pixler handoff, no clipboard paste. Any feature added to the real `Xtractor` class has to be ported there by hand to stay in sync.
