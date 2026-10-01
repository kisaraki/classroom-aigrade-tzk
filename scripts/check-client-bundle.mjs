import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../site/dist/client",
);
const prohibited =
  /\b(?:GOOGLE_OAUTH_CLIENT_SECRET|ADMIN_BOOTSTRAP_SECRET|ADMIN_RECOVERY_SECRET|IDENTITY_ENCRYPTION_KEY|IDENTITY_HMAC_SECRET|PUBLIC_LOOKUP_HMAC_SECRET|AUTH_RATE_HMAC_SECRET|OPENAI_API_KEY|GEMINI_API_KEY|identity_number_encrypted|identity_number_lookup_hash)\b|\bFROM\s+admin_sessions\b/u;
let checked = 0;
const findings = [];
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) scan(filename);
    else if (/\.(?:js|html|json|map)$/.test(entry.name)) {
      checked++;
      if (prohibited.test(readFileSync(filename, "utf8")))
        findings.push(path.relative(root, filename));
    }
  }
}
scan(root);
if (!checked)
  throw new Error("Client bundle is missing; build before checking.");
if (findings.length) {
  console.error(
    "Server-only identifiers found in client artifacts: " + findings.join(", "),
  );
  process.exitCode = 1;
} else
  console.log(
    `Client bundle: ${checked} files checked; no selected server-only identifiers. Not an exhaustive secret/PII scan.`,
  );
