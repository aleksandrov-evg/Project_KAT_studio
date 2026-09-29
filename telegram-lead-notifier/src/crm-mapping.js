const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const INTEREST_TO_NOTE = {
  reformer: "реформер",
  pilates: "пилатес",
  stretching: "стретчинг",
  personal: "персональная тренировка",
  undecided: "пока не определился(ась)",
};

/**
 * Split a free-form contact into phone and/or email.
 * Landing stores a single `contact` field (phone or email).
 */
export function parseContact(contact) {
  const raw = String(contact ?? "").trim();
  if (!raw) return { phone: null, email: null, e164: null, nationalNumber: null };

  if (raw.includes("@") || EMAIL_RE.test(raw)) {
    return {
      phone: null,
      email: raw.toLowerCase(),
      e164: null,
      nationalNumber: null,
    };
  }

  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) {
    digits = `7${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits.startsWith("9")) {
    digits = `7${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("7")) {
    return {
      phone: `+${digits}`,
      email: null,
      e164: `+${digits}`,
      nationalNumber: digits.slice(1),
    };
  }

  return { phone: null, email: null, e164: null, nationalNumber: null };
}

/** Split "Анна Иванова" → firstName/lastName for Twenty FullName. */
export function splitPersonName(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Без имени", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Map landing UTM to CRM leadSource SELECT values.
 * @see katfit-studio LEAD_SOURCE_OPTIONS
 */
export function mapLeadSource({ utmSource, utmMedium, utmCampaign } = {}) {
  const source = String(utmSource ?? "").trim().toLowerCase();
  const medium = String(utmMedium ?? "").trim().toLowerCase();
  const campaign = String(utmCampaign ?? "").trim().toLowerCase();

  if (!source && !medium && !campaign) return "UNKNOWN";

  if (
    source.includes("maps") ||
    medium.includes("maps") ||
    campaign.includes("maps") ||
    source === "yandex_maps" ||
    source === "2gis"
  ) {
    return "MAPS";
  }

  if (
    source.includes("yandex") ||
    source === "ya" ||
    source === "yd" ||
    source.includes("direct")
  ) {
    if (
      medium.includes("network") ||
      medium.includes("rsya") ||
      medium === "display" ||
      medium === "cpm" ||
      campaign.includes("rsya") ||
      campaign.includes("network")
    ) {
      return "YANDEX_NETWORK";
    }
    return "YANDEX_SEARCH";
  }

  if (
    medium === "organic" ||
    source === "organic" ||
    source === "google" ||
    source === "bing"
  ) {
    return "ORGANIC_SEARCH";
  }

  if (
    source.includes("referr") ||
    medium === "referral" ||
    source === "friend" ||
    source === "recommend"
  ) {
    return "REFERRAL";
  }

  if (
    source.includes("telegram") ||
    source.includes("instagram") ||
    source.includes("vk") ||
    source.includes("social") ||
    medium === "social" ||
    medium === "cpc_social"
  ) {
    return "SOCIAL";
  }

  if (
    source.includes("whatsapp") ||
    source.includes("dm") ||
    medium === "dm" ||
    medium === "message"
  ) {
    return "DIRECT_MESSAGE";
  }

  if (source === "walkin" || source === "walk_in" || source === "offline") {
    return "WALK_IN";
  }

  return "OTHER";
}

/** Human-readable interests note (interestedFormats field not in metadata yet). */
export function formatInterestsNote(interests) {
  if (!Array.isArray(interests) || interests.length === 0) return null;
  return interests.map((value) => INTEREST_TO_NOTE[value] ?? value).join(", ");
}

export function opportunityName(personName) {
  const label = String(personName ?? "").trim() || "Клиент";
  return `${label} — первое занятие`;
}

export function toIsoDate(value) {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}
