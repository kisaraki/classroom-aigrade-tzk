declare namespace Cloudflare {
  interface Env {
    SITES_AUTH_VERIFIED?: string;
    WEBAUTHN_ORIGIN?: string;
    DB?: D1Database;
    PUBLIC_LOOKUP_HMAC_SECRET?: string;
    PUBLIC_LOOKUP_VERIFIED?: string;
    AUTH_RATE_HMAC_SECRET?: string;
    AUTH_RATE_VERIFIED?: string;
    OPENAI_API_KEY?: string;
    GEMINI_API_KEY?: string;
    FILES?: R2Bucket;
    ADMIN_BOOTSTRAP_SECRET?: string;
    ADMIN_RECOVERY_SECRET?: string;
    IDENTITY_ENCRYPTION_KEY?: string;
    IDENTITY_HMAC_SECRET?: string;
  }
}
