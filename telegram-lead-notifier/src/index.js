import { CrmPermanentError, syncLeadToCrm } from "./crm.js";
import { readConfig } from "./config.js";
import {
  connectDatabase,
  countPendingCrmLeads,
  getPendingCrmLeads,
  getPendingLeads,
  markCrmPermanentError,
  markCrmSynced,
  markLeadSent,
} from "./database.js";
import { startHealthServer } from "./health.js";
import { formatLeadMessage } from "./message.js";
import { sendTelegramMessage } from "./telegram.js";

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
};
const healthServer = startHealthServer(config.port, state);
let stopping = false;
let client;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      }));
    } catch (error) {
      const permanent = error instanceof CrmPermanentError || error.permanent === true;
      state.lastCrmError = error.message;
      console.error(JSON.stringify({
        level: "error",
        message: error.message,
        leadId: lead.id,
        permanent,
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
      await sendTelegramMessage(config, formatLeadMessage(lead));
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

try {
  client = await connectDatabase(config);
  state.ready = true;
  console.log(JSON.stringify({
    level: "info",
    message: "Lead notifier started",
    crmSyncEnabled: config.crmSyncEnabled,
  }));

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
