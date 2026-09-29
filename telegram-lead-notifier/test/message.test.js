import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeCallback,
  keyboardForStage,
  keyboardLostReasons,
  parseCallbackData,
} from "../src/keyboards.js";
import { parseSecretaryIntent } from "../src/secretary.js";
import { parseManagerWhitelist, resolveManager } from "../src/managers.js";
import {
  buildMessengerLinks,
  escapeHtml,
  formatLeadMessage,
  formatStatusHistory,
  formatStatusLine,
} from "../src/message.js";

test("escapeHtml protects Telegram HTML", () => {
  assert.equal(escapeHtml('<Kate & "Co">'), "&lt;Kate &amp; &quot;Co&quot;&gt;");
});

test("buildMessengerLinks builds Telegram and WhatsApp deep links", () => {
  const links = buildMessengerLinks("+7 900 000-00-00");
  assert.equal(links.telegram, "https://t.me/+79000000000");
  assert.equal(links.whatsapp, "https://wa.me/79000000000");
  assert.equal(links.max, null);
  assert.equal(buildMessengerLinks("anna@example.com"), null);
});

test("formatLeadMessage includes useful lead data and deep link", () => {
  const message = formatLeadMessage({
    id: "42",
    name: "Анна <3",
    contact: "+7 900 000-00-00",
    interests: ["reformer", "stretching"],
    created_at: "2026-09-20T09:00:00.000Z",
    utm_source: "telegram",
    utm_campaign: null,
  }, {
    deepLink: "https://crm.example.com/objects/people/abc",
    statusHistory: [
      {
        at: "2026-09-20T10:00:00.000Z",
        actionLabel: "Пообщались",
        clientStage: "CONTACTED",
        actorLabel: "Анна",
      },
      {
        at: "2026-09-20T12:30:00.000Z",
        actionLabel: "Нет ответа",
        clientStage: "CONTACTED",
        actorLabel: "Анна",
      },
    ],
  });
  assert.match(message, /Анна &lt;3/);
  assert.match(message, /Реформер, Стретчинг/);
  assert.match(message, /ID заявки:<\/b> 42/);
  assert.match(message, /Открыть в CRM/);
  assert.match(message, /Пообщались/);
  assert.match(message, /Нет ответа/);
  assert.match(message, /МСК —/);
  assert.match(message, /<code>\+79000000000<\/code>/);
  assert.match(message, /тап — скопировать/);
  assert.match(message, /t\.me\/\+79000000000/);
  assert.match(message, /wa\.me\/79000000000/);
  assert.match(message, /Написать:/);
  assert.doesNotMatch(message, /Кампания/);
});

test("formatStatusHistory keeps all entries with timestamps", () => {
  const block = formatStatusHistory([
    {
      at: "2026-09-20T10:00:00.000Z",
      actionLabel: "Пообщались",
      clientStage: "CONTACTED",
      actorLabel: "Анна",
    },
    {
      at: "2026-09-21T08:15:00.000Z",
      actionLabel: "Записала intro",
      clientStage: "INTRO_BOOKED",
      actorLabel: "Борис",
    },
  ]);
  assert.match(block, /Пообщались/);
  assert.match(block, /Записала intro/);
  assert.match(block, /Анна/);
  assert.match(block, /Борис/);
  assert.equal(block.split("\n").length, 2);
});

test("callback encode/parse roundtrip", () => {
  assert.deepEqual(parseCallbackData(encodeCallback("contacted", 42)), {
    action: "contacted",
    lostReason: null,
    leadId: "42",
    kind: "action",
  });
  assert.deepEqual(parseCallbackData(encodeCallback("lost", 7, "PRICE")), {
    action: "lost",
    lostReason: "PRICE",
    leadId: "7",
    kind: "action",
  });
  assert.equal(parseCallbackData("lostmenu:9").kind, "lost_menu");
});

test("keyboardForStage returns buttons for new leads", () => {
  const kb = keyboardForStage(1, "WAITLIST", { contact: "+79001112233" });
  assert.ok(kb.inline_keyboard.length >= 2);
  const urls = kb.inline_keyboard[0].map((b) => b.url);
  assert.ok(urls.includes("https://t.me/+79001112233"));
  assert.ok(urls.includes("https://wa.me/79001112233"));
  const flat = kb.inline_keyboard.flat().map((b) => b.callback_data).filter(Boolean);
  assert.ok(flat.includes("contacted:1"));
  assert.ok(flat.includes("lostmenu:1"));
});

test("keyboardLostReasons includes back", () => {
  const kb = keyboardLostReasons(5);
  const flat = kb.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(flat.includes("lost:PRICE:5"));
  assert.ok(flat.includes("back:5"));
});

test("parseSecretaryIntent detects funnel phrases", () => {
  assert.equal(parseSecretaryIntent("Написала, никто не ответил").action, "no_answer");
  assert.equal(parseSecretaryIntent("Пообщались в мессенджере, ок").action, "contacted");
  assert.equal(parseSecretaryIntent("Потерян: цена").lostReason, "PRICE");
  assert.equal(parseSecretaryIntent("Записала на intro среду").action, "intro_booked");
  assert.equal(parseSecretaryIntent("просто заметка").action, "note");
});

test("manager whitelist", () => {
  const map = parseManagerWhitelist("111:Анна,222:Борис");
  assert.equal(map.get("111"), "Анна");
  const allowed = resolveManager({ managerWhitelist: map }, { id: 111, first_name: "X" });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.label, "Анна");
  const denied = resolveManager({ managerWhitelist: map }, { id: 999 });
  assert.equal(denied.allowed, false);
});

test("formatStatusLine", () => {
  assert.match(
    formatStatusLine({
      actionLabel: "Пообщались",
      actorLabel: "Анна",
      clientStage: "CONTACTED",
    }),
    /Анна/,
  );
});
