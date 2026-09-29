/**
 * Parse TELEGRAM_MANAGER_WHITELIST=id:Name,id2:Name2
 * Empty whitelist = allow all users in the ops chat (dev / single-manager).
 */

export function parseManagerWhitelist(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return new Map();

  const map = new Map();
  for (const part of text.split(",")) {
    const item = part.trim();
    if (!item) continue;
    const idx = item.indexOf(":");
    if (idx <= 0) {
      map.set(item, item);
      continue;
    }
    const id = item.slice(0, idx).trim();
    const label = item.slice(idx + 1).trim() || id;
    if (id) map.set(id, label);
  }
  return map;
}

export function resolveManager(config, from) {
  const userId = from?.id != null ? String(from.id) : null;
  if (!userId) return { allowed: false, label: null, userId: null };

  const whitelist = config.managerWhitelist;
  if (!whitelist || whitelist.size === 0) {
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
    const username = from.username ? `@${from.username}` : null;
    return {
      allowed: true,
      label: name || username || userId,
      userId,
    };
  }

  if (!whitelist.has(userId)) {
    return { allowed: false, label: null, userId };
  }

  return { allowed: true, label: whitelist.get(userId), userId };
}
