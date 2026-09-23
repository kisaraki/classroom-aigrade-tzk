export type GoogleIdentity = {
  verified: true;
  subject: string;
  email: string;
  emailVerified: true;
  issuer: string;
  audience: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  name?: string;
};

export type OidcConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  issuer?: string;
  clockSkewSeconds?: number;
};

export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

export type AuthSession = {
  adminId: string;
  sessionId: string;
  role: string;
  authenticatedAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

export type AuthResult = AuthSession & {
  token: string;
  isFirstBinding: boolean;
};

export type OAuthStart = {
  authorizationUrl: string;
  stateCookie: string;
};

export class AuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 401) {
    super(code);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}
