import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const files = [...new Set(candidates)].filter(
  (file) => file.endsWith(".md") && !file.startsWith("site/vendor/"),
);
const errors = [];
const parsed = new Map();
function parse(file) {
  if (parsed.has(file)) return parsed.get(file);
  const text = readFileSync(path.join(root, file), "utf8");
  let fence = null;
  const prose = [];
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (fence === marker[1][0]) fence = null;
    } else if (!fence) prose.push(line);
  }
  if (fence) errors.push(file + ": unclosed code fence");
  const body = prose.join("\n");
  if ((body.match(/^# /gm) || []).length !== 1)
    errors.push(file + ": expected one main title");
  if (text.includes("\uFFFD")) errors.push(file + ": invalid text encoding");
  const anchors = new Set(
    [...body.matchAll(/<a\s+id="([^"]+)"/g)].map((m) => m[1]),
  );
  const seen = new Map();
  for (const m of body.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const slug = m[1]
      .toLowerCase()
      .replace(/[\p{P}\p{S}]/gu, (c) => (c === "-" || c === "_" ? c : ""))
      .replace(/ /g, "-");
    const count = seen.get(slug) || 0;
    seen.set(slug, count + 1);
    anchors.add(count ? slug + "-" + count : slug);
  }
  const value = { body, anchors };
  parsed.set(file, value);
  return value;
}
let links = 0;
for (const file of files) {
  const { body } = parse(file);
  for (const m of body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = m[1].replace(/^<|>$/g, "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const [relative, fragment] = target.split("#");
    const destination = relative
      ? path.posix.normalize(
          path.posix.join(
            path.posix.dirname(file),
            decodeURIComponent(relative),
          ),
        )
      : file;
    if (!existsSync(path.join(root, destination)))
      errors.push(file + ": missing link " + destination);
    else if (
      fragment &&
      destination.endsWith(".md") &&
      !parse(destination).anchors.has(decodeURIComponent(fragment))
    )
      errors.push(file + ": missing anchor " + target);
    links++;
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "Markdown: " +
      files.length +
      " project files, " +
      links +
      " local links passed; vendored license excluded.",
  );
