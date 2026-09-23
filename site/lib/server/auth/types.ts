export type GoogleIdentity = {
  verified: true;
  subject: string;
  email: string;
  emailVerified: true;
  issuer: string;
  audience: string;
  nonce: string;
  issuedAt: number;
  authTime?: number;
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
  recentAuthenticatedAt: number;
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

export type AdminRole =
  | "super_admin"
  | "system_admin"
  | "academic_admin"
  | "score_admin"
  | "ai_admin"
  | "archive_admin"
  | "viewer";

export type Permission =
  | "admin.read"
  | "admin.manage"
  | "admin.rebind"
  | "assignment.manage"
  | "system.manage"
  | "academic.read"
  | "academic.write"
  | "score.read"
  | "score.write"
  | "ai.read"
  | "ai.manage"
  | "archive.read"
  | "archive.manage";

export type ScopeResource = {
  academicTermId?: string;
  academicYearId?: string;
  academicYearIds?: string[];
  classId?: string;
  classIds?: string[];
  studentId?: string;
  studentIds?: string[];
  grade?: number;
  subject?: string;
  onDate?: string;
  historical?: boolean;
  participationId?: string;
  historyReason?: string;
};

export type AuthorizationRequest = {
  adminId: string;
  sessionId: string;
  permission: Permission;
  resource?: ScopeResource;
  requireRecentAuth?: boolean;
};

export type RecoveryIdentity = Pick<
  GoogleIdentity,
  "verified" | "subject" | "email" | "emailVerified" | "name"
>;

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
