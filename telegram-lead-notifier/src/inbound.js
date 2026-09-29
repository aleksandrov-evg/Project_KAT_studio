import { postLeadAction, personDeepLink } from "./crm-actions.js";
import {
  findTelegramLeadByMessage,
  getCrmIdsForLead,
  updateTelegramLeadMessageState,
} from "./database.js";
import {
  ACTION_LABELS,
  keyboardForStage,
  keyboardLostReasons,
  parseCallbackData,
} from "./keyboards.js";
import { resolveManager } from "./managers.js";
import { formatLeadMessage, formatStatusLine } from "./message.js";
import { parseSecretaryIntent } from "./secretary.js";
import {
  answerCallbackQuery,
  editTelegramMessage,
} from "./telegram.js";

function stageAfterAction(action, previousStage, resultStage) {
  if (resultStage) return resultStage;
  if (action === "no_answer" || action === "note" || action === "no_show") {
    return previousStage || "WAITLIST";
  }
  return previousStage || "WAITLIST";
}

async function refreshLeadCard(config, dbClient, mapping, {
  statusLine,
  clientStage,
  personId,
}) {
  const snapshot = mapping.lead_snapshot || {
    id: mapping.lead_id,
    name: `Заявка #${mapping.lead_id}`,
    contact: "",
    interests: [],
    created_at: new Date().toISOString(),
  };
  const deepLink = personDeepLink(config, personId || mapping.person_id);
  const text = formatLeadMessage(snapshot, { deepLink, statusLine });
  const replyMarkup = keyboardForStage(mapping.lead_id, clientStage);
  await editTelegramMessage(config, {
    chatId: mapping.chat_id,
    messageId: mapping.message_id,
    text,
    replyMarkup: replyMarkup.inline_keyboard.length ? replyMarkup : { inline_keyboard: [] },
  });
}

async function applyLeadAction(config, dbClient, mapping, {
  action,
  note,
  lostReason,
  actorLabel,
  clientEventId,
}) {
  const crmIds = await getCrmIdsForLead(dbClient, mapping.lead_id);
  const payload = {
    landingLeadId: String(mapping.lead_id),
    personId: mapping.person_id || crmIds?.person_id || null,
    opportunityId: mapping.opportunity_id || crmIds?.opportunity_id || null,
    action,
    note: note || null,
    lostReason: lostReason || null,
    actorLabel: actorLabel || null,
    clientEventId,
  };

  const result = await postLeadAction(config, payload);
  const clientStage = stageAfterAction(
    action,
    mapping.client_stage,
    result.clientStage,
  );

  await updateTelegramLeadMessageState(dbClient, {
    chatId: mapping.chat_id,
    messageId: mapping.message_id,
    personId: result.personId,
    opportunityId: result.opportunityId,
    clientStage,
  });

  const statusLine = formatStatusLine({
    actionLabel: ACTION_LABELS[action] || action,
    actorLabel,
    clientStage,
    lostReason,
  });

  await refreshLeadCard(config, dbClient, {
    ...mapping,
    person_id: result.personId,
    opportunity_id: result.opportunityId,
    client_stage: clientStage,
  }, {
    statusLine,
    clientStage,
    personId: result.personId,
  });

  return { result, clientStage, statusLine };
}

export async function handleCallbackQuery(config, dbClient, callbackQuery) {
  const data = parseCallbackData(callbackQuery.data);
  const manager = resolveManager(config, callbackQuery.from);

  if (!manager.allowed) {
    await answerCallbackQuery(config, callbackQuery.id, "Нет доступа");
    return { handled: true, reason: "forbidden" };
  }

  if (!data?.leadId) {
    await answerCallbackQuery(config, callbackQuery.id, "Некорректная кнопка");
    return { handled: true, reason: "bad_callback" };
  }

  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  if (chatId == null || messageId == null) {
    await answerCallbackQuery(config, callbackQuery.id, "Нет сообщения");
    return { handled: true, reason: "no_message" };
  }

  let mapping = await findTelegramLeadByMessage(dbClient, chatId, messageId);
  if (!mapping) {
    mapping = {
      chat_id: chatId,
      message_id: messageId,
      lead_id: Number(data.leadId),
      person_id: null,
      opportunity_id: null,
      client_stage: "WAITLIST",
      lead_snapshot: null,
    };
  }

  if (data.kind === "lost_menu" || data.kind === "back") {
    const deepLink = personDeepLink(config, mapping.person_id);
    const text = formatLeadMessage(mapping.lead_snapshot || {
      id: mapping.lead_id,
      name: `Заявка #${mapping.lead_id}`,
      contact: "",
      interests: [],
      created_at: new Date().toISOString(),
    }, { deepLink });
    const replyMarkup = data.kind === "lost_menu"
      ? keyboardLostReasons(mapping.lead_id)
      : keyboardForStage(mapping.lead_id, mapping.client_stage);
    await editTelegramMessage(config, {
      chatId,
      messageId,
      text,
      replyMarkup,
    });
    await answerCallbackQuery(
      config,
      callbackQuery.id,
      data.kind === "lost_menu" ? "Выберите причину" : undefined,
    );
    return { handled: true, reason: data.kind };
  }

  if (!config.crmSyncEnabled) {
    await answerCallbackQuery(config, callbackQuery.id, "CRM sync выключен");
    return { handled: true, reason: "crm_disabled" };
  }

  try {
    const clientEventId = `tg:cb:${callbackQuery.id}`;
    await applyLeadAction(config, dbClient, mapping, {
      action: data.action,
      note: null,
      lostReason: data.lostReason,
      actorLabel: manager.label,
      clientEventId,
    });
    await answerCallbackQuery(
      config,
      callbackQuery.id,
      ACTION_LABELS[data.action] || "OK",
    );
    return { handled: true, reason: "action_ok", action: data.action };
  } catch (error) {
    await answerCallbackQuery(
      config,
      callbackQuery.id,
      `Ошибка: ${String(error.message).slice(0, 150)}`,
    );
    throw error;
  }
}

export async function handleReplyMessage(config, dbClient, message) {
  const replyTo = message.reply_to_message;
  if (!replyTo) return { handled: false };

  const chatId = message.chat?.id;
  if (String(chatId) !== String(config.telegramChatId)) {
    return { handled: false, reason: "wrong_chat" };
  }

  const manager = resolveManager(config, message.from);
  if (!manager.allowed) {
    return { handled: true, reason: "forbidden" };
  }

  const mapping = await findTelegramLeadByMessage(
    dbClient,
    chatId,
    replyTo.message_id,
  );
  if (!mapping) {
    return { handled: false, reason: "not_lead_card" };
  }

  if (!config.crmSyncEnabled) {
    return { handled: true, reason: "crm_disabled" };
  }

  const text = String(message.text || message.caption || "").trim();
  if (!text) return { handled: true, reason: "empty" };

  const intent = parseSecretaryIntent(text);
  if (!intent) return { handled: true, reason: "empty" };

  const clientEventId = `tg:msg:${message.chat.id}:${message.message_id}`;
  await applyLeadAction(config, dbClient, mapping, {
    action: intent.action,
    note: intent.note,
    lostReason: intent.lostReason || null,
    actorLabel: manager.label,
    clientEventId,
  });

  return { handled: true, reason: "reply_ok", action: intent.action };
}

export async function processTelegramUpdate(config, dbClient, update) {
  if (update.callback_query) {
    return handleCallbackQuery(config, dbClient, update.callback_query);
  }
  if (update.message) {
    return handleReplyMessage(config, dbClient, update.message);
  }
  return { handled: false };
}
