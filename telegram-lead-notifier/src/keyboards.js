/** Inline keyboards and callback_data helpers (Telegram limit 64 bytes). */

import { buildMessengerLinks } from "./message.js";

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

/** First-touch channels → CRM note + status line. */
export const CONTACT_CHANNELS = {
  call: { id: "call", label: "Звонок", verb: "позвонила", short: "📞 Звонок", crm: "CALL" },
  sms: { id: "sms", label: "SMS", verb: "написала SMS", short: "SMS", crm: "SMS" },
  max: { id: "max", label: "MAX", verb: "написала в MAX", short: "MAX", crm: "MAX" },
  telegram: { id: "telegram", label: "Telegram", verb: "написала в Telegram", short: "Telegram", crm: "TELEGRAM" },
  whatsapp: { id: "whatsapp", label: "WhatsApp", verb: "написала в WhatsApp", short: "WhatsApp", crm: "WHATSAPP" },
};

/** Sentinel: show channel picker while staying on CONTACTED. */
export const PICK_CHANNEL_SENTINEL = "pick";

export const CONTACT_CHANNEL_IDS = Object.keys(CONTACT_CHANNELS);

export function channelLabel(channelId) {
  return CONTACT_CHANNELS[channelId]?.label || channelId || null;
}

export function channelVerb(channelId) {
  return CONTACT_CHANNELS[channelId]?.verb || "связалась";
}

/** Map bot channel id → CRM lastContactChannel enum. */
export function toCrmChannel(channelId) {
  return CONTACT_CHANNELS[channelId]?.crm || null;
}

export function encodeCallback(action, leadId, lostReason = null) {
  if (lostReason) return `lost:${lostReason}:${leadId}`;
  return `${action}:${leadId}`;
}

export function encodeChannel(channelId, leadId) {
  return `ch:${channelId}:${leadId}`;
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
      channel: null,
      outcome: null,
    };
  }
  if (raw.startsWith("lostmenu:")) {
    return {
      action: null,
      lostReason: null,
      leadId: raw.slice("lostmenu:".length),
      kind: "lost_menu",
      channel: null,
      outcome: null,
    };
  }
  if (raw.startsWith("back:")) {
    return {
      action: null,
      lostReason: null,
      leadId: raw.slice("back:".length),
      kind: "back",
      channel: null,
      outcome: null,
    };
  }
  if (raw.startsWith("ch:")) {
    const parts = raw.split(":");
    if (parts.length >= 3 && CONTACT_CHANNELS[parts[1]]) {
      return {
        action: null,
        lostReason: null,
        leadId: parts.slice(2).join(":"),
        kind: "channel",
        channel: parts[1],
        outcome: null,
      };
    }
    return null;
  }
  if (raw.startsWith("out:")) {
    const parts = raw.split(":");
    if (parts.length >= 3) {
      const outcome = parts[1];
      if (["no_answer", "replied", "thinking"].includes(outcome)) {
        return {
          action: null,
          lostReason: null,
          leadId: parts.slice(2).join(":"),
          kind: "outcome",
          channel: null,
          outcome,
        };
      }
    }
    return null;
  }
  if (raw.startsWith("again:")) {
    return {
      action: null,
      lostReason: null,
      leadId: raw.slice("again:".length),
      kind: "write_again",
      channel: null,
      outcome: null,
    };
  }
  if (raw.startsWith("chmenu:")) {
    return {
      action: null,
      lostReason: null,
      leadId: raw.slice("chmenu:".length),
      kind: "channel_menu",
      channel: null,
      outcome: null,
    };
  }
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  return {
    action: raw.slice(0, idx),
    lostReason: null,
    leadId: raw.slice(idx + 1),
    kind: "action",
    channel: null,
    outcome: null,
  };
}

function btn(text, callbackData) {
  return { text, callback_data: callbackData };
}

