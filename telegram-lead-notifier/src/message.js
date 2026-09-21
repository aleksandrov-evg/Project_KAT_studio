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

export function formatLeadMessage(lead) {
  const interests = Array.isArray(lead.interests) && lead.interests.length
    ? lead.interests.map((value) => INTEREST_LABELS[value] ?? value).join(", ")
    : "Не указано";
  const createdAt = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(lead.created_at));

  return [
    "🔔 <b>Новая заявка на тренировку</b>",
    "",
    line("Имя", lead.name),
    line("Контакт", lead.contact),
    line("Интерес", interests),
    line("Получена", `${createdAt} МСК`),
    line("Источник", lead.utm_source),
    line("Кампания", lead.utm_campaign),
    line("ID заявки", lead.id),
  ].filter((value) => value !== null).join("\n");
}
