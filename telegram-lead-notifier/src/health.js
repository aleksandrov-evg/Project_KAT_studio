import http from "node:http";

export function startHttpServer(port, state, { onTelegramUpdate } = {}) {
  return http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        const healthy = state.ready && Date.now() - state.lastPollAt < 120000;
        response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
        response.end(JSON.stringify({
          status: healthy ? "ok" : "unavailable",
          ready: state.ready,
          lastPollAt: state.lastPollAt ? new Date(state.lastPollAt).toISOString() : null,
          lastSentLeadId: state.lastSentLeadId,
          crmSyncEnabled: Boolean(state.crmSyncEnabled),
          lastCrmSyncAt: state.lastCrmSyncAt
            ? new Date(state.lastCrmSyncAt).toISOString()
            : null,
          lastCrmLeadId: state.lastCrmLeadId ?? null,
          lastCrmError: state.lastCrmError ?? null,
          crmPendingCount: state.crmPendingCount ?? null,
          telegramMode: state.telegramMode ?? null,
          lastTelegramUpdateAt: state.lastTelegramUpdateAt
            ? new Date(state.lastTelegramUpdateAt).toISOString()
            : null,
        }));
        return;
      }

      if (
        request.method === "POST"
        && (request.url === "/telegram/webhook" || request.url?.startsWith("/telegram/webhook?"))
      ) {
        if (typeof onTelegramUpdate !== "function") {
          response.writeHead(503).end("webhook not configured");
          return;
        }

        const secret = request.headers["x-telegram-bot-api-secret-token"];
        if (state.telegramWebhookSecret && secret !== state.telegramWebhookSecret) {
          response.writeHead(401).end("unauthorized");
          return;
        }

        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const raw = Buffer.concat(chunks).toString("utf8");
        const update = JSON.parse(raw || "{}");
        await onTelegramUpdate(update);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      response.writeHead(404).end("not found");
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        message: error.message,
        channel: "http",
      }));
      response.writeHead(500).end("error");
    }
  }).listen(port, "0.0.0.0");
}

/** @deprecated use startHttpServer */
export function startHealthServer(port, state) {
  return startHttpServer(port, state);
}
