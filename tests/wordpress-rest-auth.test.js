"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures", "wordpress-rest-auth.json"),
    "utf8",
  ),
);

function authorize(request) {
  if (request.session !== fixture.validSession) {
    return { allowed: false, status: 401, reason: "authentication" };
  }
  if (request.nonce !== fixture.validNonce) {
    return { allowed: false, status: 403, reason: "nonce" };
  }
  if (!request.capabilities.includes(fixture.requiredCapability)) {
    return { allowed: false, status: 403, reason: "capability" };
  }
  return { allowed: true, status: 200 };
}

function readProtectedWooCommerceData(request, onRead) {
  const decision = authorize(request);
  if (!decision.allowed) return decision;
  onRead();
  return { ...decision, data: fixture.protectedWooCommerceData };
}

test("WordPress REST auth fixture covers the required outcomes", () => {
  assert.deepStrictEqual(
    fixture.cases.map((scenario) => scenario.name),
    [
      "valid WordPress REST authentication",
      "invalid authentication",
      "invalid nonce",
      "missing nonce",
      "missing capability",
      "insufficient capability",
    ],
  );
});

test("authentication, nonce, and capability failures fail closed", () => {
  for (const scenario of fixture.cases) {
    let protectedReads = 0;
    const result = readProtectedWooCommerceData(scenario.request, () => {
      protectedReads += 1;
    });

    assert.strictEqual(
      result.allowed,
      scenario.expected.allowed,
      scenario.name,
    );
    assert.strictEqual(result.status, scenario.expected.status, scenario.name);
    if (scenario.expected.reason) {
      assert.strictEqual(
        result.reason,
        scenario.expected.reason,
        scenario.name,
      );
    }

    if (scenario.expected.allowed) {
      assert.strictEqual(protectedReads, 1, scenario.name);
      assert.deepStrictEqual(result.data, fixture.protectedWooCommerceData);
    } else {
      assert.strictEqual(
        protectedReads,
        0,
        `${scenario.name} read protected data`,
      );
      assert.strictEqual(
        result.data,
        undefined,
        `${scenario.name} returned protected data`,
      );
    }
  }
});

test("the fixture contains synthetic data only", () => {
  const serialized = JSON.stringify(fixture);
  assert.match(serialized, /synthetic-/);
  assert.doesNotMatch(
    serialized,
    /sk_|AKIA|Bearer |password|customer@example\.com/i,
  );
});
