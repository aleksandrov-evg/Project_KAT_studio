import { CrmPermanentError, syncLeadToCrm } from "./crm.js";
import { personDeepLink } from "./crm-actions.js";
import { readConfig } from "./config.js";
import {
  connectDatabase,
  countPendingCrmLeads,
  getCrmIdsForLead,
  getPendingCrmLeads,
  getPendingLeads,
  getTelegramUpdateOffset,
  markCrmPermanentError,
  markCrmSynced,
  markLeadSent,
  saveTelegramLeadMessage,
  setTelegramUpdateOffset,
} from "./database.js";
import { startHttpServer } from "./health.js";
import { processTelegramUpdate } from "./inbound.js";
import { keyboardForStage } from "./keyboards.js";
import { formatLeadMessage } from "./message.js";
import {
  deleteTelegramWebhook,
  getTelegramUpdates,
  sendTelegramMessage,
  setTelegramWebhook,
} from "./telegram.js";

const config = readConfig();
const state = {
  ready: false,
  lastPollAt: 0,
  lastSentLeadId: null,
  lastCrmSyncAt: null,
  lastCrmLeadId: null,
  lastCrmError: null,
  crmPendingCount: null,
  crmSyncEnabled: config.crmSyncEnabled,
  telegramMode: config.telegramMode,
  telegramWebhookSecret: config.telegramWebhookSecret,
  lastTelegramUpdateAt: null,
};
let stopping = false;
let client;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function onTelegramUpdate(update) {
  state.lastTelegramUpdateAt = Date.now();
  try {
    const result = await processTelegramUpdate(config, client, update);
    if (result?.handled) {
      console.log(JSON.stringify({
        level: "info",
        message: "Telegram update handled",
        reason: result.reason,
        action: result.action ?? null,
        updateId: update.update_id ?? null,
      }));
    }
  } catch (error) {
    const permanent = error instanceof CrmPermanentError || error.permanent === true;
    console.error(JSON.stringify({
      level: "error",
      message: error.message,
      channel: "telegram-inbound",
      permanent,
      updateId: update.update_id ?? null,
    }));
  }
}

const healthServer = startHttpServer(config.port, state, {
  onTelegramUpdate: config.telegramMode === "webhook" ? onTelegramUpdate : undefined,
});

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  state.ready = false;
  console.log(JSON.stringify({ level: "info", message: "Shutting down", signal }));
  healthServer.close();
  await client?.end().catch(() => undefined);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function syncPendingLeadsToCrm() {
  if (!config.crmSyncEnabled) return { hadTransientError: false };

  let leads;
  try {
    leads = await getPendingCrmLeads(client, config);
    state.crmPendingCount = await countPendingCrmLeads(client);
  } catch (error) {
    throw new Error(`CRM database polling failed: ${error.message}`, { cause: error });
  }

  let hadTransientError = false;
  for (const lead of leads) {
    try {
      const result = await syncLeadToCrm(config, lead);
      await markCrmSynced(client, lead.id, {
        personId: result.personId,
        opportunityId: result.opportunityId,
      });
      state.lastCrmSyncAt = Date.now();
      state.lastCrmLeadId = lead.id;
      state.lastCrmError = null;
      console.log(JSON.stringify({
        level: "info",
        message: "Lead synced to CRM",
        leadId: lead.id,
        personId: result.personId,
        opportunityId: result.opportunityId,
        duplicate: result.duplicate,
        opportunityCreated: result.opportunityCreated,
        taskId: result.taskId,
      }));
    } catch (error) {
      const permanent = error instanceof CrmPermanentError || error.permanent === true;
      state.lastCrmError = error.message;
      console.error(JSON.stringify({
        level: "error",
        message: error.message,
        leadId: lead.id,
        permanent,
        status: error.status ?? null,
        channel: "crm",
      }));
      if (permanent) {
        try {
          await markCrmPermanentError(client, lead.id, error.message);
        } catch (markError) {
          throw new Error(`Could not save CRM permanent error: ${markError.message}`, {
            cause: markError,
          });
        }
        continue;
      }
      hadTransientError = true;
      break;
    }
  }

  try {
    state.crmPendingCount = await countPendingCrmLeads(client);
  } catch {
    // health metric is best-effort
  }

  return { hadTransientError };
}

