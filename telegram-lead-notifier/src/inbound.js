import { syncLeadToCrm } from "./crm.js";
import {
  fetchLeadStatus,
  mapCrmNotesToStatusHistory,
  personDeepLink,
  postLeadAction,
  resolveLeadDeepLink,
} from "./crm-actions.js";
import {
  clearCrmPermanentError,
  findLatestTelegramLeadByLeadId,
  findTelegramLeadByMessage,
  getCrmIdsForLead,
  getLeadById,
  markCrmSynced,
  saveTelegramLeadMessage,
  updateTelegramLeadMessageState,
} from "./database.js";
import {
  ACTION_LABELS,
  CONTACT_CHANNELS,
  PICK_CHANNEL_SENTINEL,
  channelLabel,
  hoursFromNowIso,
  keyboardForStage,
  keyboardLostReasons,
  noteForChannelAttempt,
  noteForOutcome,
  parseCallbackData,
  statusLabelForChannelPick,
  statusLabelForOutcome,
  toCrmChannel,
} from "./keyboards.js";
import { resolveManager } from "./managers.js";
import { formatLeadMessage, formatStatusLine } from "./message.js";
import { parseResendCommand } from "./resend.js";
import { parseSecretaryIntent } from "./secretary.js";
import {
  answerCallbackQuery,
  editTelegramMessage,
  sendTelegramMessage,
} from "./telegram.js";

function stageAfterAction(action, previousStage, resultStage) {
  if (resultStage) return resultStage;
  if (action === "no_answer" || action === "note" || action === "no_show") {
    return previousStage || "WAITLIST";
  }
  return previousStage || "WAITLIST";
}

function keyboardOpts(mapping) {
  const snapshot = mapping.lead_snapshot || {};
  return {
    contact: snapshot.contact,
    pendingChannel: mapping.pending_channel || null,
    statusHistory: mapping.status_history || null,
  };
}

function isContactedStage(stage) {
  return stage === "CONTACTED";
}

async function ensureLeadInCrm(config, dbClient, leadId, mapping) {
  const existing = await getCrmIdsForLead(dbClient, leadId);
  if (existing?.status === "synced" && existing.person_id) {
    return {
      personId: existing.person_id,
      opportunityId: existing.opportunity_id,
    };
  }

  if (existing?.status === "permanent_error") {
    await clearCrmPermanentError(dbClient, leadId);
  }

  const lead = mapping.lead_snapshot?.id
    ? mapping.lead_snapshot
    : await getLeadById(dbClient, leadId);
  if (!lead) {
    throw Object.assign(new Error(`Lead ${leadId} not found in PostgreSQL`), {
      permanent: true,
    });
  }

  const result = await syncLeadToCrm(config, lead);
  await markCrmSynced(dbClient, leadId, {
    personId: result.personId,
    opportunityId: result.opportunityId,
  });
  return {
    personId: result.personId,
    opportunityId: result.opportunityId,
  };
}

