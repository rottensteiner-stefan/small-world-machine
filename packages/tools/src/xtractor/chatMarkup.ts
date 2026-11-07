import { escapeHtml } from "../common/escapeHtml.js";

/**
 * Renders the small markdown subset used in the chat (code blocks, inline code, bold, line breaks).
 * The input is escaped first, so the result is safe to assign to innerHTML.
 */
export function renderChatMarkup(rawText: string): string {
  return escapeHtml(rawText)
    .replace(
      /```([a-z]*)\n([\s\S]*?)```/g,
      (_match, _lang: string, code: string) => `<pre><code>${code}</code></pre>`,
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}
