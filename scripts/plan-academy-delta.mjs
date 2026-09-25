import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { planAcademyDelta } from "./lib/academy-delta.mjs";

const [previousPath, currentPath, flag, requestedReportPath] = process.argv.slice(2);
if (!previousPath || !currentPath || (flag && flag !== "--report") || (flag && !requestedReportPath)) {
  console.error("Usage: npm run academy:delta -- <previous-manifest> <current-manifest> [--report output/private/new-report.json]");
  process.exitCode = 1;
} else {
  try {
    const [previous, current] = await Promise.all([previousPath, currentPath].map(async (file) =>
      JSON.parse(await readFile(path.resolve(file), "utf8"))));
    const plan = planAcademyDelta(previous, current);
    if (requestedReportPath) {
      const privateRoot = await realpath(path.resolve("output/private"));
      const reportPath = path.resolve(requestedReportPath);
      const reportParent = await realpath(path.dirname(reportPath));
      if (reportParent !== privateRoot || path.basename(reportPath).startsWith(".")) {
        throw new Error("Delta reports must be new files directly inside output/private");
      }
      await writeFile(reportPath, JSON.stringify(plan, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    }
    console.log(JSON.stringify({
      previousExportedAt: plan.previousExportedAt,
      currentExportedAt: plan.currentExportedAt,
      previousCount: plan.previousCount,
      currentCount: plan.currentCount,
      changes: plan.counts,
      requiresReview: Object.values(plan.counts).some(Boolean),
      missingRecordsMustNotBeAutoDeleted: plan.counts.missing > 0,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Delta planning failed");
    process.exitCode = 1;
  }
}
