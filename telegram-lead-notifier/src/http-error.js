/**
 * Prefer actionable text from Twenty / Nest-style error bodies.
 * Nest often sets error: "Error" / "Not Found" while message has the detail.
 */
export function formatHttpErrorMessage(prefix, response, body) {
  const status = response?.status ?? "?";
  const statusText = response?.statusText || "";
  const payload = body && typeof body === "object" ? body : {};

  const candidates = [
    payload.message,
    Array.isArray(payload.messages) ? payload.messages.map(String).join("; ") : null,
    typeof payload.error === "string" && !/^error$/i.test(payload.error)
      ? payload.error
      : null,
    payload.error?.message,
    Array.isArray(payload.errors) ? payload.errors.map(String).join("; ") : null,
  ].filter((value) => value != null && String(value).trim() !== "");

  const detail = candidates.length
    ? candidates.map(String).join(" | ")
    : statusText || "no response body";

  let preview = "";
  try {
    const raw = JSON.stringify(payload);
    if (raw && raw !== "{}") preview = ` body=${raw.slice(0, 500)}`;
  } catch {
    // ignore
  }

  return `${prefix} ${status}: ${detail}${preview}`;
}

export function isAbortError(error) {
  return (
    error?.name === "AbortError"
    || error?.name === "TimeoutError"
    || /aborted due to timeout|The operation was aborted/i.test(String(error?.message ?? ""))
  );
}
