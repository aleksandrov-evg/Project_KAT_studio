import assert from "node:assert/strict";
import test from "node:test";
import { formatHttpErrorMessage, isAbortError } from "../src/http-error.js";

test("formatHttpErrorMessage prefers message over generic error", () => {
  const msg = formatHttpErrorMessage("Twenty WF-01", { status: 400, statusText: "Bad Request" }, {
    error: "Error",
    message: "externalId, name and personalDataConsent=true are required",
  });
  assert.match(msg, /externalId/);
  assert.match(msg, /400/);
  assert.doesNotMatch(msg, /: Error body=/);
});

test("formatHttpErrorMessage includes body preview", () => {
  const msg = formatHttpErrorMessage("LeadAction", { status: 404, statusText: "Not Found" }, {
    error: "Person not found",
  });
  assert.match(msg, /Person not found/);
  assert.match(msg, /body=/);
});

test("isAbortError detects timeout", () => {
  assert.equal(isAbortError({ name: "AbortError", message: "aborted" }), true);
  assert.equal(
    isAbortError({ message: "The operation was aborted due to timeout" }),
    true,
  );
  assert.equal(isAbortError({ message: "boom" }), false);
});
