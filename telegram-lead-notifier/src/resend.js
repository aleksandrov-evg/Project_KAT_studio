/**
 * Parse ops-chat commands that re-send a lead card by landing lead id.
 * Examples: ID36, id 36, Id#36, /resend 36, /card 36, /resend@Bot 36
 */

/**
 * @param {string} text
 * @returns {{ leadId: number } | null}
 */
export function parseResendCommand(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const slash = raw.match(/^\/(?:resend|card)(?:@[A-Za-z0-9_]+)?\s+(\d+)\s*$/i);
  if (slash) {
    const leadId = Number(slash[1]);
    return Number.isFinite(leadId) && leadId > 0 ? { leadId } : null;
  }

  const idForm = raw.match(/^id[\s#]*(\d+)\s*$/i);
  if (idForm) {
    const leadId = Number(idForm[1]);
    return Number.isFinite(leadId) && leadId > 0 ? { leadId } : null;
  }

  return null;
}
