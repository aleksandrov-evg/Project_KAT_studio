import { parseContact } from "./crm-mapping.js";

const INTEREST_LABELS = {
  reformer: "Реформер",
  pilates: "Пилатес",
  stretching: "Стретчинг",
  personal: "Персональная тренировка",
  undecided: "Пока не определился(ась)",
};

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function line(label, value) {
  if (value === null || value === undefined || value === "") return null;
  return `<b>${label}:</b> ${escapeHtml(value)}`;
}

/** `<code>` в Telegram — тап копирует в буфер без выделения. */
function copyable(value) {
  if (value === null || value === undefined || value === "") return null;
  return `<code>${escapeHtml(value)}</code>`;
}

/**
 * Deep links to open a chat with the lead by phone.
 * WhatsApp / Telegram — публичные схемы по номеру.
 * MAX — публичного deep link «чат по номеру» нет (только поиск в приложении).
 */
export function buildMessengerLinks(contact) {
  const { e164 } = parseContact(contact);
  if (!e164) return null;
  const digits = e164.replace(/\D/g, "");
  return {
    e164,
    digits,
    telegram: `https://t.me/+${digits}`,
    whatsapp: `https://wa.me/${digits}`,
    max: null,
  };
}

/** Контакт в `<code>`: тап → копирование (удобно вставить в MAX / поиск). */
function formatContactLine(contact) {
  const raw = String(contact ?? "").trim();
  if (!raw) return null;
  const { e164, email } = parseContact(raw);
  const value = e164 || email || raw;
  return `<b>Контакт:</b> ${copyable(value)} <i>(тап — скопировать)</i>`;
}

function formatMessengerLinksLine(links) {
  if (!links) return null;
  const parts = [
    `<a href="${escapeHtml(links.telegram)}">Telegram</a>`,
    `<a href="${escapeHtml(links.whatsapp)}">WhatsApp</a>`,
    "MAX — вставить номер в поиск",
  ];
  return `<b>Написать:</b> ${parts.join(" · ")}`;
}

const moscowDateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Moscow",
});

export function formatMoscowDateTime(value) {
  if (!value) return null;
  return `${moscowDateTime.format(new Date(value))} МСК`;
}

export function formatLeadMessage(lead, { deepLink = null, statusHistory = null } = {}) {
  const interests = Array.isArray(lead.interests) && lead.interests.length
    ? lead.interests.map((value) => INTEREST_LABELS[value] ?? value).join(", ")
    : "Не указано";
  const createdAt = formatMoscowDateTime(lead.created_at);
  const messengerLinks = buildMessengerLinks(lead.contact);

  const lines = [
    "🔔 <b>Новая заявка на тренировку</b>",
    "",
    line("Имя", lead.name),
    formatContactLine(lead.contact),
    formatMessengerLinksLine(messengerLinks),
    line("Интерес", interests),
    line("Получена", createdAt),
    line("Источник", lead.utm_source),
    line("Кампания", lead.utm_campaign),
    line("ID заявки", lead.id),
  ];

  if (deepLink) {
    lines.push(`<a href="${escapeHtml(deepLink)}">Открыть в CRM</a>`);
  }

  const historyBlock = formatStatusHistory(statusHistory);
  if (historyBlock) {
    lines.push("", historyBlock);
  }

  lines.push(
    "",
    "<i>Кнопки — статус в CRM. Ответом на сообщение — заметка / секретарь.</i>",
  );

  return lines.filter((value) => value !== null).join("\n");
}

export function formatStatusLine({ actionLabel, actorLabel, clientStage, lostReason }) {
  const parts = [actionLabel];
  if (lostReason) parts.push(`(${lostReason})`);
  if (clientStage) parts.push(`→ ${clientStage}`);
  if (actorLabel) parts.push(`· ${actorLabel}`);
  return parts.join(" ");
}

/** Append-only status log for the Telegram lead card. */
export function formatStatusHistory(statusHistory) {
  if (!Array.isArray(statusHistory) || statusHistory.length === 0) return null;
  return statusHistory
    .map((entry) => {
      const when = formatMoscowDateTime(entry.at) || "—";
      const detail = formatStatusLine(entry);
      return `✅ ${escapeHtml(`${when} — ${detail}`)}`;
    })
    .join("\n");
}
