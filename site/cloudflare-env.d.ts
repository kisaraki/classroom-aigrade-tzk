declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    PUBLIC_LOOKUP_HMAC_SECRET?: string;
    PUBLIC_LOOKUP_VERIFIED?: string;
    OPENAI_API_KEY?: string;
    GEMINI_API_KEY?: string;
    FILES?: R2Bucket;
    GOOGLE_OAUTH_CLIENT_ID?: string;
    GOOGLE_OAUTH_CLIENT_SECRET?: string;
    GOOGLE_OAUTH_REDIRECT_URI?: string;
    ADMIN_BOOTSTRAP_SECRET?: string;
    ADMIN_RECOVERY_SECRET?: string;
    IDENTITY_ENCRYPTION_KEY?: string;
    IDENTITY_HMAC_SECRET?: string;
  }
}
