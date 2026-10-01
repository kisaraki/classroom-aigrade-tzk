import { readFileSync } from "node:fs";
const config = JSON.parse(
  readFileSync(
    new URL("../site/dist/server/wrangler.json", import.meta.url),
    "utf8",
  ),
);
if (
  config.observability?.enabled !== false ||
  config.observability?.logs?.invocation_logs !== false ||
  config.observability?.logs?.enabled !== false ||
  config.observability?.traces?.enabled !== false
)
  throw new Error(
    "Generated Worker config must disable request logging and tracing before deployment review.",
  );
console.log(
  "Generated Worker config: request logs and traces disabled. Platform enforcement remains unverified.",
);
