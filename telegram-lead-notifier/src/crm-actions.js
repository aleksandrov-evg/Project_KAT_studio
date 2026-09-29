import { CrmPermanentError, CrmTransientError } from "./crm.js";
import { formatHttpErrorMessage } from "./http-error.js";

function studioLeadActionsUrl(apiUrl) {
  const base = apiUrl.replace(/\/+$/, "");
  if (base.endsWith("/s/studio/lead-actions")) return base;
  if (base.endsWith("/graphql")) {
    return `${base.slice(0, -"/graphql".length)}/s/studio/lead-actions`;
  }
  if (base.endsWith("/s/studio/leads")) {
    return `${base.slice(0, -"/leads".length)}/lead-actions`;
  }
  return `${base}/s/studio/lead-actions`;
}

/**
 * POST funnel action to katfit-studio LeadAction API.
 */
export async function postLeadAction(config, payload, { fetchImpl = fetch } = {}) {
  if (!config.crmSyncEnabled) {
    throw new CrmPermanentError("CRM sync disabled; cannot post lead action");
  }

  const response = await fetchImpl(studioLeadActionsUrl(config.twentyApiUrl), {
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

  if (response.status >= 400 && response.status < 500) {
    throw new CrmPermanentError(
      formatHttpErrorMessage("LeadAction", response, body),
      { status: response.status },
    );
  }
  if (!response.ok) {
    throw new CrmTransientError(
      formatHttpErrorMessage("LeadAction", response, body),
      { status: response.status },
    );
  }

  return body;
}

export function personDeepLink(config, personId) {
  if (!config.twentyAppBaseUrl || !personId) return null;
  const base = config.twentyAppBaseUrl.replace(/\/+$/, "");
  return `${base}/objects/people/${personId}`;
}