async function refreshLeadCard(config, dbClient, mapping, {
  statusHistory,
  clientStage,
  personId,
  pendingChannel,
}) {
  const snapshot = mapping.lead_snapshot || {
    id: mapping.lead_id,
    name: `Заявка #${mapping.lead_id}`,
    contact: "",
    interests: [],
    created_at: new Date().toISOString(),
  };
  const deepLink = personDeepLink(config, personId || mapping.person_id);
  const text = formatLeadMessage(snapshot, {
    deepLink,
    statusHistory: statusHistory ?? mapping.status_history,
  });
  const stage = clientStage ?? mapping.client_stage;
  const channel = pendingChannel !== undefined
    ? pendingChannel
    : mapping.pending_channel;
  const replyMarkup = keyboardForStage(mapping.lead_id, stage, {
    contact: snapshot.contact,
    pendingChannel: channel || null,
    statusHistory: statusHistory ?? mapping.status_history,
  });
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
  actionLabel,
  channel,
  nextActionAt = null,
  clearPendingChannel = false,
  setPendingChannel,
}) {
  const synced = await ensureLeadInCrm(config, dbClient, mapping.lead_id, mapping);
  const payload = {
    landingLeadId: String(mapping.lead_id),
    personId: synced.personId || mapping.person_id || null,
    opportunityId: synced.opportunityId || mapping.opportunity_id || null,
    action,
    note: note || null,
    lostReason: lostReason || null,
    actorLabel: actorLabel || null,
    clientEventId,
    nextActionAt: nextActionAt || null,
    channel: toCrmChannel(channel) || null,
  };

  const result = await postLeadAction(config, payload);
  const clientStage = stageAfterAction(
    action,
    mapping.client_stage,
    result.clientStage,
  );

  const statusEntry = {
    at: new Date().toISOString(),
    action,
    actionLabel: actionLabel || ACTION_LABELS[action] || action,
    actorLabel: actorLabel || null,
    clientStage,
    lostReason: lostReason || null,
    channel: channel || null,
    channelLabel: channelLabel(channel) || null,
  };
  const previousHistory = Array.isArray(mapping.status_history)
    ? mapping.status_history
    : [];
  const statusHistory = [...previousHistory, statusEntry];

  const nextPending = clearPendingChannel
    ? null
    : setPendingChannel !== undefined
      ? setPendingChannel
      : mapping.pending_channel;

  await updateTelegramLeadMessageState(dbClient, {
    chatId: mapping.chat_id,
    messageId: mapping.message_id,
    personId: result.personId,
    opportunityId: result.opportunityId,
    clientStage,
    pendingChannel: setPendingChannel,
    clearPendingChannel,
    statusEntry,
  });

  await refreshLeadCard(config, dbClient, {
    ...mapping,
    person_id: result.personId,
    opportunity_id: result.opportunityId,
    client_stage: clientStage,
    pending_channel: nextPending,
    status_history: statusHistory,
  }, {
    statusHistory,
    clientStage,
    personId: result.personId,
    pendingChannel: nextPending,
  });

  return {
    result,
    clientStage,
    statusHistory,
    statusLine: formatStatusLine(statusEntry),
  };
}

/**
 * Channel picked: local UI → outcomes; CRM note «Попытка» (non-blocking on CRM error).
 */
async function applyChannelPick(config, dbClient, mapping, { channel, actorLabel }) {
  const statusEntry = {
    at: new Date().toISOString(),
    action: "channel_pick",
    actionLabel: statusLabelForChannelPick(channel),
    actorLabel: actorLabel || null,
    clientStage: mapping.client_stage || "WAITLIST",
    lostReason: null,
    channel,
    channelLabel: channelLabel(channel),
  };
  const previousHistory = Array.isArray(mapping.status_history)
    ? mapping.status_history
    : [];
  const statusHistory = [...previousHistory, statusEntry];
  const clientStage = mapping.client_stage || "WAITLIST";

  await updateTelegramLeadMessageState(dbClient, {
    chatId: mapping.chat_id,
    messageId: mapping.message_id,
    personId: mapping.person_id,
    opportunityId: mapping.opportunity_id,
    clientStage,
    pendingChannel: channel,
    statusEntry,
  });

  const nextMapping = {
    ...mapping,
    pending_channel: channel,
    status_history: statusHistory,
    client_stage: clientStage,
  };

  await refreshLeadCard(config, dbClient, nextMapping, {
    statusHistory,
    clientStage,
    personId: mapping.person_id,
    pendingChannel: channel,
  });

  if (config.crmSyncEnabled) {
    try {
      const synced = await ensureLeadInCrm(config, dbClient, mapping.lead_id, nextMapping);
      await postLeadAction(config, {
        landingLeadId: String(mapping.lead_id),
        personId: synced.personId || mapping.person_id || null,
        opportunityId: synced.opportunityId || mapping.opportunity_id || null,
        action: "note",
        note: noteForChannelAttempt(channel),
        actorLabel: actorLabel || null,
        clientEventId: `tg:ch:${mapping.chat_id}:${mapping.message_id}:${channel}:${Date.now()}`,
        channel: toCrmChannel(channel),
      });
    } catch (error) {
      console.error(JSON.stringify({
        level: "warn",
        message: "Channel attempt note failed",
        leadId: mapping.lead_id,
        channel,
        error: String(error.message || error),
      }));
    }
  }

  return { statusHistory, channel };
}

