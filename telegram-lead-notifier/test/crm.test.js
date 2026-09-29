import assert from "node:assert/strict";
import test from "node:test";
import {
  formatInterestsNote,
  mapInterestedFormats,
  mapLeadSource,
  opportunityName,
  parseContact,
  splitPersonName,
  toIsoDate,
} from "../src/crm-mapping.js";
import {
  buildStudioLeadPayload,
  CrmPermanentError,
  CrmTransientError,
  syncLeadToCrm,
} from "../src/crm.js";

test("parseContact normalizes Russian phone to E.164", () => {
  assert.deepEqual(parseContact("+7 (900) 123-45-67"), {
    phone: "+79001234567",
    email: null,
    e164: "+79001234567",
    nationalNumber: "9001234567",
  });
  assert.equal(parseContact("8 900 123-45-67").phone, "+79001234567");
  assert.equal(parseContact("9001234567").phone, "+79001234567");
});

test("parseContact detects email", () => {
  assert.deepEqual(parseContact("Anna@Example.com"), {
    phone: null,
    email: "anna@example.com",
    e164: null,
    nationalNumber: null,
  });
});

test("parseContact rejects garbage", () => {
  assert.equal(parseContact("not-a-contact").phone, null);
  assert.equal(parseContact("").email, null);
});

test("splitPersonName handles single and multi-word names", () => {
  assert.deepEqual(splitPersonName("Анна"), { firstName: "Анна", lastName: "" });
  assert.deepEqual(splitPersonName("Анна Иванова"), {
    firstName: "Анна",
    lastName: "Иванова",
  });
  assert.deepEqual(splitPersonName("  "), { firstName: "Без имени", lastName: "" });
});

test("mapLeadSource maps yandex utm combinations", () => {
  assert.equal(
    mapLeadSource({ utmSource: "yandex", utmMedium: "cpc" }),
    "YANDEX_SEARCH",
  );
  assert.equal(
    mapLeadSource({ utmSource: "yandex", utmMedium: "network", utmCampaign: "rsya" }),
    "YANDEX_NETWORK",
  );
  assert.equal(mapLeadSource({ utmSource: "telegram" }), "SOCIAL");
  assert.equal(mapLeadSource({}), "UNKNOWN");
  assert.equal(mapLeadSource({ utmSource: "weird_partner" }), "OTHER");
});

test("formatInterestsNote, mapInterestedFormats and opportunityName", () => {
  assert.equal(formatInterestsNote(["reformer", "stretching"]), "реформер, стретчинг");
  assert.equal(formatInterestsNote([]), null);
  assert.deepEqual(mapInterestedFormats(["reformer", "stretching", "undecided"]), [
    "INTRO_REFORMER",
    "STRETCHING",
  ]);
  assert.equal(opportunityName("Анна"), "Анна — первое занятие");
});

test("toIsoDate accepts Date and ISO string", () => {
  assert.equal(toIsoDate("2026-09-20T09:00:00.000Z"), "2026-09-20T09:00:00.000Z");
  assert.match(toIsoDate(new Date("2026-01-01T00:00:00.000Z")), /^2026-01-01/);
});

test("buildStudioLeadPayload maps landing row to WF-01", () => {
  const payload = buildStudioLeadPayload({
    id: 42,
    name: "Анна",
    contact: "+7 900 123-45-67",
    interests: ["reformer"],
    created_at: "2026-09-20T09:00:00.000Z",
    utm_source: "yandex",
    utm_medium: "cpc",
    utm_campaign: "test",
    personal_data_consent: true,
    marketing_consent: false,
    privacy_policy_version: "draft-1",
  });

  assert.equal(payload.externalId, "42");
  assert.equal(payload.phone, "+79001234567");
  assert.deepEqual(payload.interestedFormats, ["INTRO_REFORMER"]);
  assert.equal(payload.utm.campaign, "test");
});

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
  };
}

test("syncLeadToCrm POSTs to WF-01 and returns ids", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    assert.match(url, /\/s\/studio\/leads$/);
    assert.equal(init.method, "POST");
    assert.match(init.headers.authorization, /^Bearer /);
    return jsonResponse({
      personId: "person-1",
      opportunityId: "opp-1",
      taskId: "task-1",
      duplicate: false,
    });
  };

  const result = await syncLeadToCrm(
    {
      twentyApiUrl: "https://crm.example.com",
      twentyApiKey: "token",
    },
    {
      id: 42,
      name: "Анна",
      contact: "+7 900 123-45-67",
      interests: ["reformer"],
      created_at: "2026-09-20T09:00:00.000Z",
      utm_source: "yandex",
      utm_medium: "cpc",
      utm_campaign: "test",
      personal_data_consent: true,
      marketing_consent: false,
    },
    { fetchImpl },
  );

  assert.equal(result.personId, "person-1");
  assert.equal(result.opportunityId, "opp-1");
  assert.equal(result.taskId, "task-1");
  assert.equal(result.duplicate, false);
  assert.equal(result.opportunityCreated, true);
  assert.equal(result.leadSource, "YANDEX_SEARCH");
  assert.equal(calls[0].body.externalId, "42");
  assert.deepEqual(calls[0].body.interestedFormats, ["INTRO_REFORMER"]);
});

test("syncLeadToCrm marks duplicate when WF-01 says so", async () => {
  const result = await syncLeadToCrm(
    { twentyApiUrl: "https://crm.example.com", twentyApiKey: "token" },
    {
      id: 99,
      name: "Анна Иванова",
      contact: "89001234567",
      interests: [],
      created_at: "2026-09-28T12:00:00.000Z",
      utm_source: "yandex",
      personal_data_consent: true,
      marketing_consent: true,
    },
    {
      fetchImpl: async () =>
        jsonResponse({
          personId: "person-existing",
          opportunityId: "opp-open",
          taskId: "task-2",
          duplicate: true,
        }),
    },
  );

  assert.equal(result.personId, "person-existing");
  assert.equal(result.opportunityId, "opp-open");
  assert.equal(result.duplicate, true);
  assert.equal(result.opportunityCreated, false);
});

test("syncLeadToCrm rejects contact without phone or email", async () => {
  await assert.rejects(
    () =>
      syncLeadToCrm(
        { twentyApiUrl: "https://crm.example.com", twentyApiKey: "token" },
        { id: 1, name: "X", contact: "???", personal_data_consent: true },
        { fetchImpl: async () => jsonResponse({}) },
      ),
    (error) => error instanceof CrmPermanentError,
  );
});

test("syncLeadToCrm treats 202 reviewRequired as permanent", async () => {
  await assert.rejects(
    () =>
      syncLeadToCrm(
        { twentyApiUrl: "https://crm.example.com", twentyApiKey: "token" },
        {
          id: 7,
          name: "Conflict",
          contact: "+79001112233",
          personal_data_consent: true,
        },
        {
          fetchImpl: async () =>
            jsonResponse(
              {
                reviewRequired: true,
                message: "Person conflict: phone matches p1 but email matches p2",
              },
              202,
            ),
        },
      ),
    (error) =>
      error instanceof CrmPermanentError && /Person conflict/.test(error.message),
  );
});

test("syncLeadToCrm treats 5xx as transient", async () => {
  await assert.rejects(
    () =>
      syncLeadToCrm(
        { twentyApiUrl: "https://crm.example.com", twentyApiKey: "token" },
        {
          id: 8,
          name: "Retry",
          contact: "+79001112233",
          personal_data_consent: true,
        },
        {
          fetchImpl: async () =>
            jsonResponse({ error: "upstream" }, 503),
        },
      ),
    (error) => error instanceof CrmTransientError,
  );
});
