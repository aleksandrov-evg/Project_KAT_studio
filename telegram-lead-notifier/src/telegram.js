const RETRY_DELAYS_MS = [1000, 3000, 10000, 30000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendTelegramMessage(config, text) {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  const payload = {
    chat_id: config.telegramChatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (config.telegramThreadId) payload.message_thread_id = Number(config.telegramThreadId);

  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) return result.result;

      const retryAfter = Number(result?.parameters?.retry_after) * 1000;
      const error = new Error(`Telegram API ${response.status}: ${result.description ?? "unknown error"}`);
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        error.permanent = true;
        throw error;
      }
      lastError = error;
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(retryAfter || RETRY_DELAYS_MS[attempt]);
      }
    } catch (error) {
      if (error.permanent) throw error;
      lastError = error;
      if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}