async function notifyPendingLeadsToTelegram() {
  let leads;
  try {
    leads = await getPendingLeads(client, config);
  } catch (error) {
    throw new Error(`Database polling failed: ${error.message}`, { cause: error });
  }

  let telegramUnavailable = false;
  for (const lead of leads) {
    try {
      const crmIds = await getCrmIdsForLead(client, lead.id);
      const deepLink = personDeepLink(config, crmIds?.person_id);
      const text = formatLeadMessage(lead, { deepLink });
      const replyMarkup = keyboardForStage(lead.id, "WAITLIST");
      const sent = await sendTelegramMessage(config, text, { replyMarkup });
      await saveTelegramLeadMessage(client, {
        chatId: sent.chat.id,
        messageId: sent.message_id,
        leadId: lead.id,
        personId: crmIds?.person_id ?? null,
        opportunityId: crmIds?.opportunity_id ?? null,
        clientStage: "WAITLIST",
        leadSnapshot: lead,
      });
    } catch (error) {
      state.ready = false;
      telegramUnavailable = true;
      console.error(JSON.stringify({
        level: "error",
        message: error.message,
        leadId: lead.id,
        channel: "telegram",
      }));
      break;
    }
    try {
      await markLeadSent(client, config, lead.id);
    } catch (error) {
      throw new Error(`Could not save notification cursor: ${error.message}`, { cause: error });
    }
    state.lastSentLeadId = lead.id;
    console.log(JSON.stringify({ level: "info", message: "Lead notification sent", leadId: lead.id }));
  }

  return { telegramUnavailable, batchFull: leads.length === config.batchSize };
}

async function pollTelegramUpdatesLoop() {
  if (config.telegramMode !== "polling") return;

  while (!stopping) {
    try {
      const offset = await getTelegramUpdateOffset(client, config.notifierKey);
      const updates = await getTelegramUpdates(config, offset > 0 ? offset + 1 : 0);
      if (Array.isArray(updates) && updates.length > 0) {
        let maxId = offset;
        for (const update of updates) {
          if (update.update_id > maxId) maxId = update.update_id;
          await onTelegramUpdate(update);
        }
        await setTelegramUpdateOffset(client, config.notifierKey, maxId);
      }
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: error.message,
        channel: "telegram-polling",
      }));
      await sleep(3000);
    }
  }
}

try {
  client = await connectDatabase(config);

  if (config.telegramMode === "webhook") {
    await setTelegramWebhook(config, config.telegramWebhookUrl);
    console.log(JSON.stringify({
      level: "info",
      message: "Telegram webhook configured",
      url: config.telegramWebhookUrl,
    }));
  } else {
    await deleteTelegramWebhook(config).catch(() => undefined);
  }

  state.ready = true;
  console.log(JSON.stringify({
    level: "info",
    message: "Lead notifier started",
    crmSyncEnabled: config.crmSyncEnabled,
    telegramMode: config.telegramMode,
  }));

  void pollTelegramUpdatesLoop();

  while (!stopping) {
    const crmResult = await syncPendingLeadsToCrm();
    const telegramResult = await notifyPendingLeadsToTelegram();

    state.lastPollAt = Date.now();
    if (telegramResult.telegramUnavailable || crmResult.hadTransientError) {
      state.ready = !telegramResult.telegramUnavailable;
      await sleep(Math.max(config.pollIntervalMs, 10000));
    } else {
      state.ready = true;
      await sleep(telegramResult.batchFull ? 50 : config.pollIntervalMs);
    }
  }
} catch (error) {
  console.error(JSON.stringify({ level: "fatal", message: error.message }));
  process.exitCode = 1;
  await shutdown("startup-error");
}
