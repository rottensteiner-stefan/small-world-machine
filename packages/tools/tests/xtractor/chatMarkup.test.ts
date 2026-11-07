import { describe, it, expect } from "vitest";
import { renderChatMarkup } from "../../src/xtractor/chatMarkup.js";
import { escapeHtml } from "../../src/common/escapeHtml.js";

describe("chat markup", () => {
  it("escapes HTML from remote or user text", () => {
    expect(renderChatMarkup('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escapeHtml(`a&b<'"`)).toBe("a&amp;b&lt;&#39;&quot;");
  });

  it("renders the markdown subset after escaping", () => {
    expect(renderChatMarkup("**fett** und `code`\nzeile 2")).toBe(
      "<strong>fett</strong> und <code>code</code><br/>zeile 2",
    );
    expect(renderChatMarkup("```js\n<b>x</b>\n```")).toBe(
      "<pre><code>&lt;b&gt;x&lt;/b&gt;<br/></code></pre>",
    );
  });
});
