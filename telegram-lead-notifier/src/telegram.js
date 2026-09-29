import { isAbortError } from "./http-error.js";

const RETRY_DELAYS_MS = [1000, 3000, 10000, 30000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function telegramApi(
  config,
  method,
  payload,
  { fetchImpl = fetch, timeoutMs = 15000, retries = true } = {},
) {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;
  let lastError;
  const maxAttempts = retries ? RETRY_DELAYS_MS.length : 0;

  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) return result.result;

      const retryAfter = Number(result?.parameters?.retry_after) * 1000;
      const error = new Error(
        `Telegram API ${response.status}: ${result.description ?? "unknown error"}`,
      );
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        error.permanent = true;
        throw error;
      }
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(retryAfter || RETRY_DELAYS_MS[attempt]);
      }
    } catch (error) {
      if (error.permanent) throw error;
      // Long-poll idle timeout is expected for getUpdates — caller handles empty result.
      if (method === "getUpdates" && isAbortError(error)) {
        return [];
      }
      lastError = error;
      if (attempt < maxAttempts) await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

export async function sendTelegramMessage(config, text, { replyMarkup = null, fetchImpl = fetch } = {}) {
  const payload = {
    chat_id: config.telegramChatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (config.telegramThreadId) payload.message_thread_id = Number(config.telegramThreadId);
  if (replyMarkup) payload.reply_markup = replyMarkup;

  return telegramApi(config, "sendMessage", payload, { fetchImpl });
}

export async function editTelegramMessage(
  config,
  { chatId, messageId, text, replyMarkup = null },
  { fetchImpl = fetch } = {},
) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  else payload.reply_markup = { inline_keyboard: [] };

  return telegramApi(config, "editMessageText", payload, { fetchImpl });
}

export async function answerCallbackQuery(config, callbackQueryId, text = "", { fetchImpl = fetch } = {}) {
  const payload = {
    callback_query_id: callbackQueryId,
    show_alert: false,
  };
  const message = String(text ?? "").trim();
  if (message) payload.text = message.slice(0, 200);
  return telegramApi(config, "answerCallbackQuery", payload, { fetchImpl });
}

export async function getTelegramUpdates(config, offset, { fetchImpl = fetch } = {}) {
  // Telegram long-poll timeout must stay below AbortSignal budget.
  return telegramApi(
    config,
    "getUpdates",
    {
      offset,
      timeout: 20,
      allowed_updates: ["callback_query", "message"],
    },
    { fetchImpl, timeoutMs: 35000, retries: false },
  );
}

export async function setTelegramWebhook(config, url, { fetchImpl = fetch } = {}) {
  return telegramApi(
    config,
    "setWebhook",
    {
      url,
      allowed_updates: ["callback_query", "message"],
      drop_pending_updates: false,
      secret_token: config.telegramWebhookSecret || undefined,
    },
    { fetchImpl },
  );
}

export async function deleteTelegramWebhook(config, { fetchImpl = fetch } = {}) {
  return telegramApi(config, "deleteWebhook", { drop_pending_updates: false }, { fetchImpl });
}
