import { readConfig } from "./config.js";
import { connectDatabase, getPendingLeads, markLeadSent } from "./database.js";
import { startHealthServer } from "./health.js";
import { formatLeadMessage } from "./message.js";
import { sendTelegramMessage } from "./telegram.js";

const config = readConfig();
const state = { ready: false, lastPollAt: 0, lastSentLeadId: null };
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

try {
  client = await connectDatabase(config);
  state.ready = true;
  console.log(JSON.stringify({ level: "info", message: "Lead notifier started" }));

  while (!stopping) {
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
        console.error(JSON.stringify({ level: "error", message: error.message, leadId: lead.id }));
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

    state.lastPollAt = Date.now();
    if (telegramUnavailable) {
      await sleep(Math.max(config.pollIntervalMs, 10000));
    } else {
      state.ready = true;
      await sleep(leads.length === config.batchSize ? 50 : config.pollIntervalMs);
    }
  }
} catch (error) {
  console.error(JSON.stringify({ level: "fatal", message: error.message }));
  process.exitCode = 1;
  await shutdown("startup-error");
}
