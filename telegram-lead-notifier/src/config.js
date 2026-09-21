function integer(name, fallback, minimum = 1) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
  return value;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

export function readConfig() {
  return {
    databaseUrl: required("DATABASE_URL"),
    telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    telegramChatId: required("TELEGRAM_CHAT_ID"),
    telegramThreadId: process.env.TELEGRAM_THREAD_ID?.trim() || null,
    notifierKey: process.env.NOTIFIER_KEY?.trim() || "pilates-leads-main",
    pollIntervalMs: integer("POLL_INTERVAL_MS", 5000, 1000),
    batchSize: integer("BATCH_SIZE", 20, 1),
    port: integer("PORT", 3000, 1),
    sendExisting: process.env.SEND_EXISTING === "true",
  };
}
