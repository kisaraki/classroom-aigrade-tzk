declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    FILES?: R2Bucket;
    GOOGLE_OAUTH_CLIENT_ID?: string;
    GOOGLE_OAUTH_CLIENT_SECRET?: string;
    GOOGLE_OAUTH_REDIRECT_URI?: string;
    ADMIN_BOOTSTRAP_SECRET?: string;
    ADMIN_RECOVERY_SECRET?: string;
  }
}
