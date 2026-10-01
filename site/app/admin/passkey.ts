"use client";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type { Requester } from "./workspace";
export async function verifyAdminPasskey(request: Requester, register = false) {
  const operation = register ? "register" : "reauth";
  const start = (await request("/api/auth/sites", {
    operation: operation + "-options",
    ...(register ? { confirmed: true } : {}),
  })) as {
    challengeId: string;
    options: PublicKeyCredentialCreationOptionsJSON &
      PublicKeyCredentialRequestOptionsJSON;
  };
  const response = register
    ? await startRegistration({ optionsJSON: start.options })
    : await startAuthentication({ optionsJSON: start.options });
  return request("/api/auth/sites", {
    operation: operation + "-verify",
    challengeId: start.challengeId,
    response,
  });
}
export async function completeSitesIdentity(
  request: Requester,
  requestToken: unknown,
) {
  const start = (await request("/api/auth/sites", {
    operation: "identity-options",
    requestToken,
  })) as {
    challengeId: string;
    options: PublicKeyCredentialCreationOptionsJSON;
  };
  const response = await startRegistration({ optionsJSON: start.options });
  return request("/api/auth/sites", {
    operation: "identity-verify",
    requestToken,
    challengeId: start.challengeId,
    response,
  });
}
