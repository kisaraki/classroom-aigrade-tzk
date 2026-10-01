import test from "node:test";
import assert from "node:assert/strict";
import {
  readSitesIdentity,
  sitesSignInPath,
} from "../lib/server/auth/sites-identity.ts";
const trusted = { trustedGatewayVerified: true };
const request = (headers = {}) =>
  new Request("https://fictional.invalid/admin", { headers });
const rejects = (fn, code, status) =>
  assert.throws(fn, (e) => e.code === code && e.status === status);

test("Sites identity: default and unverified gateway reject even convincing client headers", () => {
  const r = request({
    "oai-authenticated-user-id": "fictional-site-user",
    "x-sites-verified": "true",
    "x-role": "super_admin",
  });
  rejects(() => readSitesIdentity(r), "SITES_IDENTITY_NOT_VERIFIED", 503);
  for (const value of [false, undefined, "true", 1])
    rejects(
      () => readSitesIdentity(r, { trustedGatewayVerified: value }),
      "SITES_IDENTITY_NOT_VERIFIED",
      503,
    );
});
test("Sites identity: anonymous and service credentials never become a user", () => {
  for (const headers of [
    {},
    { "OAI-Sites-Authorization": "Bearer fictional-placeholder" },
    { "oai-authenticated-user-email": "fictional@example.invalid" },
  ])
    rejects(
      () => readSitesIdentity(request(headers), trusted),
      "UNAUTHENTICATED",
      401,
    );
});
test("Sites identity: immutable stable ID projection ignores email, roles and authentication time claims", () => {
  const identity = readSitesIdentity(
    request({
      "oai-authenticated-user-id": "FictionalOpaqueID_A-1",
      "oai-authenticated-user-email": "fictional@example.invalid",
      "oai-authenticated-user-full-name": "fictional",
      "x-role": "super_admin",
      auth_time: "9999999999",
      recent_auth_at: "9999999999",
    }),
    trusted,
  );
  assert.deepEqual(identity, {
    provider: "sites",
    subject: "FictionalOpaqueID_A-1",
  });
  assert.equal(Object.isFrozen(identity), true);
  assert.equal("recentAuthenticatedAt" in identity, false);
});
test("Sites identity: joined duplicate, whitespace, control and oversized identifiers fail closed", () => {
  for (const subject of [
    "first,second",
    "first second",
    "first\tsecond",
    "a".repeat(513),
  ])
    rejects(
      () =>
        readSitesIdentity(
          request({ "oai-authenticated-user-id": subject }),
          trusted,
        ),
      "INVALID_SITES_IDENTITY",
      401,
    );
  const headers = new Headers();
  headers.append("oai-authenticated-user-id", "first");
  headers.append("oai-authenticated-user-id", "second");
  rejects(
    () => readSitesIdentity(request(headers), trusted),
    "INVALID_SITES_IDENTITY",
    401,
  );
  // Request.Headers itself rejects certain control bytes; the adapter also rejects them if supplied by an alternate runtime.
  rejects(
    () =>
      readSitesIdentity(
        { headers: { get: () => "first\u0000second" } },
        trusted,
      ),
    "INVALID_SITES_IDENTITY",
    401,
  );
  assert.equal(
    readSitesIdentity(
      request({ "oai-authenticated-user-id": "a".repeat(512) }),
      trusted,
    ).subject.length,
    512,
  );
});
test("Sites sign-in: external, protocol-relative, malformed and reserved targets cannot redirect out or loop", () => {
  const fallback = "/signin-with-chatgpt?return_to=%2Fadmin";
  for (const path of [
    "https://evil.invalid/",
    "//evil.invalid/",
    "/\\evil.invalid/",
    "/signin-with-chatgpt",
    "/callback/",
    "/%63allback",
    "/signout-with-chatgpt?return_to=/",
    "/bad%ZZ",
    "/\n/evil.invalid/",
    "/%2f/evil.invalid/",
    null,
  ])
    assert.equal(sitesSignInPath(path), fallback, path);
  assert.equal(sitesSignInPath(), fallback);
  assert.equal(
    sitesSignInPath("/admin?section=audit#table"),
    "/signin-with-chatgpt?return_to=%2Fadmin%3Fsection%3Daudit%23table",
  );
});
