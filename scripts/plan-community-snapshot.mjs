import { readFile } from "node:fs/promises";
import { planCommunitySnapshot } from "./lib/community-snapshot.mjs";
import { writePrivateSnapshot } from "./capture-ghl-courses.mjs";

// Offline inspection only. This command never connects to GHL or the app database.
async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--capture", "--config", "--previous", "--report"].includes(args[i])
      || !args[i + 1] || options[args[i]]) {
      throw new Error("Usage: node scripts/plan-community-snapshot.mjs --capture <capture.json> --config <identities.json> [--previous <state.json>] --report output/private/<new-report.json>");
    }
    options[args[i]] = args[i + 1];
  }
  if (!options["--capture"] || !options["--config"] || !options["--report"]) {
    throw new Error("Required: --capture, --config, --report");
  }
  const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
  const [capture, config, previous] = await Promise.all([
    readJson(options["--capture"]), readJson(options["--config"]),
    options["--previous"] ? readJson(options["--previous"]) : null,
  ]);
  const plan = planCommunitySnapshot(previous, capture, config);
  await writePrivateSnapshot(options["--report"], plan);
  console.log(JSON.stringify({
    plannerOnly: true,
    applied: false,
    captureAccepted: plan.captureAccepted,
    postsObserved: capture.posts.length,
    commentsObserved: capture.comments.length,
    reportSaved: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof SyntaxError ? "Invalid local JSON input" :
    error?.code ? `Local file operation failed (${error.code})` : error.message);
  process.exitCode = 1;
});
