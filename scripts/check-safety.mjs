import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean),
  ),
];
const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["OpenAI key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["identity number", /\b[A-Z][12][0-9]{8}\b/],
];
const findings = [];
for (const file of files) {
  if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith(".env.example"))
    findings.push(file + ": environment file must not be tracked");
  if (/\.(?:sqlite|db|pem|key)$/.test(file))
    findings.push(file + ": prohibited runtime/credential file");
  if (/\.(?:png|jpg|jpeg|gif|woff2?|ico)$/.test(file)) continue;
  const source = readFileSync(path.join(root, file), "utf8");
  for (const [kind, pattern] of patterns)
    if (pattern.test(source)) findings.push(file + ": " + kind);
}
const pages = readFileSync(path.join(root, "pages/index.html"), "utf8");
if (/<(?:form|input|script)\b/i.test(pages))
  findings.push("pages/index.html: unexpected data collection or script");
if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Safety: " +
      files.length +
      " source files scanned; no selected secret/identity patterns; Pages is static. This is not an exhaustive security audit.",
  );
