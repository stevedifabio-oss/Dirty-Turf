import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
}).split("\0").filter(Boolean);

const patterns = [
  ["Resend API key", /\bre_[A-Za-z0-9_-]{20,}\b/g],
  ["Stripe secret key", /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9]{16,}\b/g],
  ["HighLevel private token", /\bpit-[A-Za-z0-9-]{20,}\b/g],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

const findings = [];
for (const relativePath of files) {
  const filePath = path.join(root, relativePath);
  let buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    continue;
  }
  if (buffer.length > 2_000_000 || buffer.includes(0)) continue;
  const contents = buffer.toString("utf8");
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of contents.matchAll(pattern)) {
      const line = contents.slice(0, match.index).split("\n").length;
      findings.push({ file: relativePath, line, type: label });
    }
  }
}

if (findings.length) {
  console.error("Credential-like values found:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.type})`);
  }
  process.exit(1);
}

console.log(`Secret scan passed across ${files.length} repository files.`);