/** URL-кнопки «открыть чат с клиентом» (Telegram / WhatsApp). MAX — без публичной схемы. */
export function messengerUrlRow(contact) {
  const links = buildMessengerLinks(contact);
  if (!links) return null;
  return [
    { text: "Открыть TG", url: links.telegram },
    { text: "Открыть WA", url: links.whatsapp },
  ];
}

function withMessengerRow(keyboard, contact) {
  const row = messengerUrlRow(contact);
  if (!row) return keyboard;
  return {
    inline_keyboard: [row, ...(keyboard.inline_keyboard || [])],
  };
}

function channelPickerRows(leadId, { showWriteAgain = false } = {}) {
  const id = String(leadId);
  const rows = [];
  if (showWriteAgain) {
    rows.push([btn("Написать снова", `again:${id}`)]);
  }
  rows.push([
    btn(CONTACT_CHANNELS.call.short, encodeChannel("call", id)),
    btn(CONTACT_CHANNELS.sms.short, encodeChannel("sms", id)),
    btn(CONTACT_CHANNELS.max.short, encodeChannel("max", id)),
  ]);
  rows.push([
    btn(CONTACT_CHANNELS.telegram.short, encodeChannel("telegram", id)),
    btn(CONTACT_CHANNELS.whatsapp.short, encodeChannel("whatsapp", id)),
  ]);
  rows.push([btn("Потерян", `lostmenu:${id}`)]);
  return rows;
}

function outcomeRows(leadId) {
  const id = String(leadId);
  return [
    [
      btn("Нет ответа", `out:no_answer:${id}`),
      btn("Ответили", `out:replied:${id}`),
      btn("Думает", `out:thinking:${id}`),
    ],
    [
      btn("← Другой канал", `chmenu:${id}`),
      btn("Потерян", `lostmenu:${id}`),
    ],
  ];
}

function contactedMainRows(leadId) {
  const id = String(leadId);
  return [
    [
      btn("Предложила intro", encodeCallback("intro_offered", id)),
      btn("Согласилась на intro", encodeCallback("intro_agreed", id)),
    ],
    [btn("Записала intro", encodeCallback("intro_booked", id))],
    [btn("Написать снова", `again:${id}`)],
    [btn("Потерян", `lostmenu:${id}`)],
  ];
}

/**
 * Last status entry was «нет ответа» → show «Написать снова» on channel picker.
 */
export function lastStatusWasNoAnswer(statusHistory) {
  if (!Array.isArray(statusHistory) || statusHistory.length === 0) return false;
  const last = statusHistory[statusHistory.length - 1];
  const label = String(last?.actionLabel || "");
  return (
    last?.action === "no_answer"
    || label === "Нет ответа"
    || label.startsWith("Нет ответа ")
    || label.startsWith("Нет ответа (")
  );
}

function isEarlyStage(stage) {
  return !stage || stage === "WAITLIST" || stage === "NEW_LEAD";
}

function isRealChannel(channelId) {
  return Boolean(channelId && CONTACT_CHANNELS[channelId]);
}

/**
 * @param {object} opts
 * @param {string|null} [opts.contact]
 * @param {string|null} [opts.pendingChannel]
 * @param {Array} [opts.statusHistory]
 */
