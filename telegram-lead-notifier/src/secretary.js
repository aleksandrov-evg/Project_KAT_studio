/**
 * Lightweight secretary intent parser (mirrors katfit-studio lead-actions).
 * Reply text → LeadAction API payload fields.
 */

const LOST_REASONS = new Set([
  "NO_RESPONSE",
  "NO_SUITABLE_TIME",
  "PRICE",
  "LOCATION",
  "FORMAT_MISMATCH",
  "CHANGED_MIND",
  "DUPLICATE",
  "OTHER",
]);

/**
 * @param {string} text
 * @returns {{ action: string, lostReason?: string, note: string } | null}
 */
export function parseSecretaryIntent(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower.startsWith("/note ") || lower === "/note") {
    const note = raw.replace(/^\/note\s*/i, "").trim() || raw;
    return { action: "note", note };
  }

  const lostMatch = lower.match(
    /(?:потерян|отказ|lost)\s*(?::|-)?\s*(нет ответа|время|цена|локация|формат|передумал|дубль|другое)?/i,
  );
  if (lostMatch || /^(потерян|отказ|lost)\b/.test(lower)) {
    const reasonMap = {
      "нет ответа": "NO_RESPONSE",
      время: "NO_SUITABLE_TIME",
      цена: "PRICE",
      локация: "LOCATION",
      формат: "FORMAT_MISMATCH",
      передумал: "CHANGED_MIND",
      дубль: "DUPLICATE",
      другое: "OTHER",
    };
    const hint = (lostMatch?.[1] ?? "").toLowerCase();
    const lostReason = reasonMap[hint] ?? "OTHER";
    if (!LOST_REASONS.has(lostReason)) return { action: "lost", lostReason: "OTHER", note: raw };
    return { action: "lost", lostReason, note: raw };
  }

  if (
    /недозвон|не ответил|не бер[её]т|нет ответа|не дозвони|написала?,?\s*но\s*никто|написала?,?\s*нет ответа|никто не ответил|молчит|без ответа/.test(
      lower,
    )
  ) {
    return { action: "no_answer", note: raw };
  }
  if (/no[\s-]?show|не приш|не явил/.test(lower)) {
    return { action: "no_show", note: raw };
  }
  if (/купил|оплатил|первая покупка|пакет куплен/.test(lower)) {
    return { action: "first_purchase", note: raw };
  }
  if (/посетил intro|был на intro|intro состоял|приш[её]л на intro/.test(lower)) {
    return { action: "intro_attended", note: raw };
  }
  if (/записал.*intro|intro записан|бронь intro|записана на/.test(lower)) {
    return { action: "intro_booked", note: raw };
  }
  if (/согласил.*intro|предложил.*intro|intro предложен|предложила intro/.test(lower)) {
    return { action: "intro_offered", note: raw };
  }
  if (/думает|ушла думать|пока подума/.test(lower)) {
    return { action: "contacted", note: raw };
  }
  if (
    /дозвонил|связал|контакт состоял|поговорил|пообщал|переписк|ответил[аи]? в (мессенджер|телеграм|whatsapp|вотсап|почт)|написала? ответ|по почте/.test(
      lower,
    )
  ) {
    return { action: "contacted", note: raw };
  }

  return { action: "note", note: raw };
}
