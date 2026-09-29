import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchLeadStatus,
  mapCrmNotesToStatusHistory,
  resolveLeadDeepLink,
} from "../src/crm-actions.js";
import { CrmPermanentError, CrmTransientError } from "../src/crm.js";
import { parseResendCommand } from "../src/resend.js";

test("parseResendCommand accepts ID /resend /card forms", () => {
  assert.deepEqual(parseResendCommand("ID36"), { leadId: 36 });
  assert.deepEqual(parseResendCommand("id 36"), { leadId: 36 });
  assert.deepEqual(parseResendCommand("Id#36"), { leadId: 36 });
  assert.deepEqual(parseResendCommand("ID #36"), { leadId: 36 });
  assert.deepEqual(parseResendCommand("/resend 36"), { leadId: 36 });
  assert.deepEqual(parseResendCommand("/card 36"), { leadId: 36 });
  assert.deepEqual(parseResendCommand("/resend@KatfitBot 36"), { leadId: 36 });
  assert.deepEqual(parseResendCommand("  /CARD 99  "), { leadId: 99 });
});

test("parseResendCommand rejects non-commands", () => {
  assert.equal(parseResendCommand(""), null);
  assert.equal(parseResendCommand("привет"), null);
  assert.equal(parseResendCommand("ID"), null);
  assert.equal(parseResendCommand("ID abc"), null);
  assert.equal(parseResendCommand("/resend"), null);
  assert.equal(parseResendCommand("/resend foo"), null);
  assert.equal(parseResendCommand("resend 36"), null);
  assert.equal(parseResendCommand("заявка 36"), null);
});

test("mapCrmNotesToStatusHistory sorts ascending and extracts fields", () => {
  const history = mapCrmNotesToStatusHistory([
    {
      id: "2",
      at: "2026-09-29T14:00:00.000Z",
      title: "TG-EVENT:thinking",
      body: "Канал: Telegram. Написала в Telegram — думает.\n\n— Анна",
    },
    {
      id: "1",
      at: "2026-09-29T12:00:00.000Z",
      title: "TG-EVENT:channel",
      body: "Канал: Telegram. Попытка связаться.\n\n— Борис",
    },
  ]);

  assert.equal(history.length, 2);
  assert.equal(history[0].at, "2026-09-29T12:00:00.000Z");
  assert.equal(history[0].actionLabel, "Попытка связаться.");
  assert.equal(history[0].actorLabel, "Борис");
  assert.equal(history[0].channelLabel, "Telegram");
  assert.equal(history[0].clientStage, null);
  assert.equal(history[1].actionLabel, "Написала в Telegram — думает.");
  assert.equal(history[1].actorLabel, "Анна");
  assert.equal(history[1].channelLabel, "Telegram");
});

test("mapCrmNotesToStatusHistory falls back to title", () => {
  const history = mapCrmNotesToStatusHistory([
    { id: "1", at: "2026-09-29T12:00:00.000Z", title: "TG-EVENT:manual", body: "" },
  ]);
  assert.equal(history[0].actionLabel, "manual");
});

test("resolveLeadDeepLink prefers path then personId", () => {
  const config = { twentyAppBaseUrl: "https://crm.example.com/" };
  assert.equal(
    resolveLeadDeepLink(config, { deepLinkPath: "/objects/people/abc" }),
    "https://crm.example.com/objects/people/abc",
  );
  assert.equal(
    resolveLeadDeepLink(config, {
      deepLinkPath: "https://crm.example.com/objects/people/x",
    }),
    "https://crm.example.com/objects/people/x",
  );
  assert.equal(
    resolveLeadDeepLink(config, { personId: "p1" }),
    "https://crm.example.com/objects/people/p1",
  );
  assert.equal(resolveLeadDeepLink({ twentyAppBaseUrl: null }, { personId: "p1" }), null);
});

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
  };
}

test("fetchLeadStatus POSTs to /s/studio/lead-status", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    return jsonResponse({
      personId: "p1",
      opportunityId: "o1",
      clientStage: "CONTACTED",
      notes: [],
    });
  };

  const result = await fetchLeadStatus(
    {
      crmSyncEnabled: true,
      twentyApiUrl: "https://crm.example.com",
      twentyApiKey: "token",
    },
    { landingLeadId: "36" },
    { fetchImpl },
  );

  assert.equal(result.personId, "p1");
  assert.equal(result.clientStage, "CONTACTED");
  assert.match(calls[0].url, /\/s\/studio\/lead-status$/);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { landingLeadId: "36" });
});

test("fetchLeadStatus rejects when CRM disabled", async () => {
  await assert.rejects(
    () =>
      fetchLeadStatus(
        { crmSyncEnabled: false, twentyApiUrl: "https://crm.example.com", twentyApiKey: "t" },
        { landingLeadId: "1" },
      ),
    (error) => error instanceof CrmPermanentError,
  );
});

test("fetchLeadStatus treats 5xx as transient", async () => {
  await assert.rejects(
    () =>
      fetchLeadStatus(
        {
          crmSyncEnabled: true,
          twentyApiUrl: "https://crm.example.com/graphql",
          twentyApiKey: "token",
        },
        { landingLeadId: "1" },
        { fetchImpl: async () => jsonResponse({ error: "upstream" }, 503) },
      ),
    (error) => error instanceof CrmTransientError,
  );
});
