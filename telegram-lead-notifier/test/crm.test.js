import assert from "node:assert/strict";
import test from "node:test";
import {
  formatInterestsNote,
  mapLeadSource,
  opportunityName,
  parseContact,
  splitPersonName,
  toIsoDate,
} from "../src/crm-mapping.js";
import { CrmPermanentError, syncLeadToCrm } from "../src/crm.js";

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

test("formatInterestsNote and opportunityName", () => {
  assert.equal(formatInterestsNote(["reformer", "stretching"]), "реформер, стретчинг");
  assert.equal(formatInterestsNote([]), null);
  assert.equal(opportunityName("Анна"), "Анна — первое занятие");
});

test("toIsoDate accepts Date and ISO string", () => {
  assert.equal(toIsoDate("2026-09-20T09:00:00.000Z"), "2026-09-20T09:00:00.000Z");
  assert.match(toIsoDate(new Date("2026-01-01T00:00:00.000Z")), /^2026-01-01/);
});

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
  };
}

test("syncLeadToCrm creates Person and Opportunity for new phone lead", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.query);
    if (body.query.includes("FindByLandingLeadId")) {
      return jsonResponse({ data: { people: { edges: [] } } });
    }
    if (body.query.includes("FindByPhone")) {
      return jsonResponse({ data: { people: { edges: [] } } });
    }
    if (body.query.includes("CreatePerson")) {
      return jsonResponse({
        data: {
          createPerson: {
            id: "person-1",
            name: { firstName: "Анна", lastName: "" },
            landingLeadId: "42",
            firstLeadAt: "2026-09-20T09:00:00.000Z",
            leadSource: "YANDEX_SEARCH",
            lifecycleStatus: "WAITLIST",
            personalDataConsent: true,
            marketingConsent: false,
            firstUtmCampaign: "test",
          },
        },
      });
    }
    if (body.query.includes("FindOpenOpportunity")) {
      return jsonResponse({ data: { opportunities: { edges: [] } } });
    }
    if (body.query.includes("CreateOpportunity")) {
      return jsonResponse({
        data: { createOpportunity: { id: "opp-1", clientStage: "WAITLIST" } },
      });
    }
    throw new Error(`Unexpected query: ${body.query.slice(0, 80)}`);
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
  assert.equal(result.duplicate, false);
  assert.equal(result.opportunityCreated, true);
  assert.equal(result.leadSource, "YANDEX_SEARCH");
  assert.ok(calls.some((query) => query.includes("createPerson")));
  assert.ok(calls.some((query) => query.includes("createOpportunity")));
});

test("syncLeadToCrm updates existing Person and reuses open Opportunity", async () => {
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.query.includes("FindByLandingLeadId")) {
      return jsonResponse({ data: { people: { edges: [] } } });
    }
    if (body.query.includes("FindByPhone")) {
      return jsonResponse({
        data: {
          people: {
            edges: [{
              node: {
                id: "person-existing",
                name: { firstName: "Анна", lastName: "Иванова" },
                landingLeadId: null,
                firstLeadAt: "2026-09-01T00:00:00.000Z",
                leadSource: "YANDEX_SEARCH",
                lifecycleStatus: "WAITLIST",
                personalDataConsent: true,
                marketingConsent: false,
                firstUtmCampaign: "old",
              },
            }],
          },
        },
      });
    }
    if (body.query.includes("UpdatePerson")) {
      return jsonResponse({
        data: {
          updatePerson: {
            id: "person-existing",
            name: { firstName: "Анна", lastName: "Иванова" },
            landingLeadId: "99",
            firstLeadAt: "2026-09-01T00:00:00.000Z",
            leadSource: "YANDEX_SEARCH",
            lifecycleStatus: "WAITLIST",
            personalDataConsent: true,
            marketingConsent: true,
            firstUtmCampaign: "old",
          },
        },
      });
    }
    if (body.query.includes("FindOpenOpportunity")) {
      return jsonResponse({
        data: {
          opportunities: {
            edges: [{ node: { id: "opp-open", clientStage: "NEW_LEAD" } }],
          },
        },
      });
    }
    throw new Error(`Unexpected query: ${body.query.slice(0, 80)}`);
  };

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
    { fetchImpl },
  );

  assert.equal(result.personId, "person-existing");
  assert.equal(result.opportunityId, "opp-open");
  assert.equal(result.duplicate, true);
  assert.equal(result.opportunityCreated, false);
});

test("syncLeadToCrm rejects contact without phone or email", async () => {
  await assert.rejects(
    () => syncLeadToCrm(
      { twentyApiUrl: "https://crm.example.com", twentyApiKey: "token" },
      { id: 1, name: "X", contact: "???", personal_data_consent: true },
      { fetchImpl: async () => jsonResponse({ data: {} }) },
    ),
    (error) => error instanceof CrmPermanentError,
  );
});

test("syncLeadToCrm treats multiple Person phone matches as permanent", async () => {
  await assert.rejects(
    () => syncLeadToCrm(
      { twentyApiUrl: "https://crm.example.com", twentyApiKey: "token" },
      {
        id: 7,
        name: "Conflict",
        contact: "+79001112233",
        personal_data_consent: true,
      },
      {
        fetchImpl: async (_url, init) => {
          const body = JSON.parse(init.body);
          if (body.query.includes("FindByLandingLeadId")) {
            return jsonResponse({ data: { people: { edges: [] } } });
          }
          if (body.query.includes("FindByPhone")) {
            return jsonResponse({
              data: {
                people: {
                  edges: [
                    {
                      node: {
                        id: "p1",
                        name: { firstName: "A", lastName: "" },
                        landingLeadId: null,
                        firstLeadAt: null,
                        leadSource: "UNKNOWN",
                        lifecycleStatus: "WAITLIST",
                        personalDataConsent: true,
                        marketingConsent: false,
                        firstUtmCampaign: null,
                      },
                    },
                    {
                      node: {
                        id: "p2",
                        name: { firstName: "B", lastName: "" },
                        landingLeadId: null,
                        firstLeadAt: null,
                        leadSource: "UNKNOWN",
                        lifecycleStatus: "WAITLIST",
                        personalDataConsent: true,
                        marketingConsent: false,
                        firstUtmCampaign: null,
                      },
                    },
                  ],
                },
              },
            });
          }
          throw new Error("unexpected");
        },
      },
    ),
    (error) => error instanceof CrmPermanentError && /Multiple Person matches/.test(error.message),
  );
});
