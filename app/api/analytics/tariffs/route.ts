import { issueTicket, measurementConfig, measurementHits, measurementLanding, sendMeasurement, verifyTicket } from "../../../../lib/metrika-measurement";
import { claimMeasurement, finishMeasurement } from "../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
// A bounded per-process safety cap, not a replacement for ingress rate limiting.
let windowStart = 0;
let requests = 0;
function limited() {
  if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); requests = 0; }
  return ++requests > 120;
}

export async function GET(request: Request) {
  const config = measurementConfig();
  if (!config.enabled) return Response.json({ enabled: false }, { headers });
  if (request.headers.get("x-analytics-request") !== "1"
    || request.headers.get("sec-fetch-site") !== "same-origin") {
    return new Response(null, { status: 403, headers });
  }
  if (limited()) return new Response(null, { status: 429, headers });
  const accepted = new URL(request.url).searchParams.get("consent") === "accepted";
  if (!accepted && !config.beforeConsent) {
    return Response.json({ enabled: true, allowed: false }, { headers });
  }
  return Response.json({ enabled: true, allowed: true, ticket: issueTicket(config.token) }, { headers });
}

export async function POST(request: Request) {
  const config = measurementConfig();
  if (!config.enabled) return new Response(null, { status: 503, headers });
  if (request.headers.get("origin") !== config.origin
    || request.headers.get("sec-fetch-site") !== "same-origin") {
    return new Response(null, { status: 403, headers });
  }
  if (limited()) return new Response(null, { status: 429, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return new Response(null, { status: 415, headers });
  }
  // Bound the actual streamed body, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400, headers });
  let raw = "";
  let size = 0;
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); return new Response(null, { status: 413, headers }); }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  let data;
  try { data = JSON.parse(raw); } catch { return new Response(null, { status: 400, headers }); }
  if (!data || typeof data !== "object" || typeof data.ticket !== "string" || typeof data.landing !== "string") {
    return new Response(null, { status: 400, headers });
  }
  if (data.consent !== "accepted" && !config.beforeConsent) {
    return new Response(null, { status: 403, headers });
  }
  const ticket = verifyTicket(data.ticket, config.token);
  if (!ticket) return new Response(null, { status: 400, headers });
  let landing: string;
  try { landing = measurementLanding(data.landing, config.origin); }
  catch { return new Response(null, { status: 400, headers }); }
  const existingVisit = data.consent === "accepted" && typeof data.cid === "string" && /^\d{1,20}$/.test(data.cid);
  const cid = existingVisit ? data.cid as string : ticket.cid;
  try {
    if (!await claimMeasurement(ticket.id)) return new Response(null, { status: 204, headers });
    let sent = false;
    try {
      sent = await sendMeasurement(config.token, measurementHits({ cid, landing, existingVisit }));
    } catch { /* Do not log URLs, IDs, secrets, or upstream responses. */ }
    await finishMeasurement(ticket.id, sent);
    if (!sent) console.error("Metrika Measurement Protocol: delivery unconfirmed");
    return new Response(null, { status: sent ? 204 : 502, headers });
  } catch {
    console.error("Metrika Measurement Protocol: storage unavailable");
    return new Response(null, { status: 503, headers });
  }
}