export function keyboardForStage(
  leadId,
  clientStage = "WAITLIST",
  { contact = null, pendingChannel = null, statusHistory = null } = {},
) {
  const id = String(leadId);
  const stage = clientStage || "WAITLIST";

  let keyboard;
  if (stage === "FIRST_PURCHASE" || stage === "LOST") {
    keyboard = { inline_keyboard: [] };
  } else if (stage === "INTRO_ATTENDED") {
    keyboard = {
      inline_keyboard: [
        [
          btn("Купила пакет", encodeCallback("first_purchase", id)),
          btn("Потерян", `lostmenu:${id}`),
        ],
      ],
    };
  } else if (stage === "INTRO_BOOKED") {
    keyboard = {
      inline_keyboard: [
        [
          btn("Посетила intro", encodeCallback("intro_attended", id)),
          btn("No-show", encodeCallback("no_show", id)),
        ],
        [btn("Потерян", `lostmenu:${id}`)],
      ],
    };
  } else if (stage === "INTRO_OFFERED") {
    keyboard = {
      inline_keyboard: [
        [
          btn("Записала intro", encodeCallback("intro_booked", id)),
          btn("Потерян", `lostmenu:${id}`),
        ],
      ],
    };
  } else if (stage === "CONTACTED") {
    if (isRealChannel(pendingChannel)) {
      keyboard = { inline_keyboard: outcomeRows(id) };
    } else if (pendingChannel === PICK_CHANNEL_SENTINEL) {
      keyboard = {
        inline_keyboard: channelPickerRows(id, { showWriteAgain: false }),
      };
    } else {
      keyboard = { inline_keyboard: contactedMainRows(id) };
    }
  } else if (isEarlyStage(stage) && isRealChannel(pendingChannel)) {
    keyboard = { inline_keyboard: outcomeRows(id) };
  } else {
    keyboard = {
      inline_keyboard: channelPickerRows(id, {
        showWriteAgain: lastStatusWasNoAnswer(statusHistory),
      }),
    };
  }

  return withMessengerRow(keyboard, contact);
}

export function keyboardLostReasons(leadId, { contact = null } = {}) {
  const id = String(leadId);
  const rows = [];
  for (let i = 0; i < LOST_REASONS.length; i += 2) {
    const chunk = LOST_REASONS.slice(i, i + 2).map((reason) =>
      btn(LOST_REASON_LABELS[reason], encodeCallback("lost", id, reason)),
    );
    rows.push(chunk);
  }
  rows.push([btn("← Назад", `back:${id}`)]);
  return withMessengerRow({ inline_keyboard: rows }, contact);
}

export function noteForOutcome(outcome, channelId) {
  const channel = channelLabel(channelId) || "не указан";
  const verb = channelVerb(channelId);
  if (outcome === "no_answer") {
    return `Канал: ${channel}. ${verb[0].toUpperCase()}${verb.slice(1)} — ответа нет.`;
  }
  if (outcome === "thinking") {
    return `Канал: ${channel}. ${verb[0].toUpperCase()}${verb.slice(1)} — думает.`;
  }
  if (outcome === "replied") {
    return `Канал: ${channel}. ${verb[0].toUpperCase()}${verb.slice(1)} — ответили.`;
  }
  return `Канал: ${channel}.`;
}

export function noteForChannelAttempt(channelId) {
  return `Попытка: ${channelLabel(channelId) || channelId}.`;
}

export function statusLabelForOutcome(outcome, channelId) {
  const channel = channelLabel(channelId);
  const channelSuffix = channel ? ` (${channel})` : "";
  if (outcome === "no_answer") return `Нет ответа${channelSuffix}`;
  if (outcome === "thinking") return `Думает${channelSuffix}`;
  if (outcome === "replied") return `Ответили${channelSuffix}`;
  return channel ? `Канал: ${channel}` : "Касание";
}

export function statusLabelForChannelPick(channelId) {
  const verb = channelVerb(channelId);
  return `${verb[0].toUpperCase()}${verb.slice(1)}`;
}

export function hoursFromNowIso(hours, from = new Date()) {
  return new Date(from.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export const ACTION_LABELS = {
  note: "Заметка",
  no_answer: "Нет ответа",
  contacted: "Ответили",
  thinking: "Думает",
  intro_offered: "Предложила intro",
  intro_agreed: "Согласилась на intro",
  intro_booked: "Intro записано",
  intro_attended: "Intro посещено",
  no_show: "No-show",
  first_purchase: "Первая покупка",
  lost: "Потерян",
  channel_pick: "Канал",
};
