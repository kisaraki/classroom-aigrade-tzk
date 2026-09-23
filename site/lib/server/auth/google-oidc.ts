import {
  AuthError,
  type OidcConfig,
  type OidcDiscovery,
  type GoogleIdentity,
} from "./types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const GOOGLE_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);
const DISCOVERY_PATH = "/.well-known/openid-configuration";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value))
    throw new AuthError("OIDC_MALFORMED_TOKEN");
  const padded =
    value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlJson<T>(value: string): T {
  try {
    return JSON.parse(decoder.decode(base64UrlToBytes(value))) as T;
  } catch {
    throw new AuthError("OIDC_MALFORMED_TOKEN");
  }
}

export function base64UrlEncode(value: Uint8Array): string {
  return bytesToBase64Url(value);
}

export function base64UrlDecode(value: string): Uint8Array {
  return base64UrlToBytes(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function randomBase64Url(byteLength = 32): string {
  if (!Number.isInteger(byteLength) || byteLength < 16 || byteLength > 96)
    throw new AuthError("OIDC_INVALID_RANDOM_LENGTH", 500);
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function equalStrings(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index++)
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}

function httpsUrl(value: string, code: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new AuthError(code, 500);
  }
}

function issuerAllowed(value: string): boolean {
  return GOOGLE_ISSUERS.has(value);
}

type JwtHeader = { alg?: string; kid?: string; typ?: string };
type JwtClaims = {
  iss?: unknown;
  sub?: unknown;
  aud?: unknown;
  azp?: unknown;
  exp?: unknown;
  iat?: unknown;
  auth_time?: unknown;
  nonce?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
};

type GoogleJwk = JsonWebKey & { kid?: string };

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class GoogleOidcClient {
  private discoveryCache:
    { value: OidcDiscovery; expiresAt: number } | undefined;
  private readonly config: OidcConfig;
  private readonly fetcher: Fetcher;
  private readonly now: () => number;

  constructor(
    config: OidcConfig,
    fetcher: Fetcher = fetch,
    now: () => number = () => Date.now(),
  ) {
    this.config = config;
    this.fetcher = fetcher;
    this.now = now;
    if (!config.clientId || !config.clientSecret || !config.redirectUri)
      throw new AuthError("OIDC_NOT_CONFIGURED", 503);
    httpsUrl(config.redirectUri, "OIDC_INVALID_REDIRECT_URI");
  }

  async discover(): Promise<OidcDiscovery> {
    if (this.discoveryCache && this.discoveryCache.expiresAt > this.now())
      return this.discoveryCache.value;
    const issuer = this.config.issuer ?? "https://accounts.google.com";
    if (!issuerAllowed(issuer)) throw new AuthError("OIDC_INVALID_ISSUER", 500);
    const response = await this.fetcher(`${issuer}${DISCOVERY_PATH}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new AuthError("OIDC_DISCOVERY_FAILED", 503);
    let discovery: Partial<OidcDiscovery>;
    try {
      discovery = (await response.json()) as Partial<OidcDiscovery>;
    } catch {
      throw new AuthError("OIDC_DISCOVERY_FAILED", 503);
    }
    if (
      typeof discovery.issuer !== "string" ||
      !issuerAllowed(discovery.issuer) ||
      typeof discovery.authorization_endpoint !== "string" ||
      typeof discovery.token_endpoint !== "string" ||
      typeof discovery.jwks_uri !== "string"
    )
      throw new AuthError("OIDC_DISCOVERY_INVALID", 503);
    const result = {
      issuer: discovery.issuer,
      authorization_endpoint: httpsUrl(
        discovery.authorization_endpoint,
        "OIDC_DISCOVERY_INVALID",
      ),
      token_endpoint: httpsUrl(
        discovery.token_endpoint,
        "OIDC_DISCOVERY_INVALID",
      ),
      jwks_uri: httpsUrl(discovery.jwks_uri, "OIDC_DISCOVERY_INVALID"),
    };
    this.discoveryCache = { value: result, expiresAt: this.now() + 5 * 60_000 };
    return result;
  }

  async authorizationUrl(parameters: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string> {
    const discovery = await this.discover();
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: parameters.state,
      nonce: parameters.nonce,
      code_challenge: parameters.codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
      claims: JSON.stringify({ id_token: { auth_time: { essential: true } } }),
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<string> {
    if (!code || !codeVerifier) throw new AuthError("OIDC_CALLBACK_INVALID");
    const discovery = await this.discover();
    const response = await this.fetcher(discovery.token_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }),
    });
    if (!response.ok) throw new AuthError("OIDC_TOKEN_EXCHANGE_FAILED");
    let tokenResponse: { id_token?: unknown };
    try {
      tokenResponse = (await response.json()) as { id_token?: unknown };
    } catch {
      throw new AuthError("OIDC_TOKEN_EXCHANGE_FAILED");
    }
    if (typeof tokenResponse.id_token !== "string")
      throw new AuthError("OIDC_TOKEN_EXCHANGE_FAILED");
    return tokenResponse.id_token;
  }

  async verifyIdToken(
    idToken: string,
    expectedNonce: string,
  ): Promise<GoogleIdentity> {
    const segments = idToken.split(".");
    if (segments.length !== 3) throw new AuthError("OIDC_MALFORMED_TOKEN");
    const header = base64UrlJson<JwtHeader>(segments[0]);
    const claims = base64UrlJson<JwtClaims>(segments[1]);
    if (
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      (header.typ && header.typ !== "JWT")
    )
      throw new AuthError("OIDC_INVALID_SIGNATURE");
    const discovery = await this.discover();
    if (
      !issuerAllowed(String(claims.iss)) ||
      !equalStrings(String(claims.iss), discovery.issuer)
    )
      throw new AuthError("OIDC_INVALID_ISSUER");
    if (
      typeof claims.sub !== "string" ||
      !/^[\x21-\x7e]{1,255}$/u.test(claims.sub)
    )
      throw new AuthError("OIDC_MISSING_SUBJECT");
    if (
      typeof claims.exp !== "number" ||
      !Number.isInteger(claims.exp) ||
      typeof claims.iat !== "number" ||
      !Number.isInteger(claims.iat)
    )
      throw new AuthError("OIDC_INVALID_TIME");
    const nowSeconds = Math.floor(this.now() / 1000);
    const skew = this.config.clockSkewSeconds ?? 60;
    if (claims.exp <= nowSeconds - skew || claims.iat > nowSeconds + skew)
      throw new AuthError("OIDC_EXPIRED_TOKEN");
    const audiences =
      typeof claims.aud === "string"
        ? [claims.aud]
        : Array.isArray(claims.aud)
          ? claims.aud
          : [];
    if (
      !audiences.every(
        (audience): audience is string => typeof audience === "string",
      ) ||
      !audiences.includes(this.config.clientId)
    )
      throw new AuthError("OIDC_INVALID_AUDIENCE");
    if (audiences.length > 1 && claims.azp !== this.config.clientId)
      throw new AuthError("OIDC_INVALID_AUDIENCE");
    if (
      typeof claims.nonce !== "string" ||
      !equalStrings(claims.nonce, expectedNonce)
    )
      throw new AuthError("OIDC_NONCE_MISMATCH");
    if (
      typeof claims.email !== "string" ||
      claims.email.length === 0 ||
      claims.email.length > 320 ||
      claims.email_verified !== true
    )
      throw new AuthError("OIDC_EMAIL_UNVERIFIED");
    const jwksResponse = await this.fetcher(discovery.jwks_uri, {
      headers: { Accept: "application/json" },
    });
    if (!jwksResponse.ok) throw new AuthError("OIDC_JWKS_FAILED", 503);
    let jwks: { keys?: GoogleJwk[] };
    try {
      jwks = (await jwksResponse.json()) as { keys?: GoogleJwk[] };
    } catch {
      throw new AuthError("OIDC_JWKS_FAILED", 503);
    }
    const key = (jwks.keys ?? []).find(
      (candidate) => candidate.kid === header.kid,
    );
    if (!key) throw new AuthError("OIDC_UNKNOWN_KEY");
    let imported: CryptoKey;
    try {
      imported = await crypto.subtle.importKey(
        "jwk",
        key,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      const signature = new Uint8Array(base64UrlToBytes(segments[2]))
        .buffer as ArrayBuffer;
      const signed = new Uint8Array(
        encoder.encode(`${segments[0]}.${segments[1]}`),
      ).buffer as ArrayBuffer;
      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        imported,
        signature,
        signed,
      );
      if (!valid) throw new Error();
    } catch {
      throw new AuthError("OIDC_INVALID_SIGNATURE");
    }
    return {
      verified: true,
      subject: claims.sub,
      email: claims.email,
      emailVerified: true,
      issuer: String(claims.iss),
      audience: this.config.clientId,
      nonce: claims.nonce,
      issuedAt: claims.iat,
      expiresAt: claims.exp,
      ...(typeof claims.auth_time === "number" &&
      Number.isSafeInteger(claims.auth_time)
        ? { authTime: claims.auth_time }
        : {}),
      ...(typeof claims.name === "string" ? { name: claims.name } : {}),
    };
  }
}
