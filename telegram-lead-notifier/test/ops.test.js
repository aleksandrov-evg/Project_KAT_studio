import assert from "node:assert/strict";
import test from "node:test";
import { personDeepLink } from "../src/crm-actions.js";

test("personDeepLink builds CRM URL", () => {
  assert.equal(
    personDeepLink({ twentyAppBaseUrl: "https://crm.example.com/" }, "abc"),
    "https://crm.example.com/objects/people/abc",
  );
  assert.equal(personDeepLink({ twentyAppBaseUrl: null }, "abc"), null);
});
