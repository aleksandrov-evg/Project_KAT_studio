import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, formatLeadMessage } from "../src/message.js";

test("escapeHtml protects Telegram HTML", () => {
  assert.equal(escapeHtml('<Kate & "Co">'), "&lt;Kate &amp; &quot;Co&quot;&gt;");
});

test("formatLeadMessage includes useful lead data", () => {
  const message = formatLeadMessage({
    id: "42",
    name: "Анна <3",
    contact: "+7 900 000-00-00",
    interests: ["reformer", "stretching"],
    created_at: "2026-09-20T09:00:00.000Z",
    utm_source: "telegram",
    utm_campaign: null,
  });
  assert.match(message, /Анна &lt;3/);
  assert.match(message, /Реформер, Стретчинг/);
  assert.match(message, /ID заявки:<\/b> 42/);
  assert.doesNotMatch(message, /Кампания/);
});
