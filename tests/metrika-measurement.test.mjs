import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, mocks = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const context = vm.createContext({ exports, require: (name) => mocks[name] ?? require(name),
    Buffer, URL, URLSearchParams, Response, Request, TextDecoder, AbortSignal, process, console, ...globals });
  vm.runInContext(source, context);
  return exports;
}
const measurement = load("../lib/metrika-measurement.ts", { "./metrika": { METRIKA_ID: 112667422 } });

test("tickets reject tampering, expired and future timestamps", () => {
  const ticket = measurement.issueTicket("test-secret", 10_000);
  assert.ok(measurement.verifyTicket(ticket, "test-secret", 10_001));
  assert.equal(measurement.verifyTicket(ticket, "other-secret", 10_001), null);
  assert.equal(measurement.verifyTicket(`${ticket}x`, "test-secret", 10_001), null);
  assert.equal(measurement.verifyTicket(ticket, "test-secret", 610_001), null);
  assert.equal(measurement.verifyTicket(ticket, "test-secret", 9_999), null);
});

test("landing URL strips unapproved data and rejects foreign origins", () => {
  assert.equal(measurement.measurementLanding("https://studio.test/?yclid=123&utm_source=direct&email=private#contact", "https://studio.test"), "https://studio.test/?yclid=123&utm_source=direct");
  assert.throws(() => measurement.measurementLanding("https://evil.test/", "https://studio.test"));
  assert.throws(() => measurement.measurementLanding("https://studio.test/privacy-policy", "https://studio.test"));
});

test("new visitors receive pageview before goal, existing visitors receive only goal", () => {
  const input = { cid: "123", landing: "https://studio.test/?yclid=42", now: 100_000 };
  const hits = measurement.measurementHits({ ...input, existingVisit: false }).split("\n").map((hit) => new URLSearchParams(hit));
  assert.equal(hits.length, 2);
  assert.equal(hits[0].get("t"), "pageview");
  assert.equal(hits[1].get("ea"), "tariffs_view");
  assert.equal(hits[1].get("et"), "100");
  assert.equal(measurement.measurementHits({ ...input, existingVisit: true }).split("\n").length, 1);
});

test("delivery uses POST body for secret and checks upstream acknowledgement", async () => {
  let calls = 0;
  const helper = load("../lib/metrika-measurement.ts", { "./metrika": { METRIKA_ID: 112667422 } }, {
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, "https://mc.yandex.ru/collect");
      assert.equal(options.method, "POST");
      for (const line of options.body.split("\n")) {
        assert.equal(new URLSearchParams(line).get("ms"), "test-secret");
      }
      assert.equal(Object.keys(options.headers).length, 1);
      return new Response(calls === 1 ? "<!-- OK -->" : "unexpected", { status: 200 });
    },
  });
  assert.equal(await helper.sendMeasurement("test-secret", "cid=1&t=event&ea=tariffs_view"), true);
  assert.equal(await helper.sendMeasurement("test-secret", "cid=1&t=event&ea=tariffs_view"), false);
});

test("route rejects forbidden submissions and suppresses repeated ticket delivery", async () => {
  let sent = 0;
  const claimed = new Set();
  const config = { enabled: true, beforeConsent: false, token: "test-secret", origin: "https://studio.test" };
  const route = load("../app/api/analytics/tariffs/route.ts", {
    "../../../../lib/metrika-measurement": {
      ...measurement, measurementConfig: () => config,
      sendMeasurement: async () => { sent++; return true; },
    },
    "../../../../lib/db": {
      claimMeasurement: async (id) => { if (claimed.has(id)) return false; claimed.add(id); return true; },
      finishMeasurement: async () => {},
    },
  });
  const data = { ticket: measurement.issueTicket(config.token), consent: "accepted", landing: "https://studio.test/?yclid=42", cid: "123" };
  const request = (body = data, origin = config.origin) => new Request(`${config.origin}/api/analytics/tariffs`, {
    method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await route.POST(request(data, "https://evil.test"))).status, 403);
  assert.equal((await route.POST(request({ ...data, consent: "rejected" }))).status, 403);
  assert.equal((await route.POST(request({ ...data, ticket: "invalid" }))).status, 400);
  assert.equal((await route.POST(request({ ...data, landing: "https://evil.test/" }))).status, 400);
  assert.equal((await route.POST(request({ ...data, landing: "x".repeat(5000) }))).status, 413);
  assert.equal((await route.POST(request())).status, 204);
  assert.equal((await route.POST(request())).status, 204);
  assert.equal(sent, 1);
  config.beforeConsent = true;
  assert.equal((await route.POST(request({ ...data, ticket: measurement.issueTicket(config.token), cid: null, consent: "rejected" }))).status, 204);
  assert.equal(sent, 2);
});

test("tariff timer requires uninterrupted foreground visibility and sends once across consent changes", async () => {
  const listeners = new Map();
  const timers = new Map();
  let timerId = 0;
  let observed;
  let cleanup;
  let goals = 0;
  let consent = "accepted";
  const document = { visibilityState: "visible", getElementById: () => ({}),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: () => {} };
  const window = { location: { href: "https://studio.test/?yclid=42" }, innerHeight: 800,
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: () => {} };
  class Observer {
    constructor(callback) { observed = callback; }
    observe() {}
    disconnect() {}
  }
  window.IntersectionObserver = Observer;
  const component = load("../app/tariff-goal.tsx", {
    react: { useRef: (value) => ({ current: value }), useEffect: (fn) => { cleanup = fn(); } },
    "next/navigation": { usePathname: () => "/" },
    "./cookie-consent": { CONSENT_CHANGED_EVENT: "consent", getCookieConsent: () => consent },
    "../lib/metrika": { getMetrikaClientId: async () => "123", reachGoal: () => { goals++; } },
  }, { window, document, IntersectionObserver: Observer,
    fetch: async () => Response.json({ enabled: false }) });
  component.TariffGoal();
  const entry = (height) => [{ isIntersecting: height > 0, intersectionRect: { height }, boundingClientRect: { height: 600 } }];
  observed(entry(320));
  assert.equal(timers.size, 1);
  // Scrolling within the qualifying region must not reset the running timer.
  const firstTimer = [...timers.keys()][0];
  observed(entry(400));
  assert.equal([...timers.keys()][0], firstTimer);
  observed(entry(100));
  assert.equal(timers.size, 0);
  observed(entry(350));
  document.visibilityState = "hidden";
  listeners.get("visibilitychange")();
  assert.equal(timers.size, 0);
  document.visibilityState = "visible";
  listeners.get("visibilitychange")();
  const fn = [...timers.values()][0];
  timers.clear();
  fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(goals, 1);
  consent = "rejected";
  listeners.get("consent")();
  consent = "accepted";
  listeners.get("consent")();
  assert.equal(timers.size, 0);
  cleanup();
});

test("delivery stops if opening pageview is rejected", async () => {
  let calls = 0;
  const helper = load("../lib/metrika-measurement.ts", { "./metrika": { METRIKA_ID: 112667422 } }, {
    fetch: async (_url, options) => {
      calls++;
      assert.equal(new URLSearchParams(options.body).get("t"), "pageview");
      return new Response("<!-- invalid -->", { status: 400 });
    },
  });
  assert.equal(await helper.sendMeasurement("test-secret", measurement.measurementHits({ cid: "1", landing: "https://studio.test/", existingVisit: false })), false);
  assert.equal(calls, 1);
});
