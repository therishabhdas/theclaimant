import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedGameWorkerRequest } from "./worker-auth.ts";

const secret = "a".repeat(32);

test("accepts only the configured bearer secret", () => {
  assert.equal(isAuthorizedGameWorkerRequest(`Bearer ${secret}`, secret), true);
  assert.equal(isAuthorizedGameWorkerRequest(`Bearer ${"b".repeat(32)}`, secret), false);
  assert.equal(isAuthorizedGameWorkerRequest(`Bearer ${secret}`, "short"), false);
  assert.equal(isAuthorizedGameWorkerRequest(secret, secret), false);
  assert.equal(isAuthorizedGameWorkerRequest(null, secret), false);
  assert.equal(isAuthorizedGameWorkerRequest(`Bearer ${secret}`, undefined), false);
});
