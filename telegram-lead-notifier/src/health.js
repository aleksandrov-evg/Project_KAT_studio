import http from "node:http";

export function startHealthServer(port, state) {
  return http.createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404).end("not found");
      return;
    }
    const healthy = state.ready && Date.now() - state.lastPollAt < 120000;
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({
      status: healthy ? "ok" : "unavailable",
      ready: state.ready,
      lastPollAt: state.lastPollAt ? new Date(state.lastPollAt).toISOString() : null,
      lastSentLeadId: state.lastSentLeadId,
    }));
  }).listen(port, "0.0.0.0");
}
