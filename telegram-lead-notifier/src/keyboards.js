/** Inline keyboards and callback_data helpers (Telegram limit 64 bytes). */

export const LOST_REASON_LABELS = {
  NO_RESPONSE: "Нет ответа",
  NO_SUITABLE_TIME: "Нет времени",
  PRICE: "Цена",
  LOCATION: "Локация",
  FORMAT_MISMATCH: "Формат",
  CHANGED_MIND: "Передумал",
  DUPLICATE: "Дубль",
  OTHER: "Другое",
};

const LOST_REASONS = Object.keys(LOST_REASON_LABELS);

export function encodeCallback(action, leadId, lostReason = null) {
  if (lostReason) return `lost:${lostReason}:${leadId}`;
  return `${action}:${leadId}`;
}

export function parseCallbackData(data) {
  const raw = String(data ?? "");
  if (raw.startsWith("lost:") && raw.split(":").length >= 3) {
    const [, reason, ...rest] = raw.split(":");
    return {
      action: "lost",
      lostReason: reason,
      leadId: rest.join(":"),
      kind: "action",
    };
  }
  if (raw.startsWith("lostmenu:")) {
    return {
      action: null,
      lostReason: null,
      leadId: raw.slice("lostmenu:".length),
      kind: "lost_menu",
    };
  }
  if (raw.startsWith("back:")) {
    return {
      action: null,
      lostReason: null,
      leadId: raw.slice("back:".length),
      kind: "back",
    };
  }
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  return {
    action: raw.slice(0, idx),
    lostReason: null,
    leadId: raw.slice(idx + 1),
    kind: "action",
  };
}

function btn(text, callbackData) {
  return { text, callback_data: callbackData };
}

export function keyboardForStage(leadId, clientStage = "WAITLIST") {
  const id = String(leadId);
  const stage = clientStage || "WAITLIST";

  if (stage === "FIRST_PURCHASE" || stage === "LOST") {
    return { inline_keyboard: [] };
  }

  if (stage === "INTRO_ATTENDED") {
    return {
      inline_keyboard: [
        [
          btn("Купила пакет", encodeCallback("first_purchase", id)),
          btn("Потерян", `lostmenu:${id}`),
        ],
      ],
    };
  }

  if (stage === "INTRO_BOOKED") {
    return {
      inline_keyboard: [
        [
          btn("Посетила intro", encodeCallback("intro_attended", id)),
          btn("No-show", encodeCallback("no_show", id)),
        ],
        [btn("Потерян", `lostmenu:${id}`)],
      ],
    };
  }

  if (stage === "INTRO_OFFERED") {
    return {
      inline_keyboard: [
        [
          btn("Записала intro", encodeCallback("intro_booked", id)),
          btn("Потерян", `lostmenu:${id}`),
        ],
      ],
    };
  }

  if (stage === "CONTACTED") {
    return {
      inline_keyboard: [
        [
          btn("Предложила intro", encodeCallback("intro_offered", id)),
          btn("Записала intro", encodeCallback("intro_booked", id)),
        ],
        [btn("Потерян", `lostmenu:${id}`)],
      ],
    };
  }

  // WAITLIST / NEW_LEAD / unknown
  return {
    inline_keyboard: [
      [
        btn("Пообщались", encodeCallback("contacted", id)),
        btn("Нет ответа", encodeCallback("no_answer", id)),
      ],
      [
        btn("Написать снова", encodeCallback("no_answer", id)),
        btn("Предложила intro", encodeCallback("intro_offered", id)),
      ],
      [btn("Потерян", `lostmenu:${id}`)],
    ],
  };
}

export function keyboardLostReasons(leadId) {
  const id = String(leadId);
  const rows = [];
  for (let i = 0; i < LOST_REASONS.length; i += 2) {
    const chunk = LOST_REASONS.slice(i, i + 2).map((reason) =>
      btn(LOST_REASON_LABELS[reason], encodeCallback("lost", id, reason)),
    );
    rows.push(chunk);
  }
  rows.push([btn("← Назад", `back:${id}`)]);
  return { inline_keyboard: rows };
}

export const ACTION_LABELS = {
  note: "Заметка",
  no_answer: "Нет ответа",
  contacted: "Пообщались",
  intro_offered: "Предложено intro",
  intro_booked: "Intro записано",
  intro_attended: "Intro посещено",
  no_show: "No-show",
  first_purchase: "Первая покупка",
  lost: "Потерян",
};
