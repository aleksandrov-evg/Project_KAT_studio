import {
  formatInterestsNote,
  mapLeadSource,
  opportunityName,
  parseContact,
  splitPersonName,
  toIsoDate,
} from "./crm-mapping.js";

const TERMINAL_STAGES = new Set(["FIRST_PURCHASE", "LOST"]);

export class CrmPermanentError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "CrmPermanentError";
    this.permanent = true;
    this.status = status ?? null;
  }
}

export class CrmTransientError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = "CrmTransientError";
    this.permanent = false;
    this.status = status ?? null;
  }
}

function graphqlUrl(apiUrl) {
  const base = apiUrl.replace(/\/+$/, "");
  if (base.endsWith("/graphql")) return base;
  return `${base}/graphql`;
}

function gqlEscape(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
}

function gqlString(value) {
  return `"${gqlEscape(value)}"`;
}

/**
 * Low-level Twenty GraphQL request.
 * Exported for tests via dependency injection of `fetchImpl`.
 */
export async function twentyGraphql(config, query, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(graphqlUrl(config.twentyApiUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${config.twentyApiKey}`,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20000),
  });

  const body = await response.json().catch(() => ({}));
  const messageFromErrors = Array.isArray(body.errors)
    ? body.errors.map((item) => item.message).join("; ")
    : null;

  if (!response.ok) {
    const message = `Twenty API ${response.status}: ${messageFromErrors ?? response.statusText}`;
    if (response.status >= 400 && response.status < 500) {
      throw new CrmPermanentError(message, { status: response.status });
    }
    throw new CrmTransientError(message, { status: response.status });
  }

  if (body.errors?.length) {
    const message = `Twenty GraphQL error: ${messageFromErrors}`;
    const isClient =
      /validation|unauthorized|forbidden|bad request|not found|invalid/i.test(messageFromErrors);
    if (isClient) throw new CrmPermanentError(message, { status: 400 });
    throw new CrmTransientError(message);
  }

  return body.data;
}

function personSelection() {
  return `{
    id
    name { firstName lastName }
    phones { primaryPhoneNumber primaryPhoneCallingCode }
    emails { primaryEmail }
    landingLeadId
    firstLeadAt
    lastLeadAt
    leadSource
    lifecycleStatus
    personalDataConsent
    marketingConsent
    firstUtmCampaign
  }`;
}

async function findPeopleByLandingLeadId(config, landingLeadId, options) {
  const query = `
    query FindByLandingLeadId {
      people(filter: { landingLeadId: { eq: ${gqlString(String(landingLeadId)) } } }, first: 5) {
        edges { node ${personSelection()} }
      }
    }`;
  const data = await twentyGraphql(config, query, options);
  return (data?.people?.edges ?? []).map((edge) => edge.node);
}

async function findPeopleByPhone(config, nationalNumber, options) {
  const query = `
    query FindByPhone {
      people(filter: { phones: { primaryPhoneNumber: { eq: ${gqlString(nationalNumber) } } } }, first: 5) {
        edges { node ${personSelection()} }
      }
    }`;
  const data = await twentyGraphql(config, query, options);
  return (data?.people?.edges ?? []).map((edge) => edge.node);
}

async function findPeopleByEmail(config, email, options) {
  const query = `
    query FindByEmail {
      people(filter: { emails: { primaryEmail: { eq: ${gqlString(email) } } } }, first: 5) {
        edges { node ${personSelection()} }
      }
    }`;
  const data = await twentyGraphql(config, query, options);
  return (data?.people?.edges ?? []).map((edge) => edge.node);
}

function uniquePeople(people) {
  const byId = new Map();
  for (const person of people) {
    if (person?.id) byId.set(person.id, person);
  }
  return [...byId.values()];
}

async function resolvePerson(config, { phoneInfo, email }, options) {
  const byPhone = phoneInfo.nationalNumber
    ? await findPeopleByPhone(config, phoneInfo.nationalNumber, options)
    : [];
  const byEmail = email ? await findPeopleByEmail(config, email, options) : [];

  if (byPhone.length && byEmail.length) {
    const phoneIds = new Set(byPhone.map((person) => person.id));
    const conflicting = byEmail.filter((person) => !phoneIds.has(person.id));
    if (conflicting.length) {
      throw new CrmPermanentError(
        `Person conflict: phone matches ${byPhone.map((p) => p.id).join(",")} but email matches ${conflicting.map((p) => p.id).join(",")}`,
      );
    }
  }

  const matches = uniquePeople([...byPhone, ...byEmail]);
  if (matches.length > 1) {
    throw new CrmPermanentError(
      `Multiple Person matches for contact: ${matches.map((p) => p.id).join(",")}`,
    );
  }
  return matches[0] ?? null;
}

function buildPhoneInput(phoneInfo) {
  if (!phoneInfo.nationalNumber) return null;
  return `{
    primaryPhoneNumber: ${gqlString(phoneInfo.nationalNumber)},
    primaryPhoneCountryCode: "RU",
    primaryPhoneCallingCode: "+7"
  }`;
}

function buildEmailInput(email) {
  if (!email) return null;
  return `{ primaryEmail: ${gqlString(email)} }`;
}

function buildCreatePersonData(lead, { phoneInfo, email, leadSource, submittedAt }) {
  const { firstName, lastName } = splitPersonName(lead.name);
  const parts = [
    `name: { firstName: ${gqlString(firstName)}, lastName: ${gqlString(lastName)} }`,
    `landingLeadId: ${gqlString(String(lead.id))}`,
    `lifecycleStatus: WAITLIST`,
    `leadSource: ${leadSource}`,
    `firstLeadAt: ${gqlString(submittedAt)}`,
    `lastLeadAt: ${gqlString(submittedAt)}`,
    `personalDataConsent: ${lead.personal_data_consent !== false}`,
    `marketingConsent: ${Boolean(lead.marketing_consent)}`,
  ];

  const phones = buildPhoneInput(phoneInfo);
  if (phones) parts.push(`phones: ${phones}`);
  const emails = buildEmailInput(email);
  if (emails) parts.push(`emails: ${emails}`);
  if (lead.utm_campaign) {
    parts.push(`firstUtmCampaign: ${gqlString(lead.utm_campaign)}`);
  }

  return parts.join("\n      ");
}

function buildUpdatePersonData(existing, lead, { leadSource, submittedAt }) {
  const parts = [
    `lastLeadAt: ${gqlString(submittedAt)}`,
    `marketingConsent: ${Boolean(lead.marketing_consent)}`,
  ];

  if (!existing.firstLeadAt) {
    parts.push(`firstLeadAt: ${gqlString(submittedAt)}`);
  }
  if (!existing.leadSource || existing.leadSource === "UNKNOWN") {
    parts.push(`leadSource: ${leadSource}`);
  }
  if (!existing.landingLeadId) {
    parts.push(`landingLeadId: ${gqlString(String(lead.id))}`);
  }
  if (!existing.firstUtmCampaign && lead.utm_campaign) {
    parts.push(`firstUtmCampaign: ${gqlString(lead.utm_campaign)}`);
  }
  if (lead.personal_data_consent !== false && !existing.personalDataConsent) {
    parts.push(`personalDataConsent: true`);
  }
  if (
    existing.lifecycleStatus === "CHURNED" ||
    existing.lifecycleStatus === "PAUSED"
  ) {
    parts.push(`lifecycleStatus: RE_ENGAGEMENT`);
  } else if (!existing.lifecycleStatus || existing.lifecycleStatus === "WAITLIST") {
    parts.push(`lifecycleStatus: WAITLIST`);
  }

  return parts.join("\n      ");
}

async function createPerson(config, lead, context, options) {
  const query = `
    mutation CreatePerson {
      createPerson(data: {
        ${buildCreatePersonData(lead, context)}
      }) ${personSelection()}
    }`;
  const data = await twentyGraphql(config, query, options);
  return data.createPerson;
}

async function updatePerson(config, personId, existing, lead, context, options) {
  const query = `
    mutation UpdatePerson {
      updatePerson(
        id: ${gqlString(personId)},
        data: {
          ${buildUpdatePersonData(existing, lead, context)}
        }
      ) ${personSelection()}
    }`;
  const data = await twentyGraphql(config, query, options);
  return data.updatePerson;
}

async function findOpenOpportunity(config, personId, options) {
  const query = `
    query FindOpenOpportunity {
      opportunities(
        filter: {
          and: [
            { studioClientId: { eq: ${gqlString(personId) } } }
          ]
        },
        first: 20
      ) {
        edges {
          node {
            id
            clientStage
          }
        }
      }
    }`;
  const data = await twentyGraphql(config, query, options);
  const edges = data?.opportunities?.edges ?? [];
  return edges
    .map((edge) => edge.node)
    .find((node) => node?.id && !TERMINAL_STAGES.has(node.clientStage)) ?? null;
}

async function createOpportunity(config, { personId, personDisplayName, submittedAt }, options) {
  const query = `
    mutation CreateOpportunity {
      createOpportunity(data: {
        name: ${gqlString(opportunityName(personDisplayName))}
        clientStage: WAITLIST
        leadReceivedAt: ${gqlString(submittedAt)}
        studioClientId: ${gqlString(personId)}
      }) { id clientStage }
    }`;
  const data = await twentyGraphql(config, query, options);
  return data.createOpportunity;
}

function displayName(person, fallback) {
  const first = person?.name?.firstName ?? "";
  const last = person?.name?.lastName ?? "";
  const combined = `${first} ${last}`.trim();
  return combined || fallback || "Клиент";
}

/**
 * Sync one landing lead into Twenty CRM (Person + Opportunity).
 * Idempotent by landingLeadId and contact dedup.
 */
export async function syncLeadToCrm(config, lead, { fetchImpl = fetch } = {}) {
  const options = { fetchImpl };
  const phoneInfo = parseContact(lead.contact);
  const email = phoneInfo.email;
  const phone = phoneInfo.phone;

  if (!phone && !email) {
    throw new CrmPermanentError(`Lead ${lead.id} has neither phone nor email in contact`);
  }
  if (lead.personal_data_consent === false) {
    throw new CrmPermanentError(`Lead ${lead.id} missing personal data consent`);
  }

  const submittedAt = toIsoDate(lead.created_at);
  const leadSource = mapLeadSource({
    utmSource: lead.utm_source,
    utmMedium: lead.utm_medium,
    utmCampaign: lead.utm_campaign,
  });
  const context = { phoneInfo, email, leadSource, submittedAt };

  const byLanding = await findPeopleByLandingLeadId(config, lead.id, options);
  let person = byLanding[0] ?? null;
  let created = false;

  if (!person) {
    person = await resolvePerson(config, { phoneInfo, email }, options);
  }

  if (person) {
    person = await updatePerson(config, person.id, person, lead, context, options);
  } else {
    person = await createPerson(config, lead, context, options);
    created = true;
  }

  let opportunity = await findOpenOpportunity(config, person.id, options);
  let opportunityCreated = false;
  if (!opportunity) {
    opportunity = await createOpportunity(
      config,
      {
        personId: person.id,
        personDisplayName: displayName(person, lead.name),
        submittedAt,
      },
      options,
    );
    opportunityCreated = true;
  }

  const interestsNote = formatInterestsNote(lead.interests);

  return {
    personId: person.id,
    opportunityId: opportunity?.id ?? null,
    duplicate: !created,
    opportunityCreated,
    leadSource,
    interestsNote,
  };
}
