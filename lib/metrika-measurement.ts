import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { METRIKA_ID } from "./metrika";

export function measurementConfig() {
  const token = process.env.METRIKA_MEASUREMENT_TOKEN;
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  return {
    enabled: process.env.METRIKA_MEASUREMENT_ENABLED === "true" && Boolean(token && site),
    beforeConsent: process.env.METRIKA_MEASUREMENT_BEFORE_CONSENT === "true",
    token: token ?? "",
    origin: site ? new URL(site).origin : "",
  };
}

const TICKET_LIFETIME = 10 * 60_000;

export function issueTicket(secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    id: randomUUID(),
    cid: BigInt(`0x${randomBytes(8).toString("hex")}`).toString(),
    issued: now,
  })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function verifyTicket(ticket: string, secret: string, now = Date.now()): {
  id: string; cid: string; issued: number;
} | null {
  if (ticket.length > 600) return null;
  const [payload, signature, extra] = ticket.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof value.id !== "string" || !/^[\da-f-]{36}$/.test(value.id)
      || typeof value.cid !== "string" || !/^\d{1,20}$/.test(value.cid)
      || !Number.isSafeInteger(value.issued) || value.issued > now
      || now - value.issued > TICKET_LIFETIME) return null;
    return value;
  } catch {
    return null;
  }
}

// Only advertising identifiers and standard campaign fields may leave the site.
export function measurementLanding(raw: string, origin: string) {
  const input = new URL(raw);
  if (input.origin !== origin || input.pathname !== "/") throw new Error("Invalid landing");
  const output = new URL("/", origin);
  for (const field of ["yclid", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const value = input.searchParams.get(field);
    if (!value) continue;
    if (field === "yclid" ? !/^\d{1,30}$/.test(value) : value.length > 200) {
      throw new Error("Invalid campaign parameter");
    }
    output.searchParams.set(field, value);
  }
  return output.href;
}

export function measurementHits(input: {
  cid: string; landing: string; existingVisit: boolean; now?: number;
}) {
  const shared = { cid: input.cid, et: String(Math.floor((input.now ?? Date.now()) / 1000)), dl: input.landing };
  const hits: string[] = [];
  if (!input.existingVisit) {
    hits.push(new URLSearchParams({ ...shared, t: "pageview" }).toString());
  }
  hits.push(new URLSearchParams({ ...shared, t: "event", ea: "tariffs_view" }).toString());
  return hits.join("\n");
}

export async function sendMeasurement(token: string, hits: string) {
  // Keep the secret in the POST body, out of URL access logs. Send the opening
  // pageview first, and do not send the goal unless that request was accepted.
  for (const hit of hits.split("\n")) {
    const body = new URLSearchParams(hit);
    body.set("tid", String(METRIKA_ID));
    body.set("ms", token);
    const response = await fetch("https://mc.yandex.ru/collect", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
      redirect: "error",
    });
    if (response.status !== 200 || (await response.text()).trim() !== "<!-- OK -->") return false;
  }
  return true;
}
