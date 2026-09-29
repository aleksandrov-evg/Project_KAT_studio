import {
  formatInterestsNote,
  mapInterestedFormats,
  mapLeadSource,
  parseContact,
  toIsoDate,
} from "./crm-mapping.js";

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

function studioLeadsUrl(apiUrl) {
  const base = apiUrl.replace(/\/+$/, "");
  if (base.endsWith("/s/studio/leads")) return base;
  if (base.endsWith("/graphql")) {
    return `${base.slice(0, -"/graphql".length)}/s/studio/leads`;
  }
  return `${base}/s/studio/leads`;
}

/**
 * Build WF-01 JSON body from a PostgreSQL `leads` row.
 */
export function buildStudioLeadPayload(lead) {
  const contact = parseContact(lead.contact);
  return {
    externalId: String(lead.id),
    submittedAt: toIsoDate(lead.created_at),
    name: String(lead.name ?? "").trim(),
    phone: contact.phone,
    email: contact.email,
    interestedFormats: mapInterestedFormats(lead.interests),
    personalDataConsent: lead.personal_data_consent !== false,
    personalDataConsentVersion: lead.privacy_policy_version ?? null,
    marketingConsent: Boolean(lead.marketing_consent),
    utm: {
      source: lead.utm_source ?? null,
      medium: lead.utm_medium ?? null,
      campaign: lead.utm_campaign ?? null,
      content: lead.utm_content ?? null,
      term: lead.utm_term ?? null,
    },
  };
}

/**
 * POST one landing lead to katfit-studio WF-01 (`POST /s/studio/leads`).
 * Idempotent by externalId (= landing lead id). Telegram stays separate.
 */
export async function syncLeadToCrm(config, lead, { fetchImpl = fetch } = {}) {
  const contact = parseContact(lead.contact);
  if (!contact.phone && !contact.email) {
    throw new CrmPermanentError(
      `Lead ${lead.id} has neither phone nor email in contact`,
    );
  }
  if (lead.personal_data_consent === false) {
    throw new CrmPermanentError(
      `Lead ${lead.id} missing personal data consent`,
    );
  }

  const payload = buildStudioLeadPayload(lead);
  const leadSource = mapLeadSource({
    utmSource: lead.utm_source,
    utmMedium: lead.utm_medium,
    utmCampaign: lead.utm_campaign,
  });

  const response = await fetchImpl(studioLeadsUrl(config.twentyApiUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${config.twentyApiKey}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  const body = await response.json().catch(() => ({}));

  if (response.status === 202 && body.reviewRequired) {
    throw new CrmPermanentError(
      body.message ?? `Lead ${lead.id} accepted for review (person conflict)`,
      { status: 202 },
    );
  }

  if (response.status >= 400 && response.status < 500) {
    const message =
      body.error ??
      body.message ??
      `Twenty WF-01 ${response.status}: ${response.statusText}`;
    throw new CrmPermanentError(message, { status: response.status });
  }

  if (!response.ok) {
    const message =
      body.error ??
      body.message ??
      `Twenty WF-01 ${response.status}: ${response.statusText}`;
    throw new CrmTransientError(message, { status: response.status });
  }

  return {
    personId: body.personId ?? null,
    opportunityId: body.opportunityId ?? null,
    taskId: body.taskId ?? null,
    duplicate: Boolean(body.duplicate),
    opportunityCreated: !body.duplicate,
    leadSource,
    interestsNote: formatInterestsNote(lead.interests),
  };
}
