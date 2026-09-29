import { CrmPermanentError, CrmTransientError } from "./crm.js";
import { formatHttpErrorMessage } from "./http-error.js";

function studioApiBase(apiUrl) {
  const base = apiUrl.replace(/\/+$/, "");
  if (base.endsWith("/graphql")) {
    return base.slice(0, -"/graphql".length);
  }
  if (base.endsWith("/s/studio/leads")) {
    return base.slice(0, -"/leads".length);
  }
  if (base.endsWith("/s/studio/lead-actions")) {
    return base.slice(0, -"/lead-actions".length);
  }
  if (base.endsWith("/s/studio/lead-status")) {
    return base.slice(0, -"/lead-status".length);
  }
  if (base.endsWith("/s/studio")) return base;
  return `${base}/s/studio`;
}

function studioLeadActionsUrl(apiUrl) {
  const base = apiUrl.replace(/\/+$/, "");
  if (base.endsWith("/s/studio/lead-actions")) return base;
  return `${studioApiBase(apiUrl)}/lead-actions`;
}

function studioLeadStatusUrl(apiUrl) {
  const base = apiUrl.replace(/\/+$/, "");
  if (base.endsWith("/s/studio/lead-status")) return base;
  return `${studioApiBase(apiUrl)}/lead-status`;
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

/**
 * Read Person / Opportunity stage + Notes for card resend.
 * Body: `{ landingLeadId }` or `{ personId }`.
 */
export async function fetchLeadStatus(config, payload, { fetchImpl = fetch } = {}) {
  if (!config.crmSyncEnabled) {
    throw new CrmPermanentError("CRM sync disabled; cannot fetch lead status");
  }

  const response = await fetchImpl(studioLeadStatusUrl(config.twentyApiUrl), {
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
      formatHttpErrorMessage("LeadStatus", response, body),
      { status: response.status },
    );
  }
  if (!response.ok) {
    throw new CrmTransientError(
      formatHttpErrorMessage("LeadStatus", response, body),
      { status: response.status },
    );
  }

  return body;
}

/**
 * Map CRM Notes to telegram card status_history entries (oldest → newest).
 * actionLabel from body/title; actor from trailing «— …»; channel from «Канал: …».
 */
export function mapCrmNotesToStatusHistory(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return [];

  const sorted = [...notes].sort((a, b) => {
    const ta = Date.parse(a?.at || "") || 0;
    const tb = Date.parse(b?.at || "") || 0;
    return ta - tb;
  });

  return sorted.map((note) => {
    const body = String(note?.body ?? "").trim();
    const title = String(note?.title ?? "").trim();

    let actorLabel = null;
    let bodyWithoutActor = body;
    if (body) {
      const lines = body.split(/\n/);
      let lastIdx = -1;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i].trim()) {
          lastIdx = i;
          break;
        }
      }
      if (lastIdx >= 0) {
        const actorMatch = lines[lastIdx].trim().match(/^—\s*(.+)$/);
        if (actorMatch) {
          actorLabel = actorMatch[1].trim() || null;
          bodyWithoutActor = lines.slice(0, lastIdx).join("\n").trim();
        }
      }
    }

    let channelLabel = null;
    const channelMatch = bodyWithoutActor.match(/Канал:\s*([^\n.]+)/i);
    if (channelMatch) channelLabel = channelMatch[1].trim() || null;

    let actionLabel = bodyWithoutActor
      .replace(/^Канал:\s*[^\n.]+\.?\s*/i, "")
      .trim();
    if (actionLabel.includes("\n")) {
      actionLabel = actionLabel.split("\n").map((line) => line.trim()).find(Boolean) || actionLabel;
    }
    if (!actionLabel) {
      actionLabel = title.replace(/^TG-EVENT:\s*/i, "").trim() || title || "Событие";
    }

    return {
      at: note?.at || null,
      actionLabel,
      actorLabel,
      channelLabel,
      clientStage: null,
    };
  });
}

export function personDeepLink(config, personId) {
  if (!config.twentyAppBaseUrl || !personId) return null;
  const base = config.twentyAppBaseUrl.replace(/\/+$/, "");
  return `${base}/objects/people/${personId}`;
}

/** Prefer CRM deepLinkPath; fall back to personId + TWENTY_APP_BASE_URL. */
export function resolveLeadDeepLink(config, { deepLinkPath = null, personId = null } = {}) {
  const path = String(deepLinkPath || "").trim();
  if (path) {
    if (/^https?:\/\//i.test(path)) return path;
    if (!config.twentyAppBaseUrl) return null;
    const base = config.twentyAppBaseUrl.replace(/\/+$/, "");
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }
  return personDeepLink(config, personId);
}