async function setPendingAndRefresh(config, dbClient, mapping, pendingChannel) {
  await updateTelegramLeadMessageState(dbClient, {
    chatId: mapping.chat_id,
    messageId: mapping.message_id,
    personId: mapping.person_id,
    opportunityId: mapping.opportunity_id,
    clientStage: mapping.client_stage,
    pendingChannel: pendingChannel === null ? undefined : pendingChannel,
    clearPendingChannel: pendingChannel === null,
  });
  await refreshLeadCard(config, dbClient, {
    ...mapping,
    pending_channel: pendingChannel,
  }, {
    statusHistory: mapping.status_history,
    clientStage: mapping.client_stage,
    personId: mapping.person_id,
    pendingChannel,
  });
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
      pending_channel: null,
      lead_snapshot: null,
      status_history: [],
    };
  }

  if (data.kind === "lost_menu" || data.kind === "back") {
    const deepLink = personDeepLink(config, mapping.person_id);
    const snapshot = mapping.lead_snapshot || {
      id: mapping.lead_id,
      name: `Заявка #${mapping.lead_id}`,
      contact: "",
      interests: [],
      created_at: new Date().toISOString(),
    };
    const text = formatLeadMessage(snapshot, {
      deepLink,
      statusHistory: mapping.status_history,
    });
    const opts = keyboardOpts(mapping);
    const replyMarkup = data.kind === "lost_menu"
      ? keyboardLostReasons(mapping.lead_id, opts)
      : keyboardForStage(mapping.lead_id, mapping.client_stage, opts);
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

  if (data.kind === "channel") {
    if (!CONTACT_CHANNELS[data.channel]) {
      await answerCallbackQuery(config, callbackQuery.id, "Неизвестный канал");
      return { handled: true, reason: "bad_channel" };
    }
    await applyChannelPick(config, dbClient, mapping, {
      channel: data.channel,
      actorLabel: manager.label,
    });
    await answerCallbackQuery(
      config,
      callbackQuery.id,
      statusLabelForChannelPick(data.channel),
    );
    return { handled: true, reason: "channel_ok", channel: data.channel };
  }

  if (data.kind === "channel_menu" || data.kind === "write_again") {
    const nextPending = isContactedStage(mapping.client_stage)
      ? PICK_CHANNEL_SENTINEL
      : null;
    await setPendingAndRefresh(config, dbClient, mapping, nextPending);
    await answerCallbackQuery(config, callbackQuery.id, "Выберите канал");
    return { handled: true, reason: data.kind };
  }

  if (data.kind === "outcome") {
    if (!config.crmSyncEnabled) {
      await answerCallbackQuery(config, callbackQuery.id, "CRM sync выключен");
      return { handled: true, reason: "crm_disabled" };
    }
    const channel = mapping.pending_channel;
    if (!channel || !CONTACT_CHANNELS[channel]) {
      await answerCallbackQuery(config, callbackQuery.id, "Сначала выберите канал");
      return { handled: true, reason: "no_channel" };
    }

    const outcome = data.outcome;
    const clientEventId = `tg:cb:${callbackQuery.id}`;
    const note = noteForOutcome(outcome, channel);
    const label = statusLabelForOutcome(outcome, channel);

    try {
      if (outcome === "no_answer") {
        await applyLeadAction(config, dbClient, mapping, {
          action: "no_answer",
          note,
          lostReason: null,
          actorLabel: manager.label,
          clientEventId,
          actionLabel: label,
          channel,
          clearPendingChannel: true,
        });
      } else if (outcome === "thinking") {
        await applyLeadAction(config, dbClient, mapping, {
          action: "contacted",
          note,
          lostReason: null,
          actorLabel: manager.label,
          clientEventId,
          actionLabel: label,
          channel,
          nextActionAt: hoursFromNowIso(48),
          clearPendingChannel: true,
        });
      } else {
        await applyLeadAction(config, dbClient, mapping, {
          action: "contacted",
          note,
          lostReason: null,
          actorLabel: manager.label,
          clientEventId,
          actionLabel: label,
          channel,
          clearPendingChannel: true,
        });
      }
      await answerCallbackQuery(config, callbackQuery.id, label);
      return { handled: true, reason: "outcome_ok", outcome };
    } catch (error) {
      await answerCallbackQuery(
        config,
        callbackQuery.id,
        `Ошибка: ${String(error.message).slice(0, 150)}`,
      );
      throw error;
    }
  }

  if (!config.crmSyncEnabled) {
    await answerCallbackQuery(config, callbackQuery.id, "CRM sync выключен");
    return { handled: true, reason: "crm_disabled" };
  }

  if (data.kind !== "action" || !data.action) {
    await answerCallbackQuery(config, callbackQuery.id, "Некорректная кнопка");
    return { handled: true, reason: "bad_callback" };
  }

  try {
    const clientEventId = `tg:cb:${callbackQuery.id}`;
    let action = data.action;
    let note = null;
    let actionLabel = ACTION_LABELS[action] || action;

    if (action === "intro_agreed") {
      action = "intro_offered";
      note = "Согласилась на intro.";
      actionLabel = ACTION_LABELS.intro_agreed;
    } else if (action === "intro_offered") {
      note = "Предложила intro.";
      actionLabel = ACTION_LABELS.intro_offered;
    }

    await applyLeadAction(config, dbClient, mapping, {
      action,
      note,
      lostReason: data.lostReason,
      actorLabel: manager.label,
      clientEventId,
      actionLabel,
      clearPendingChannel: true,
    });
    await answerCallbackQuery(config, callbackQuery.id, actionLabel);
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
  const thinking = /думает|ушла думать|пока подума/.test(text.toLowerCase());
  await applyLeadAction(config, dbClient, mapping, {
    action: intent.action,
    note: intent.note,
    lostReason: intent.lostReason || null,
    actorLabel: manager.label,
    clientEventId,
    nextActionAt: thinking && intent.action === "contacted" ? hoursFromNowIso(48) : null,
    clearPendingChannel: true,
  });

  return { handled: true, reason: "reply_ok", action: intent.action };
}

/**
 * Resend lead card as a new message (CRM stage/history, local fallback).
 */
export async function handleResendCommand(config, dbClient, message) {
  const text = String(message.text || message.caption || "").trim();
  const parsed = parseResendCommand(text);
  if (!parsed) return { handled: false };

  const chatId = message.chat?.id;
  if (String(chatId) !== String(config.telegramChatId)) {
    return { handled: true, reason: "wrong_chat" };
  }

  const manager = resolveManager(config, message.from);
  if (!manager.allowed) {
    return { handled: true, reason: "forbidden" };
  }

  const lead = await getLeadById(dbClient, parsed.leadId);
  if (!lead) {
    await sendTelegramMessage(
      config,
      `Заявка #${parsed.leadId} не найдена в базе.`,
    );
    return { handled: true, reason: "lead_not_found", leadId: parsed.leadId };
  }

  const localCard = await findLatestTelegramLeadByLeadId(dbClient, lead.id);
  const crmIds = await getCrmIdsForLead(dbClient, lead.id);

  let personId = crmIds?.person_id || localCard?.person_id || null;
  let opportunityId = crmIds?.opportunity_id || localCard?.opportunity_id || null;
  let clientStage = localCard?.client_stage || "WAITLIST";
  let statusHistory = Array.isArray(localCard?.status_history)
    ? localCard.status_history
    : [];
  let deepLinkPath = null;
  let source = config.crmSyncEnabled ? "local_fallback" : "local";

  if (config.crmSyncEnabled) {
    try {
      const status = await fetchLeadStatus(config, {
        landingLeadId: String(lead.id),
      });
      personId = status.personId || personId;
      opportunityId = status.opportunityId || opportunityId;
      clientStage = status.clientStage || clientStage;
      statusHistory = mapCrmNotesToStatusHistory(status.notes);
      deepLinkPath = status.deepLinkPath || null;
      source = "crm";
    } catch (error) {
      console.error(JSON.stringify({
        level: "warn",
        message: "Lead status fetch failed; falling back to local card state",
        leadId: lead.id,
        error: String(error.message || error),
      }));
    }
  }

  const deepLink = resolveLeadDeepLink(config, { deepLinkPath, personId });
  const replyMarkup = keyboardForStage(lead.id, clientStage, {
    contact: lead.contact,
    pendingChannel: null,
    statusHistory,
  });
  const cardText = formatLeadMessage(lead, { deepLink, statusHistory });
  const sent = await sendTelegramMessage(config, cardText, { replyMarkup });
  await saveTelegramLeadMessage(dbClient, {
    chatId: sent.chat.id,
    messageId: sent.message_id,
    leadId: lead.id,
    personId,
    opportunityId,
    clientStage,
    leadSnapshot: lead,
    statusHistory,
    pendingChannel: null,
  });

  return {
    handled: true,
    reason: "resend_ok",
    leadId: lead.id,
    source,
    messageId: sent.message_id,
  };
}

export async function processTelegramUpdate(config, dbClient, update) {
  if (update.callback_query) {
    return handleCallbackQuery(config, dbClient, update.callback_query);
  }
  if (update.message) {
    const resend = await handleResendCommand(config, dbClient, update.message);
    if (resend.handled) return resend;
    return handleReplyMessage(config, dbClient, update.message);
  }
  return { handled: false };
}
